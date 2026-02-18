import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

export async function GET() {
  try {
    const result = await pool.query(`
      SELECT 
        team_id as "teamId",
        team_name as "team",
        conference,
        games,
        adj_o as "adjO",
        adj_d as "adjD",
        adj_em as "adjEM",
        adj_t as "adjT"
      FROM teams
      WHERE conference IS NOT NULL 
        AND conference != ''
        AND conference IN (
          'acc', 'big-12', 'big-ten', 'sec', 'pac-12', 'big-east',
          'american', 'aac', 'wcc', 'mwc', 'mountain-west', 'atlantic-10', 'a-10',
          'mvc', 'mac', 'cusa', 'sun-belt', 'sunbelt', 'colonial', 'caa',
          'horizon', 'maac', 'ovc', 'patriot', 'southland', 'summit-league',
          'wac', 'big-sky', 'big-south', 'southern', 'socon',
          'big-west', 'ivy-league', 'meac', 'nec', 'northeast', 'swac',
          'asun', 'america-east', 'americaeast'
        )
      ORDER BY adj_em DESC
    `);

    return NextResponse.json({
      updated: new Date().toISOString(),
      rows: result.rows
    });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Failed to fetch teams' }, { status: 500 });
  }
}
