import Link from "next/link";
import { headers } from "next/headers";

type Row = {
  team: string;
  teamId: string;
  games?: number;
  adjO?: number;
  adjD?: number;
  adjEM?: number;
  adjT?: number;
  [k: string]: any;
};

function n(x: any): number | null {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

async function loadRatings(): Promise<{ updated: string | null; rows: Row[] }> {
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const url = `${proto}://${host}/data/ratings.json`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ratings.json (${res.status})`);
  const payload = await res.json();

  const rows: Row[] =
    payload?.rows ??
    payload?.data?.rows ??
    payload?.ratings?.rows ??
    payload?.result?.rows ??
    [];

  const updated =
    payload?.generated_at_utc ??
    payload?.generated_at ??
    payload?.updated_at ??
    payload?.last_updated ??
    null;

  return { updated, rows };
}

export default async function TeamPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const data = await loadRatings();
  const row = data.rows.find((r) => String(r.teamId) === String(teamId));

  if (!row) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <Link href="/">← Back</Link>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginTop: 12 }}>Team not found</h1>
        <p style={{ opacity: 0.8 }}>TeamId: {teamId}</p>
      </main>
    );
  }

  const adjO = n(row.adjO);
  const adjD = n(row.adjD);
  const adjEM = n(row.adjEM);
  const adjT = n(row.adjT);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <Link href="/">← Back to ratings</Link>

      <h1 style={{ fontSize: 32, fontWeight: 800, marginTop: 12 }}>
        {row.team}
      </h1>

      <p style={{ opacity: 0.75 }}>
        Updated: {data.updated ?? "—"} • TeamId: {row.teamId}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 12, marginTop: 16 }}>
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <div style={{ opacity: 0.7 }}>Games</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{row.games ?? "—"}</div>
        </div>
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <div style={{ opacity: 0.7 }}>AdjO</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{adjO === null ? "—" : adjO.toFixed(1)}</div>
        </div>
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <div style={{ opacity: 0.7 }}>AdjD</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{adjD === null ? "—" : adjD.toFixed(1)}</div>
        </div>
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <div style={{ opacity: 0.7 }}>AdjEM</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{adjEM === null ? "—" : adjEM.toFixed(1)}</div>
        </div>
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
          <div style={{ opacity: 0.7 }}>Tempo</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{adjT === null ? "—" : adjT.toFixed(1)}</div>
        </div>
      </div>

      <div style={{ marginTop: 18, padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Next upgrade</div>
        <div style={{ opacity: 0.85 }}>
          Add a game log (date, opponent, score, ORtg/DRtg) by generating per-team files during the nightly build.
        </div>
      </div>
    </main>
  );
}
