import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const { teamId } = await params;

  try {
    const result = await pool.query(`
      SELECT 
        player_id as "playerId",
        team_id as "teamId",
        team_name as "teamName",
        first_name as "firstName",
        last_name as "lastName",
        number,
        position,
        year,
        games,
        starts,
        minutes,
        fgm, fga, tpm, tpa, ftm, fta,
        orb, drb, trb, ast, stl, blk, tov, pf, points
      FROM players
      WHERE team_id = $1
      ORDER BY minutes DESC
    `, [teamId]);

    return NextResponse.json({ players: result.rows });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Failed to fetch players' }, { status: 500 });
  }
}
