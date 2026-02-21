// One-time script to sync games from JSON to database
import fs from 'fs';
import { insertGame, insertTeam, upsertPlayer, initDb } from './db_writer.mjs';

console.log('Loading data from JSON files...');

const ratingsData = JSON.parse(fs.readFileSync('public/data/ratings.json', 'utf8'));
const gamesData = JSON.parse(fs.readFileSync('public/data/all_games.json', 'utf8'));

console.log(`Found ${ratingsData.teams.length} teams and ${gamesData.games.length} games in JSON`);

// Initialize database
initDb();

// Sync teams
console.log('\nSyncing teams...');
for (const team of ratingsData.teams) {
  await insertTeam(team);
}

// Sync games
console.log('\nSyncing games...');
let gamesAdded = 0;
for (const game of gamesData.games) {
  try {
    await insertGame(game);
    gamesAdded++;
    if (gamesAdded % 100 === 0) {
      console.log(`Synced ${gamesAdded} games...`);
    }
  } catch (err) {
    // Game already exists, skip
  }
}

console.log(`\n✅ Sync complete! Added ${gamesAdded} games to database`);
