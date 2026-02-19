import { NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

const D1_CONFERENCES = [
  'acc', 'big-12', 'big-ten', 'sec', 'pac-12', 'big-east',
  'american', 'aac', 'wcc', 'mwc', 'mountain-west', 'atlantic-10', 'a-10',
  'mvc', 'mac', 'cusa', 'sun-belt', 'sunbelt', 'colonial', 'caa',
  'horizon', 'maac', 'ovc', 'patriot', 'southland', 'summit-league',
  'wac', 'big-sky', 'big-south', 'southern', 'socon',
  'big-west', 'ivy-league', 'meac', 'nec', 'northeast', 'swac',
  'asun', 'america-east', 'americaeast'
];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const { teamId } = await params;
  const { searchParams } = new URL(request.url);
  const confOnly = searchParams.get('conf') === 'true';
  const d1Only = searchParams.get('d1') === 'true';

  try {
    // Build WHERE clause
    let whereClause = 'WHERE (home_team_id = $1 OR away_team_id = $1)';
    
    if (confOnly) {
      whereClause += ' AND is_conference_game = true';
    }
    
    if (d1Only) {
      const confList = D1_CONFERENCES.map(c => `'${c}'`).join(',');
      whereClause += ` AND home_conference IN (${confList}) AND away_conference IN (${confList})`;
    }

    // Aggregate stats from filtered games
    const result = await pool.query(`
      SELECT
        COUNT(*) as games,
        SUM(CASE 
          WHEN home_team_id = $1 AND home_score > away_score THEN 1
          WHEN away_team_id = $1 AND away_score > home_score THEN 1
          ELSE 0
        END) as wins,
        SUM(CASE 
          WHEN home_team_id = $1 AND home_score < away_score THEN 1
          WHEN away_team_id = $1 AND away_score < home_score THEN 1
          ELSE 0
        END) as losses,
        
        -- Team stats when home
        SUM(CASE WHEN home_team_id = $1 THEN home_score ELSE 0 END) +
        SUM(CASE WHEN away_team_id = $1 THEN away_score ELSE 0 END) as points,
        
        SUM(CASE WHEN home_team_id = $1 THEN away_score ELSE 0 END) +
        SUM(CASE WHEN away_team_id = $1 THEN home_score ELSE 0 END) as opp_points,
        
        SUM(CASE WHEN home_team_id = $1 THEN home_fgm ELSE away_fgm END) as fgm,
        SUM(CASE WHEN home_team_id = $1 THEN home_fga ELSE away_fga END) as fga,
        SUM(CASE WHEN home_team_id = $1 THEN home_tpm ELSE away_tpm END) as tpm,
        SUM(CASE WHEN home_team_id = $1 THEN home_tpa ELSE away_tpa END) as tpa,
        SUM(CASE WHEN home_team_id = $1 THEN home_ftm ELSE away_ftm END) as ftm,
        SUM(CASE WHEN home_team_id = $1 THEN home_fta ELSE away_fta END) as fta,
        SUM(CASE WHEN home_team_id = $1 THEN home_orb ELSE away_orb END) as orb,
        SUM(CASE WHEN home_team_id = $1 THEN home_drb ELSE away_drb END) as drb,
        SUM(CASE WHEN home_team_id = $1 THEN home_trb ELSE away_trb END) as trb,
        SUM(CASE WHEN home_team_id = $1 THEN home_ast ELSE away_ast END) as ast,
        SUM(CASE WHEN home_team_id = $1 THEN home_stl ELSE away_stl END) as stl,
        SUM(CASE WHEN home_team_id = $1 THEN home_blk ELSE away_blk END) as blk,
        SUM(CASE WHEN home_team_id = $1 THEN home_tov ELSE away_tov END) as tov,
        SUM(CASE WHEN home_team_id = $1 THEN home_pf ELSE away_pf END) as pf,
        
        -- Opponent stats
        SUM(CASE WHEN home_team_id = $1 THEN away_fgm ELSE home_fgm END) as opp_fgm,
        SUM(CASE WHEN home_team_id = $1 THEN away_fga ELSE home_fga END) as opp_fga,
        SUM(CASE WHEN home_team_id = $1 THEN away_tpm ELSE home_tpm END) as opp_tpm,
        SUM(CASE WHEN home_team_id = $1 THEN away_tpa ELSE home_tpa END) as opp_tpa,
        SUM(CASE WHEN home_team_id = $1 THEN away_ftm ELSE home_ftm END) as opp_ftm,
        SUM(CASE WHEN home_team_id = $1 THEN away_fta ELSE home_fta END) as opp_fta,
        SUM(CASE WHEN home_team_id = $1 THEN away_orb ELSE home_orb END) as opp_orb,
        SUM(CASE WHEN home_team_id = $1 THEN away_drb ELSE home_drb END) as opp_drb,
        SUM(CASE WHEN home_team_id = $1 THEN away_trb ELSE home_trb END) as opp_trb,
        SUM(CASE WHEN home_team_id = $1 THEN away_ast ELSE home_ast END) as opp_ast,
        SUM(CASE WHEN home_team_id = $1 THEN away_stl ELSE home_stl END) as opp_stl,
        SUM(CASE WHEN home_team_id = $1 THEN away_blk ELSE home_blk END) as opp_blk,
        SUM(CASE WHEN home_team_id = $1 THEN away_tov ELSE home_tov END) as opp_tov,
        SUM(CASE WHEN home_team_id = $1 THEN away_pf ELSE home_pf END) as opp_pf
      FROM games
      ${whereClause}
    `, [teamId]);

    if (result.rows.length === 0 || result.rows[0].games === '0') {
      return NextResponse.json({ error: 'No games found' }, { status: 404 });
    }

    // Get team info
    const teamInfo = await pool.query('SELECT team_name, conference FROM teams WHERE team_id = $1', [teamId]);
    
    return NextResponse.json({
      teamId,
      teamName: teamInfo.rows[0]?.team_name || '',
      conference: teamInfo.rows[0]?.conference || '',
      ...result.rows[0]
    });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json({ error: 'Failed to fetch filtered stats' }, { status: 500 });
  }
}

export {};
