import Link from "next/link";
import { headers } from "next/headers";

// ===== TYPES =====
type RatingRow = {
  teamId: string;
  team: string;
  games: number;
  adjO: number;
  adjD: number;
  adjEM: number;
  adjT: number;
  conf?: string;
  [k: string]: any;
};

type TeamStats = {
  teamId: string;
  teamName: string;
  games: number;
  wins: number;
  losses: number;
  points: number;
  opp_points: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  orb: number;
  drb: number;
  trb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  opp_fgm: number;
  opp_fga: number;
  opp_tpm: number;
  opp_tpa: number;
  opp_ftm: number;
  opp_fta: number;
  opp_orb: number;
  opp_drb: number;
  opp_trb: number;
  opp_ast: number;
  opp_stl: number;
  opp_blk: number;
  opp_tov: number;
  opp_pf: number;
};

// ===== DATA LOADING =====
async function loadRatings(): Promise<{ updated: string | null; rows: RatingRow[] }> {
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const url = `${proto}://${host}/data/ratings.json`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ratings.json (${res.status})`);
  const payload = await res.json();
  const rows: RatingRow[] = payload?.rows ?? [];
  const updated = payload?.generated_at_utc ?? null;
  return { updated, rows };
}

async function loadTeamStats(): Promise<TeamStats[]> {
  try {
    const h = await headers();
    const host = h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "https";
    const url = `${proto}://${host}/data/team_stats.json`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const payload = await res.json();
    return payload?.teams ?? [];
  } catch {
    return [];
  }
}

