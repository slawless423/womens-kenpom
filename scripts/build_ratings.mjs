import fs from "node:fs/promises";

const NCAA_API_BASE = "https://ncaa-api.henrygd.me";

// Set season start (adjust if you want)
const SEASON_START = "2025-11-01";

// ---- TUNING ----
const REQUEST_TIMEOUT_MS = 20000; // 20s per request
const REQUEST_RETRIES = 2;        // retries after the first attempt
const BOX_CONCURRENCY = 8;        // how many boxscores to fetch at once

console.log("START build_ratings", new Date().toISOString());

// Helper: YYYY-MM-DD -> Date (UTC)
function toDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fmtDate(dt) {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function addDays(dt, days) {
  const x = new Date(dt);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

function extractGameIds(obj) {
  const ids = new Set();
  const walk = (x) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (x && typeof x === "object") return Object.values(x).forEach(walk);
    if (typeof x === "string") {
      const matches = x.match(/\/game\/(\d+)/g);
      if (matches) matches.forEach((m) => ids.add(m.replace("/game/", "")));
    }
  };
  walk(obj);
  return [...ids];
}

function toInt(x, d = 0) {
  const n = parseInt(String(x ?? ""), 10);
  return Number.isFinite(n) ? n : d;
}

function poss(fga, orb, tov, fta) {
  return Math.max(1, fga - orb + tov + 0.475 * fta);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(path) {
  const url = `${NCAA_API_BASE}${path}`;

  for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "womens-kenpom-bot" },
      });

      if (!res.ok) {
        // Retry common transient statuses
        const retryable = [429, 500, 502, 503, 504].includes(res.status);
        if (retryable && attempt < REQUEST_RETRIES) {
          await sleep(300 * (attempt + 1));
          continue;
        }
        throw new Error(`Fetch failed ${res.status} for ${path}`);
      }

      return await res.json();
    } catch (e) {
      const msg = String(e?.message ?? e);

      const isTimeout =
        msg.includes("AbortError") ||
        msg.toLowerCase().includes("aborted") ||
        msg.toLowerCase().includes("timeout");

      if ((isTimeout || msg.includes("ECONNRESET") || msg.includes("ENOTFOUND")) && attempt < REQUEST_RETRIES) {
        await sleep(400 * (attempt + 1));
        continue;
      }

      // final failure
      if (isTimeout) throw new Error(`Fetch timed out after ${REQUEST_TIMEOUT_MS}ms for ${path}`);
      throw e;
    } finally {
      clearTimeout(t);
    }
  }

  // should never reach
  throw new Error(`Fetch failed after retries for ${path}`);
}

// Simple concurrency limiter
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  });

  await Promise.all(workers);
  return results;
}

// Parse the WBB boxscore
function parseWbbBoxscore(gameId, gameJson) {
  const teamsArr = Array.isArray(gameJson?.teams) ? gameJson.teams : [];
  const boxArr = Array.isArray(gameJson?.teamBoxscore) ? gameJson.teamBoxscore : [];
  if (teamsArr.length < 2 || boxArr.length < 2) return null;

  const totalsById = new Map();
  for (const b of boxArr) totalsById.set(String(b.teamId), b.teamStats ?? {});

  const homeMeta = teamsArr.find((t) => t.isHome === true) ?? teamsArr[0];
  const awayMeta = teamsArr.find((t) => t.isHome === false) ?? teamsArr[1];

  const homeId = String(homeMeta.teamId);
  const awayId = String(awayMeta.teamId);

  const hStats = totalsById.get(homeId) ?? {};
  const aStats = totalsById.get(awayId) ?? {};

  const home = {
    gameId,
    team: String(homeMeta.nameShort ?? homeMeta.nameFull ?? "Home"),
    teamId: homeId,
    opp: String(awayMeta.nameShort ?? awayMeta.nameFull ?? "Away"),
    oppId: awayId,
    pts: toInt(hStats.points, 0),
    fga: toInt(hStats.fieldGoalsAttempted, 0),
    fta: toInt(hStats.freeThrowsAttempted, 0),
    orb: toInt(hStats.offensiveRebounds, 0),
    tov: toInt(hStats.turnovers, 0),
  };

  const away = {
    gameId,
    team: String(awayMeta.nameShort ?? awayMeta.nameFull ?? "Away"),
    teamId: awayId,
    opp: String(homeMeta.nameShort ?? homeMeta.nameFull ?? "Home"),
    oppId: homeId,
    pts: toInt(aStats.points, 0),
    fga: toInt(aStats.fieldGoalsAttempted, 0),
    fta: toInt(aStats.freeThrowsAttempted, 0),
    orb: toInt(aStats.offensiveRebounds, 0),
    tov: toInt(aStats.turnovers, 0),
  };

  return [home, away];
}

