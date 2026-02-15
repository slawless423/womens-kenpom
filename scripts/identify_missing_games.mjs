import fs from "node:fs/promises";

const NCAA_API_BASE = "https://ncaa-api.henrygd.me";
const SEASON_START = "2025-11-01";

console.log("START identify_missing_games (FAST)", new Date().toISOString());

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(path, timeout = 5000) {
  const url = `${NCAA_API_BASE}${path}`;
  
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeout);
    
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "baseline-analytics-bot",
        "Accept": "application/json",
      },
    });
    
    clearTimeout(t);
    
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
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

async function main() {
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = toDate(SEASON_START);

  const allGames = new Map(); // gameId -> {date, available}

  console.log("Step 1: Collecting all game IDs from scoreboards...");
  
  // Collect all game IDs (fast, no delays needed)
  for (let dt = start; dt <= end; dt = addDays(dt, 1)) {
    const d = fmtDate(dt);
    const [Y, M, D] = d.split("-");
    const scoreboardPath = `/scoreboard/basketball-women/d1/${Y}/${M}/${D}/all-conf`;

    const scoreboard = await fetchJson(scoreboardPath);
    if (!scoreboard) continue;

    const gameIds = extractGameIds(scoreboard);
    for (const gid of gameIds) {
      allGames.set(gid, { date: d, available: false });
    }
  }

  console.log(`Found ${allGames.size} total games`);
  console.log("\nStep 2: Testing boxscores in parallel (FAST MODE)...");

  const gameIds = [...allGames.keys()];
  
  // Test all boxscores in parallel with high concurrency
  const results = await mapLimit(gameIds, 20, async (gid, idx) => {
    if ((idx + 1) % 200 === 0) console.log(`Tested ${idx + 1}/${gameIds.length} games...`);
    
    const box = await fetchJson(`/game/${gid}/boxscore`, 5000);
    return { gid, available: box !== null };
  });

  // Update availability
  for (const { gid, available } of results) {
    const game = allGames.get(gid);
    if (game) game.available = available;
  }

  // Find missing games
  const missingGames = [];
  const successfulGames = [];

  for (const [gid, data] of allGames) {
    if (data.available) {
      successfulGames.push(gid);
    } else {
      missingGames.push({
        gameId: gid,
        date: data.date,
        homeTeam: "Unknown",
        awayTeam: "Unknown",
        ncaaUrl: `https://www.ncaa.com/game/${gid}`,
        status: "NEEDS_MANUAL_ENTRY"
      });
    }
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`Total games: ${allGames.size}`);
  console.log(`Successful: ${successfulGames.length}`);
  console.log(`Missing: ${missingGames.length}`);

  // Save as JSON
  await fs.mkdir("public/data", { recursive: true });
  await fs.writeFile(
    "public/data/missing_games.json",
    JSON.stringify(missingGames, null, 2),
    "utf8"
  );

  // Save as CSV
  const csvLines = [
    "gameId,date,homeTeam,awayTeam,ncaaUrl,status"
  ];
  for (const game of missingGames) {
    csvLines.push(
      `${game.gameId},${game.date},${game.homeTeam},${game.awayTeam},${game.ncaaUrl},${game.status}`
    );
  }
  await fs.writeFile(
    "public/data/missing_games.csv",
    csvLines.join("\n"),
    "utf8"
  );

  console.log(`\n✅ Created public/data/missing_games.json`);
  console.log(`✅ Created public/data/missing_games.csv`);
  console.log(`\nNext step: Manually fill in box scores for these ${missingGames.length} games`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