// ===== MATH HELPERS =====
function n(x: any): number | null {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

function pct(num: number, den: number): number | null {
  if (!den) return null;
  return (num / den) * 100;
}

function poss(fga: number, orb: number, tov: number, fta: number): number {
  return Math.max(1, fga - orb + tov + 0.475 * fta);
}

// Four Factors calculations
function calcFourFactors(s: TeamStats) {
  const offPoss = poss(s.fga, s.orb, s.tov, s.fta);
  const defPoss = poss(s.opp_fga, s.opp_orb, s.opp_tov, s.opp_fta);

  return {
    // OFFENSE
    off: {
      efg: s.fga > 0 ? ((s.fgm - s.tpm + 1.5 * s.tpm) / s.fga) * 100 : null,
      tov: offPoss > 0 ? (s.tov / offPoss) * 100 : null,
      orb: (s.orb + s.opp_drb) > 0 ? (s.orb / (s.orb + s.opp_drb)) * 100 : null,
      ftrate: s.fga > 0 ? (s.fta / s.fga) * 100 : null,
      fg: pct(s.fgm, s.fga),
      twopm: s.fgm - s.tpm,
      twopa: s.fga - s.tpa,
      two: (s.fga - s.tpa) > 0 ? ((s.fgm - s.tpm) / (s.fga - s.tpa)) * 100 : null,
      three: pct(s.tpm, s.tpa),
      ft: pct(s.ftm, s.fta),
      blk: offPoss > 0 ? (s.blk / offPoss) * 100 : null,
      stl: offPoss > 0 ? (s.stl / offPoss) * 100 : null,
      ast: s.fgm > 0 ? (s.ast / s.fgm) * 100 : null,
    },
    // DEFENSE (opponent's offense against us)
    def: {
      efg: s.opp_fga > 0 ? ((s.opp_fgm - s.opp_tpm + 1.5 * s.opp_tpm) / s.opp_fga) * 100 : null,
      tov: defPoss > 0 ? (s.opp_tov / defPoss) * 100 : null,
      orb: (s.opp_orb + s.drb) > 0 ? (s.opp_orb / (s.opp_orb + s.drb)) * 100 : null,
      ftrate: s.opp_fga > 0 ? (s.opp_fta / s.opp_fga) * 100 : null,
      fg: pct(s.opp_fgm, s.opp_fga),
      two: (s.opp_fga - s.opp_tpa) > 0 ? ((s.opp_fgm - s.opp_tpm) / (s.opp_fga - s.opp_tpa)) * 100 : null,
      three: pct(s.opp_tpm, s.opp_tpa),
      ft: pct(s.opp_ftm, s.opp_fta),
      blk: defPoss > 0 ? (s.opp_blk / defPoss) * 100 : null,
      stl: defPoss > 0 ? (s.opp_stl / defPoss) * 100 : null,
      ast: s.opp_fgm > 0 ? (s.opp_ast / s.opp_fgm) * 100 : null,
    },
  };
}

function rankOf(
  rows: RatingRow[],
  value: number | null,
  key: string,
  higherIsBetter: boolean
): { rank: number; of: number } | null {
  if (value === null) return null;
  const vals = rows.map((r) => n(r[key])).filter((v): v is number => v !== null);
  if (!vals.length) return null;
  const sorted = [...vals].sort((a, b) => (higherIsBetter ? b - a : a - b));
  const idx = sorted.findIndex((v) => v === value);
  return idx === -1 ? null : { rank: idx + 1, of: sorted.length };
}

// ===== STYLES =====
const ACCENT = "#2d3748";
const ACCENT_LIGHT = "#f7f8fa";
const ACCENT_BORDER = "#d0d5de";

const S = {
  page: {
    padding: "24px 20px",
    fontFamily: "system-ui, -apple-system, sans-serif",
    maxWidth: 960,
    margin: "0 auto",
    color: "#111",
  } as React.CSSProperties,
  back: {
    fontSize: 13,
    color: ACCENT,
    textDecoration: "none",
    fontWeight: 600,
    opacity: 0.8,
  } as React.CSSProperties,
  header: {
    borderTop: `4px solid ${ACCENT}`,
    paddingTop: 16,
    marginTop: 12,
    marginBottom: 20,
  } as React.CSSProperties,
  teamName: {
    fontSize: 32,
    fontWeight: 900,
    letterSpacing: -0.5,
    color: "#111",
    marginBottom: 4,
  } as React.CSSProperties,
  teamMeta: {
    fontSize: 13,
    color: "#666",
    marginBottom: 10,
  } as React.CSSProperties,
  badges: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap" as const,
    marginBottom: 16,
  } as React.CSSProperties,
  badge: {
    background: ACCENT_LIGHT,
    border: `1px solid ${ACCENT_BORDER}`,
    padding: "3px 10px",
    borderRadius: 4,
    fontSize: 12,
    color: ACCENT,
    fontWeight: 600,
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: 12,
    fontWeight: 800,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    color: "#fff",
    background: ACCENT,
    padding: "6px 10px",
    marginTop: 20,
    marginBottom: 0,
  } as React.CSSProperties,
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 13,
  } as React.CSSProperties,
  th: {
    textAlign: "left" as const,
    padding: "7px 10px",
    fontSize: 11,
    fontWeight: 700,
    color: ACCENT,
    borderBottom: `2px solid ${ACCENT}`,
    background: ACCENT_LIGHT,
  } as React.CSSProperties,
  thRight: {
    textAlign: "right" as const,
    padding: "7px 10px",
    fontSize: 11,
    fontWeight: 700,
    color: ACCENT,
    borderBottom: `2px solid ${ACCENT}`,
    background: ACCENT_LIGHT,
  } as React.CSSProperties,
  td: {
    padding: "7px 10px",
    borderBottom: "1px solid #f0f0f0",
    color: "#333",
  } as React.CSSProperties,
  tdRight: {
    padding: "7px 10px",
    borderBottom: "1px solid #f0f0f0",
    textAlign: "right" as const,
    fontWeight: 600,
    color: "#111",
  } as React.CSSProperties,
  tdAvg: {
    padding: "7px 10px",
    borderBottom: "1px solid #f0f0f0",
    textAlign: "right" as const,
    color: "#999",
    fontSize: 12,
  } as React.CSSProperties,
  rank: {
    fontSize: 10,
    color: ACCENT,
    fontWeight: 700,
    marginLeft: 3,
    opacity: 0.8,
  } as React.CSSProperties,
  coreGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 10,
    margin: "16px 0",
  } as React.CSSProperties,
  coreCard: {
    background: ACCENT_LIGHT,
    border: `1px solid ${ACCENT_BORDER}`,
    borderRadius: 8,
    padding: "12px 14px",
  } as React.CSSProperties,
  cardLabel: {
    fontSize: 11,
    color: "#666",
    fontWeight: 600,
    marginBottom: 4,
    textTransform: "uppercase" as const,
    letterSpacing: 0.3,
  } as React.CSSProperties,
  cardValue: {
    fontSize: 22,
    fontWeight: 800,
    color: "#111",
    lineHeight: 1.1,
  } as React.CSSProperties,
  cardRank: {
    fontSize: 11,
    color: ACCENT,
    fontWeight: 700,
    marginTop: 4,
  } as React.CSSProperties,
  noData: {
    padding: "40px 20px",
    textAlign: "center" as const,
    color: "#888",
    background: ACCENT_LIGHT,
    borderRadius: 8,
    marginTop: 20,
  } as React.CSSProperties,
};

