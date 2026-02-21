#!/usr/bin/env node
// Writes all data from JSON files to database
import fs from 'fs';
import { initDb, upsertTeam, insertGame, upsertPlayer, closeDb } from './db_writer.mjs';

async function main() {
  console.log('📊 Starting database sync...\n');
  
  // Initialize database
  initDb();
  
  // Read JSON files
  console.log('Reading JSON files...');
  const ratingsData = JSON.parse(fs.readFileSync('public/data/ratings.json', 'utf8'));
  const gamesData = JSON.parse(fs.readFileSync('public/data/all_games.json', 'utf8'));
  const playersData = JSON.parse(fs.readFileSync('public/data/all_players.json', 'utf8'));
  
  console.log(`Found ${ratingsData.teams.length} teams`);
  console.log(`Found ${gamesData.games.length} games`);
  console.log(`Found ${playersData.players.length} players\n`);
  
  // Write teams
  console.log('Writing teams...');
  for (const team of ratingsData.teams) {
    await upsertTeam(team);
  }
  console.log('✅ Teams written\n');
  
  // Write games
  console.log('Writing games...');
  let gamesWritten = 0;
  for (const game of gamesData.games) {
    try {
      await insertGame(game);
      gamesWritten++;
      if (gamesWritten % 500 === 0) {
        console.log(`  ${gamesWritten} games written...`);
      }
    } catch (err) {
      // Game already exists (ON CONFLICT DO NOTHING)
    }
  }
  console.log(`✅ ${gamesWritten} games written\n`);
  
  // Write players
  console.log('Writing players...');
  for (const player of playersData.players) {
    await upsertPlayer(player);
  }
  console.log('✅ Players written\n');
  
  await closeDb();
  console.log('🎉 Database sync complete!');
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
