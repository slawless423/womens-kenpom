import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const NCAA_API_BASE = "https://ncaa-api.henrygd.me";
const SCOREBOARD_URL =
  "https://www.ncaa.com/scoreboard/basketball-women/d1/2026/02/12/all-conf";

function poss(fga: number, orb: number, tov: number, fta: number) {
  return Math.max(1, fga - orb + tov + 0.475 * fta);
}

function toNum(x: any, d = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}

function dig(obj: any, keys: Set<string>): any {
  if (!obj) return undefined;
  if (Array.isArray(obj)) {
    for (const it of obj) {
      const got = dig(it, keys);
      if (got !== undefined) return got;
    }
    return undefined;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (keys.has(k)) return v;
      const got = dig(v, keys);
      if (got !== undefined) return got;
    }
  }
  return undefined;
}

function extractGameIds(obj: any): string[] {
  const ids = new Set<string>();
  const walk = (x: any) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (x && typeof x === "object") return Object.values(x).forEach(walk);
    if (typeof x === "string") {
      const matches = x.match(/\/game\/(\d+)/g);
      if (matches) {
        for (const m of matches) ids.add(m.replace("/game/", ""));
      }
    }
  };
  walk(obj);
  return Array.from(ids);
}

async function fetchJson(pathOrUrl: string) {
  const url = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `${NCAA_API_BASE}${pathOrUrl}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return res.json();
}

function parseTeamTotals(gameJson: any) {
  const home = dig(gameJson, new Set(["homeTeam", "home", "teamHome"])) ?? {};
  const away = dig(gameJson, new Set(["awayTeam", "away", "teamAway"])) ?? {};

  const homeName = String(
    dig(home, new Set(["name", "displayName", "fullName", "shortName"])) ?? "Home"
  );
  const awayName = String(
    dig(away, new Set(["name", "displayName", "fullName", "shortName"])) ?? "Away"
  );

  const homeId = String(dig(home, new Set(["id", "teamId", "seo"])) ?? homeName);
  const awayId = String(dig(away, new Set(["id", "teamId", "seo"])) ?? awayName);

  const homePts = toNum(dig(home, new Set(["score", "points", "pts"])));
  const awayPts = toNum(dig(away, new Set(["score", "points", "pts"])));

  const getStat = (teamObj: any, keys: string[]) =>
    toNum(dig(teamObj, new Set(keys)) ?? dig(gameJson, new Set(keys)));

  const homeFGA = getStat(home, ["fga", "fieldGoalsAttempted", "fgA"]);
  const awayFGA = getStat(away, ["fga", "fieldGoalsAttempted", "fgA"]);
  const homeFTA = getStat(home, ["fta", "freeThrowsAttempted", "ftA"]);
  const awayFTA = getStat(away, ["fta", "freeThrowsAttempted", "ftA"]);
  const homeORB = getStat(home, ["orb", "offensiveRebounds", "oReb", "offReb"]);
  const awayORB = getStat(away, ["orb", "offensiveRebounds", "oReb", "offReb"]);
  const homeTOV = getStat(home, ["tov", "turnovers", "to"]);
  const awayTOV = getStat(away, ["tov", "turnovers", "to"]);

  return [
    { team: homeName, teamId: homeId, opp: awayName, oppId: awayId, pts: homePts, fga: homeFGA, fta: homeFTA, orb: homeORB, tov: homeTOV },
    { team: awayName, teamId: awayId, opp: homeName, oppId: homeId, pts: awayPts, fga: awayFGA, fta: awayFTA, orb: awayORB, tov: awayTOV },
  ];
}

export async function GET() {
  // 1) Pull scoreboard JSON
  const u = new URL(SCOREBOARD_URL);
  const scoreboard = await fetchJson(`${NCAA_API_BASE}${u.pathname}`);
  const gameIds = extractGameIds(scoreboard);

  // 2) Pull each game boxscore and collect team totals
  const games: any[] = [];
  for (const gid of gameIds) {
    try {
      const gj = await fetchJson(`/game/${gid}/boxscore`);
      games.push(...parseTeamTotals(gj));
    } catch {
      // fallback if boxscore endpoint is missing
      const gj = await fetchJson(`/game/${gid}`);
      games.push(...parseTeamTotals(gj));
    }
  }

  // 3) Compute per-team average efficiency for the day (simple MVP)
  const byTeam = new Map<string, { team: string; ortgSum: number; possSum: number; games: number }>();

  for (const r of games) {
    const p = poss(r.fga, r.orb, r.tov, r.fta);
    const ortg = (r.pts / p) * 100.0;

    const cur = byTeam.get(r.teamId) ?? { team: r.team, ortgSum: 0, possSum: 0, games: 0 };
    cur.team = r.team;
    cur.ortgSum += ortg;
    cur.possSum += p;
    cur.games += 1;
    byTeam.set(r.teamId, cur);
  }

  const rows = Array.from(byTeam.entries()).map(([teamId, t]) => {
    const adjO = t.ortgSum / Math.max(1, t.games);
    // For the very first MVP, we’ll leave AdjD as 0; homepage still works and shows all teams.
    // Next step is adding opponent points for true AdjD.
    const adjD = 0;
    const adjEM = adjO - adjD;
    return { team: t.team, teamId, adjO, adjD, adjEM };
  });

  rows.sort((a, b) => b.adjEM - a.adjEM);

  return NextResponse.json({ date: "2026-02-12", rows });
}