// ===== COMPONENTS =====
function fmt(v: number | null, decimals = 1): string {
  if (v === null) return "—";
  return v.toFixed(decimals);
}

function RankSpan({ r }: { r: { rank: number; of: number } | null }) {
  if (!r) return null;
  return <span style={S.rank}>#{r.rank}</span>;
}

function StatRow({
  label,
  offVal,
  defVal,
  avgVal,
  offRank,
  defRank,
  decimals = 1,
}: {
  label: string;
  offVal: number | null;
  defVal: number | null;
  avgVal: number | null;
  offRank?: { rank: number; of: number } | null;
  defRank?: { rank: number; of: number } | null;
  decimals?: number;
}) {
  return (
    <tr>
      <td style={S.td}>{label}</td>
      <td style={S.tdRight}>
        {fmt(offVal, decimals)}
        {offRank && <RankSpan r={offRank} />}
      </td>
      <td style={S.tdRight}>
        {fmt(defVal, decimals)}
        {defRank && <RankSpan r={defRank} />}
      </td>
      <td style={S.tdAvg}>{fmt(avgVal, decimals)}</td>
    </tr>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <tr>
      <td
        colSpan={4}
        style={{
          padding: "8px 10px",
          fontSize: 11,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          color: "#888",
          background: "#fafafa",
          borderBottom: "1px solid #eee",
          borderTop: "2px solid #eee",
        }}
      >
        {title}
      </td>
    </tr>
  );
}