async function main() {
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = toDate(SEASON_START);

  const teamAgg = new Map(); // teamId -> {team, ptsFor, ptsAgainst, poss, games}
  const seenGameIds = new Set(); // safety: avoid double counting

  let days = 0;
  let totalGamesFound = 0;
  let totalBoxesParsed = 0;

  for (let dt = start; dt <= end; dt = addDays(dt, 1)) {
    days++;
    const d = fmtDate(dt);
    const [Y, M, D] = d.split("-");
    const scoreboardPath = `/scoreboard/basketball-women/d1/${Y}/${M}/${D}/all-conf`;

    // light progress every ~7 days
    if (days % 7 === 1) {
      console.log("DATE", d);
    }

    let scoreboard;
    try {
      scoreboard = await fetchJson(scoreboardPath);
    } catch {
      // if that day fails, skip it
      continue;
    }

    const gameIds = extractGameIds(scoreboard).filter((gid) => !seenGameIds.has(gid));
    if (!gameIds.length) continue;

    for (const gid of gameIds) seenGameIds.add(gid);
    totalGamesFound += gameIds.length;

    // Fetch boxscores concurrently (big speed-up)
    const boxes = await mapLimit(gameIds, BOX_CONCURRENCY, async (gid) => {
      try {
        return await fetchJson(`/game/${gid}/boxscore`);
      } catch {
        return null;
      }
    });

    for (let idx = 0; idx < gameIds.length; idx++) {
      const gid = gameIds[idx];
      const box = boxes[idx];
      if (!box) continue;

const lines = parseWbbBoxscore(gid, box);
if (!lines) {
  // Save ONE sample so we can inspect the real structure
  if (!(globalThis.__WROTE_SAMPLE__)) {
    globalThis.__WROTE_SAMPLE__ = true;
    await fs.writeFile(
      "public/data/boxscore_sample_failed.json",
      JSON.stringify(box, null, 2),
      "utf8"
    );
    console.log("WROTE sample failed boxscore: public/data/boxscore_sample_failed.json for game", gid);
  }
  continue;
}


      totalBoxesParsed++;

      const a = lines[0];
      const b = lines[1];

      const aPoss = poss(a.fga, a.orb, a.tov, a.fta);
      const bPoss = poss(b.fga, b.orb, b.tov, b.fta);

      // Update A
      {
        const cur = teamAgg.get(a.teamId) ?? { team: a.team, ptsFor: 0, ptsAgainst: 0, poss: 0, games: 0 };
        cur.team = a.team;
        cur.ptsFor += a.pts;
        cur.ptsAgainst += b.pts;
        cur.poss += aPoss;
        cur.games += 1;
        teamAgg.set(a.teamId, cur);
      }

      // Update B
      {
        const cur = teamAgg.get(b.teamId) ?? { team: b.team, ptsFor: 0, ptsAgainst: 0, poss: 0, games: 0 };
        cur.team = b.team;
        cur.ptsFor += b.pts;
        cur.ptsAgainst += a.pts;
        cur.poss += bPoss;
        cur.games += 1;
        teamAgg.set(b.teamId, cur);
      }
    }
  }

  console.log("DONE fetching. days=", days, "gamesFound=", totalGamesFound, "boxesParsed=", totalBoxesParsed);

  const rows = [...teamAgg.entries()].map(([teamId, t]) => {
    const adjO = (t.ptsFor / Math.max(1, t.poss)) * 100;
    const adjD = (t.ptsAgainst / Math.max(1, t.poss)) * 100;
    const adjEM = adjO - adjD;
    const adjT = t.poss / Math.max(1, t.games);
    return { teamId, team: t.team, games: t.games, adjO, adjD, adjEM, adjT };
  });

  rows.sort((a, b) => b.adjEM - a.adjEM);

  const out = {
    generated_at_utc: new Date().toISOString(),
    season_start: SEASON_START,
    rows,
  };

  console.log("WRITE public/data/ratings.json");
  await fs.mkdir("public/data", { recursive: true });
  await fs.writeFile("public/data/ratings.json", JSON.stringify(out, null, 2), "utf8");

  console.log(`WROTE public/data/ratings.json with ${rows.length} teams`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
