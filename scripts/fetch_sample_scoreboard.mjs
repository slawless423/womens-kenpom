import fs from "node:fs/promises";

const NCAA_API_BASE = "https://ncaa-api.henrygd.me";

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "baseline-analytics-bot",
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function main() {
  // Fetch a single day scoreboard to see conference data structure
  const scoreboard = await fetchJson(
    `${NCAA_API_BASE}/scoreboard/basketball-women/d1/2026/02/15/all-conf`
  );

  // Save full scoreboard for inspection
  await fs.mkdir("public/data", { recursive: true });
  await fs.writeFile(
    "public/data/sample_scoreboard.json",
    JSON.stringify(scoreboard, null, 2),
    "utf8"
  );

  console.log("✅ Saved sample_scoreboard.json");
  console.log("\nTop level keys:", Object.keys(scoreboard));

  // Find all unique keys in the scoreboard
  const allKeys = new Set();
  const walk = (x) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (x && typeof x === "object") {
      Object.keys(x).forEach(k => allKeys.add(k));
      Object.values(x).forEach(walk);
    }
  };
  walk(scoreboard);

  console.log("\nAll keys found in scoreboard:");
  console.log([...allKeys].sort().join(", "));

  // Specifically look for conference-related fields
  const confKeys = [...allKeys].filter(k => 
    k.toLowerCase().includes("conf") || 
    k.toLowerCase().includes("league") ||
    k.toLowerCase().includes("division")
  );
  console.log("\nConference-related keys:", confKeys);

  // Try to find a game and print its full structure
  const games = [];
  const findGames = (x) => {
    if (Array.isArray(x)) return x.forEach(findGames);
    if (x && typeof x === "object") {
      if (x.gameId || x.game_id || x.contestId) {
        games.push(x);
        return;
      }
      Object.values(x).forEach(findGames);
    }
  };
  findGames(scoreboard);

  if (games.length > 0) {
    console.log("\nFirst game object found:");
    console.log(JSON.stringify(games[0], null, 2).slice(0, 1000));
  }
}

main().catch(console.error);
