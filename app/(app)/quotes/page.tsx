import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { createQuote } from "@/lib/actions";
import { STATUS_LABEL, STATUS_DESK, canSeeMargin, type Status } from "@/lib/workflow";
import { compute, type Line, type RateItem, type Snapshot } from "@/lib/pricing";
import { money, shortDate, stamp } from "@/lib/format";
import { deskFiles } from "@/lib/desk";
import DeskFiles from "../desk-files";
import QuoteSearch from "./search";

type Row = {
  id: number; ref: string; title: string; client_name: string; status: Status;
  pax: number; arrival: string | null; departure: string | null;
  fx: number; margin_pct: number; flights_usd: number;
  snapshot: Snapshot | null; owner: string | null; updated_at: string;
};

function deskClass(status: Status) {
  const desk = STATUS_DESK[status];
  if (status === "lost" || status === "cancelled") return "dead";
  if (!desk) return "done";
  return desk;
}

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ desk?: string; denied?: string; deleted?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const showMargin = canSeeMargin(user.role);

  const mine = await deskFiles(user.role);
  const [rows, lines, rates] = await Promise.all([
    q<Row>(
      `SELECT qt.id, qt.ref, qt.title, qt.client_name, qt.status, qt.pax,
              qt.arrival, qt.departure, qt.fx::float8 AS fx, qt.margin_pct::float8 AS margin_pct,
              qt.flights_usd::float8 AS flights_usd, qt.snapshot, u.name AS owner, qt.updated_at
         FROM quotes qt LEFT JOIN users u ON u.id = qt.owner_id
        ORDER BY qt.updated_at DESC`
    ),
    q<Line & { quote_id: number }>(
      `SELECT quote_id, section, item_name, qty::float8 AS qty FROM quote_lines ORDER BY sort, id`
    ),
    q<RateItem>(
      `SELECT book, name, rate1::float8 AS rate1, rate2::float8 AS rate2, rate3::float8 AS rate3
         FROM rate_items WHERE NOT archived`
    ),
  ]);

  const linesByQuote = new Map<number, Line[]>();
  for (const l of lines) {
    const arr = linesByQuote.get(l.quote_id) ?? [];
    arr.push(l);
    linesByQuote.set(l.quote_id, arr);
  }

  const filter = sp.desk === "mine" ? "mine" : "all";
  const shown = filter === "mine"
    ? rows.filter(r => STATUS_DESK[r.status] === user.role)
    : rows;

  const priced = shown.map(r => {
    const t = r.snapshot
      ? r.snapshot.totals
      : compute({ pax: r.pax, fx: r.fx, margin_pct: r.margin_pct, flights_usd: r.flights_usd },
                linesByQuote.get(r.id) ?? [], rates);
    return { r, t, frozen: Boolean(r.snapshot) };
  });

  const openValue = priced
    .filter(p => !["lost", "cancelled", "closed"].includes(p.r.status))
    .reduce((s, p) => s + p.t.grpSell, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{user.role === "sales" ? "Sales" : "Quotes"}</h1>
          <p>
            {mine.length
              ? `${mine.length} on your desk`
              : "Nothing waiting on your desk"}
            {" · "}
            {money(openValue)} USD open across every stage
          </p>
        </div>
        <div className="actions">
          {rows.length > 4 && <QuoteSearch count={shown.length} />}
          <nav className="nav">
            <Link href="/quotes?desk=all" className={filter === "all" ? "on" : undefined}>Every file ({rows.length})</Link>
            <Link href="/quotes?desk=mine" className={filter === "mine" ? "on" : undefined}>Only mine</Link>
          </nav>
          {(user.role === "sales" || user.role === "admin") && (
            <form action={createQuote}><button className="btn btn-go" type="submit">New quote</button></form>
          )}
        </div>
      </div>

      {sp.deleted && (
        <div className="note" style={{ marginBottom: 16 }}>
          <div>{sp.deleted} deleted, along with everything recorded against it.</div>
        </div>
      )}

      {sp.denied && (
        <div className="note bad" style={{ marginBottom: 16 }}>
          <div>That isn&apos;t yours to do. Your role is <b>{user.role}</b>.</div>
        </div>
      )}

      <DeskFiles role={user.role} files={mine} />

      <div className="card">
        <h2>
          {filter === "mine" ? "Your files, every stage" : "Every file"}
          <span className="side">including finished and lost</span>
        </h2>
        {priced.length === 0 ? (
          <div className="empty">
            <b>{filter === "mine" ? "Your desk is clear" : "No quotes yet"}</b>
            {filter === "mine"
              ? "Nothing is waiting on you right now."
              : user.role === "sales" || user.role === "admin"
                ? "Press New quote to build the first one."
                : "Sales hasn't sent anything through yet."}
          </div>
        ) : (
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Quote</th>
                  <th>Stage</th>
                  <th>Travel</th>
                  <th>Pax</th>
                  <th>Per person</th>
                  <th>Group total</th>
                  {showMargin && <th>Margin</th>}
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {priced.map(({ r, t, frozen }) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/quotes/${r.id}`} className="qtitle">
                        {r.title || "Untitled quote"}
                      </Link>
                      <span className="qref">
                        {r.ref}{r.client_name ? ` · ${r.client_name}` : ""}{r.owner ? ` · ${r.owner}` : ""}
                      </span>
                    </td>
                    <td>
                      <span className={`pill ${deskClass(r.status)}`}>{STATUS_LABEL[r.status]}</span>
                      {frozen && <span className="pill frozen" style={{ marginLeft: 6 }}>Priced</span>}
                    </td>
                    <td>{r.arrival ? shortDate(r.arrival) : "—"}</td>
                    <td>{r.pax}</td>
                    <td>{money(t.sellPP)}</td>
                    <td>{money(t.grpSell)}</td>
                    {showMargin && <td>{money(t.grpProfit)}</td>}
                    <td>{stamp(r.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div id="noMatches" hidden className="empty">
              <b>Nothing matches</b>
              Try the file reference, the client, or part of the title.
            </div>
          </div>
        )}
      </div>

      <div className="note" style={{ marginTop: 16 }}>
        <div>
          The list above is every file in the system, whichever desk holds it. Quotes still with sales are
          priced against the <b>current</b> price book; from <b>Client accepted</b> onward they show the rates
          and exchange rate they were sold at, marked <b>Priced</b>.
        </div>
      </div>
    </>
  );
}