// ===== AVERAGES (D-I average calculations) =====
function calcLeagueAverages(allTeamStats: TeamStats[]) {
  if (!allTeamStats.length) return null;

  const sum = (fn: (t: TeamStats) => number | null) => {
    const vals = allTeamStats.map(fn).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  const avgStats: TeamStats = allTeamStats.reduce(
    (acc, t) => {
      const keys = Object.keys(t) as (keyof TeamStats)[];
      keys.forEach((k) => {
        if (typeof t[k] === "number" && k !== "teamId") {
          (acc as any)[k] = ((acc as any)[k] ?? 0) + (t[k] as number);
        }
      });
      return acc;
    },
    { teamId: "avg", teamName: "Average" } as any
  );

  const count = allTeamStats.length;
  const keys = Object.keys(avgStats) as (keyof TeamStats)[];
  keys.forEach((k) => {
    if (typeof (avgStats as any)[k] === "number" && k !== "teamId") {
      (avgStats as any)[k] = (avgStats as any)[k] / count;
    }
  });

  return calcFourFactors(avgStats);
}

// ===== MAIN PAGE =====
export default async function TeamPage({
  params,
}: {
  params: Promise<{ teamid: string }>;
}) {
  const { teamid: teamId } = await params;
  const [{ updated, rows }, allTeamStats] = await Promise.all([
    loadRatings(),
    loadTeamStats(),
  ]);

  const row = rows.find((r) => String(r.teamId) === String(teamId));
  const teamStats = allTeamStats.find((t) => String(t.teamId) === String(teamId));

  if (!row) {
    return (
      <main style={S.page}>
        <Link href="/" style={S.back}>← Back to ratings</Link>
        <h1 style={{ fontSize: 28, fontWeight: 800, marginTop: 12 }}>Team not found</h1>
        <p style={{ opacity: 0.8, marginTop: 8 }}>TeamId: {teamId}</p>
      </main>
    );
  }

  const adjO = n(row.adjO);
  const adjD = n(row.adjD);
  const adjEM = n(row.adjEM);
  const adjT = n(row.adjT);
  const conf = row.conf ?? row.conference ?? "—";

  const emRank = rankOf(rows, adjEM, "adjEM", true);
  const oRank = rankOf(rows, adjO, "adjO", true);
  const dRank = rankOf(rows, adjD, "adjD", false);
  const tRank = rankOf(rows, adjT, "adjT", true);

  const ff = teamStats ? calcFourFactors(teamStats) : null;
  const leagueAvg = calcLeagueAverages(allTeamStats);

  const wins = teamStats?.wins ?? 0;
  const losses = teamStats?.losses ?? 0;

  // Format update date nicely
  const updatedDate = updated
    ? new Date(updated).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <main style={S.page}>
      <Link href="/" style={S.back}>← Back to ratings</Link>

      {/* HEADER */}
      <div style={S.header}>
        <div style={S.teamName}>{row.team}</div>
        <div style={S.teamMeta}>
          {conf !== "—" ? `${conf} • ` : ""}
          {emRank ? `#${emRank.rank} of ${emRank.of} teams` : ""}
          {updatedDate ? ` • Data through ${updatedDate}` : ""}
        </div>
        <div style={S.badges}>
          {wins + losses > 0 && (
            <span style={S.badge}>{wins}-{losses}</span>
          )}
          {row.games > 0 && (
            <span style={S.badge}>{row.games} games</span>
          )}
          {conf !== "—" && (
            <span style={S.badge}>{conf}</span>
          )}
        </div>
      </div>

      {/* CORE RATINGS */}
      <div style={S.sectionTitle}>Core Ratings</div>
      <div style={S.coreGrid}>
        <div style={S.coreCard}>
          <div style={S.cardLabel}>Adj. Offense</div>
          <div style={S.cardValue}>{fmt(adjO)}</div>
          {oRank && <div style={S.cardRank}>#{oRank.rank} of {oRank.of}</div>}
        </div>
        <div style={S.coreCard}>
          <div style={S.cardLabel}>Adj. Defense</div>
          <div style={S.cardValue}>{fmt(adjD)}</div>
          {dRank && <div style={S.cardRank}>#{dRank.rank} of {dRank.of}</div>}
        </div>
        <div style={S.coreCard}>
          <div style={S.cardLabel}>Efficiency Margin</div>
          <div style={S.cardValue}>{adjEM !== null ? (adjEM > 0 ? "+" : "") + fmt(adjEM) : "—"}</div>
          {emRank && <div style={S.cardRank}>#{emRank.rank} of {emRank.of}</div>}
        </div>
        <div style={S.coreCard}>
          <div style={S.cardLabel}>Adj. Tempo</div>
          <div style={S.cardValue}>{fmt(adjT)}</div>
          {tRank && <div style={S.cardRank}>#{tRank.rank} of {tRank.of}</div>}
        </div>
      </div>

      {/* SCOUTING REPORT TABLE */}
      {ff ? (
        <>
          <div style={S.sectionTitle}>Scouting Report</div>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Category</th>
                <th style={S.thRight}>Offense</th>
                <th style={S.thRight}>Defense</th>
                <th style={{ ...S.thRight, color: "#999", fontWeight: 600 }}>D-I Avg</th>
              </tr>
            </thead>
            <tbody>
              {/* FOUR FACTORS */}
              <SectionHeader title="Four Factors" />
              <StatRow
                label="Effective FG%"
                offVal={ff.off.efg}
                defVal={ff.def.efg}
                avgVal={leagueAvg?.off.efg ?? null}
              />
              <StatRow
                label="Turnover %"
                offVal={ff.off.tov}
                defVal={ff.def.tov}
                avgVal={leagueAvg?.off.tov ?? null}
              />
              <StatRow
                label="Off. Reb. %"
                offVal={ff.off.orb}
                defVal={ff.def.orb}
                avgVal={leagueAvg?.off.orb ?? null}
              />
              <StatRow
                label="FTA / FGA"
                offVal={ff.off.ftrate}
                defVal={ff.def.ftrate}
                avgVal={leagueAvg?.off.ftrate ?? null}
              />

              {/* SHOOTING */}
              <SectionHeader title="Shooting" />
              <StatRow
                label="FG%"
                offVal={ff.off.fg}
                defVal={ff.def.fg}
                avgVal={leagueAvg?.off.fg ?? null}
              />
              <StatRow
                label="2P%"
                offVal={ff.off.two}
                defVal={ff.def.two}
                avgVal={leagueAvg?.off.two ?? null}
              />
              <StatRow
                label="3P%"
                offVal={ff.off.three}
                defVal={ff.def.three}
                avgVal={leagueAvg?.off.three ?? null}
              />
              <StatRow
                label="FT%"
                offVal={ff.off.ft}
                defVal={ff.def.ft}
                avgVal={leagueAvg?.off.ft ?? null}
              />

              {/* MISCELLANEOUS */}
              <SectionHeader title="Miscellaneous" />
              <StatRow
                label="Block %"
                offVal={ff.off.blk}
                defVal={ff.def.blk}
                avgVal={leagueAvg?.off.blk ?? null}
              />
              <StatRow
                label="Steal %"
                offVal={ff.off.stl}
                defVal={ff.def.stl}
                avgVal={leagueAvg?.off.stl ?? null}
              />
              <StatRow
                label="Assist %"
                offVal={ff.off.ast}
                defVal={ff.def.ast}
                avgVal={leagueAvg?.off.ast ?? null}
              />
            </tbody>
          </table>
        </>
      ) : (
        <div style={S.noData}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Detailed stats not yet available</div>
          <div style={{ fontSize: 13 }}>
            Run <code>build_complete_stats.mjs</code> to generate team_stats.json
          </div>
        </div>
      )}

      {/* RECORD BREAKDOWN */}
      {teamStats && (
        <>
          <div style={S.sectionTitle}>Season Totals</div>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Stat</th>
                <th style={S.thRight}>Team</th>
                <th style={S.thRight}>Opponent</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={S.td}>Points</td>
                <td style={S.tdRight}>{teamStats.points.toLocaleString()}</td>
                <td style={S.tdRight}>{teamStats.opp_points.toLocaleString()}</td>
              </tr>
              <tr>
                <td style={S.td}>Field Goals (M-A)</td>
                <td style={S.tdRight}>{teamStats.fgm}-{teamStats.fga}</td>
                <td style={S.tdRight}>{teamStats.opp_fgm}-{teamStats.opp_fga}</td>
              </tr>
              <tr>
                <td style={S.td}>3-Pointers (M-A)</td>
                <td style={S.tdRight}>{teamStats.tpm}-{teamStats.tpa}</td>
                <td style={S.tdRight}>{teamStats.opp_tpm}-{teamStats.opp_tpa}</td>
              </tr>
              <tr>
                <td style={S.td}>Free Throws (M-A)</td>
                <td style={S.tdRight}>{teamStats.ftm}-{teamStats.fta}</td>
                <td style={S.tdRight}>{teamStats.opp_ftm}-{teamStats.opp_fta}</td>
              </tr>
              <tr>
                <td style={S.td}>Rebounds</td>
                <td style={S.tdRight}>{teamStats.trb}</td>
                <td style={S.tdRight}>{teamStats.opp_trb}</td>
              </tr>
              <tr>
                <td style={S.td}>Assists</td>
                <td style={S.tdRight}>{teamStats.ast}</td>
                <td style={S.tdRight}>{teamStats.opp_ast}</td>
              </tr>
              <tr>
                <td style={S.td}>Steals</td>
                <td style={S.tdRight}>{teamStats.stl}</td>
                <td style={S.tdRight}>{teamStats.opp_stl}</td>
              </tr>
              <tr>
                <td style={S.td}>Blocks</td>
                <td style={S.tdRight}>{teamStats.blk}</td>
                <td style={S.tdRight}>{teamStats.opp_blk}</td>
              </tr>
              <tr>
                <td style={S.td}>Turnovers</td>
                <td style={S.tdRight}>{teamStats.tov}</td>
                <td style={S.tdRight}>{teamStats.opp_tov}</td>
              </tr>
              <tr>
                <td style={S.td}>Personal Fouls</td>
                <td style={S.tdRight}>{teamStats.pf}</td>
                <td style={S.tdRight}>{teamStats.opp_pf}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      <div style={{ marginTop: 24, fontSize: 12, color: "#aaa", textAlign: "center" }}>
        womens-kenpom • Data from NCAA API • {updatedDate ?? ""}
      </div>
    </main>
  );
}
