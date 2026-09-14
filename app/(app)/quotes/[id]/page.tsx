import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { moveQuote, addNote } from "@/lib/actions";
import {
  allowedTransitions, canEditQuote, canSeeMargin, STATUS_LABEL, STATUS_DESK, type Status,
} from "@/lib/workflow";
import { compute, SECTIONS, SECTION_ORDER, type Line, type RateItem, type Snapshot } from "@/lib/pricing";
import { money, shortDate, stamp } from "@/lib/format";
import QuoteEditor from "./editor";

type QuoteRow = {
  id: number; ref: string; title: string; client_name: string; status: Status;
  pax: number; arrival: string | null; departure: string | null;
  fx: number; margin_pct: number; flights_usd: number;
  snapshot: Snapshot | null; accepted_at: string | null;
  owner: string | null; created_at: string;
};

type Event = {
  id: number; kind: string; from_status: Status | null; to_status: Status | null;
  note: string; created_at: string; who: string | null;
};

export default async function QuotePage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ denied?: string; saved?: string }>;
}) {
  const user = await requireUser();
  const { id: idParam } = await params;
  const sp = await searchParams;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const quote = await one<QuoteRow>(
    `SELECT qt.id, qt.ref, qt.title, qt.client_name, qt.status, qt.pax, qt.arrival, qt.departure,
            qt.fx::float8 AS fx, qt.margin_pct::float8 AS margin_pct, qt.flights_usd::float8 AS flights_usd,
            qt.snapshot, qt.accepted_at, qt.created_at, u.name AS owner
       FROM quotes qt LEFT JOIN users u ON u.id = qt.owner_id
      WHERE qt.id = $1`, [id]
  );
  if (!quote) notFound();

  const [lines, rates, events] = await Promise.all([
    q<Line>(`SELECT section, item_name, qty::float8 AS qty FROM quote_lines WHERE quote_id=$1 ORDER BY sort, id`, [id]),
    q<RateItem>(`SELECT book, name, rate1::float8 AS rate1, rate2::float8 AS rate2, rate3::float8 AS rate3
                   FROM rate_items WHERE NOT archived ORDER BY book, name`),
    q<Event>(`SELECT e.id, e.kind, e.from_status, e.to_status, e.note, e.created_at, u.name AS who
                FROM quote_events e LEFT JOIN users u ON u.id = e.user_id
               WHERE e.quote_id=$1 ORDER BY e.created_at DESC, e.id DESC`, [id]),
  ]);

  const editable = canEditQuote(quote.status, user.role);
  const showMargin = canSeeMargin(user.role);
  const moves = allowedTransitions(quote.status, user.role);
  const frozen = Boolean(quote.snapshot);

  const terms = { pax: quote.pax, fx: quote.fx, margin_pct: quote.margin_pct, flights_usd: quote.flights_usd };
  const totals = quote.snapshot ? quote.snapshot.totals : compute(terms, lines, rates);

  // Once frozen, show what today's book would cost — the gap is the exposure.
  const live = frozen ? compute(terms, lines, rates) : null;
  const drift = live ? live.costPP - totals.costPP : 0;

  const desk = STATUS_DESK[quote.status];
  const deskClass = quote.status === "lost" || quote.status === "cancelled" ? "dead" : desk ?? "done";

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{quote.title || "Untitled quote"}</h1>
          <p>
            <span className="tabular">{quote.ref}</span>
            {quote.client_name && ` · ${quote.client_name}`}
            {quote.owner && ` · owned by ${quote.owner}`}
            {quote.arrival && ` · ${shortDate(quote.arrival)}`}
            {quote.departure && ` → ${shortDate(quote.departure)}`}
          </p>
        </div>
        <div className="actions" style={{ alignItems: "center" }}>
          <span className={`pill ${deskClass}`}>{STATUS_LABEL[quote.status]}</span>
          {frozen && <span className="pill frozen">Priced {quote.accepted_at ? stamp(quote.accepted_at) : ""}</span>}
          <Link href="/quotes" className="btn btn-sm">All quotes</Link>
        </div>
      </div>

      {sp.denied && (
        <div className="note bad" style={{ marginBottom: 16 }}>
          <div>That isn&apos;t yours to do at this stage. Your role is <b>{user.role}</b>.</div>
        </div>
      )}
      {sp.saved && (
        <div className="note" style={{ marginBottom: 16 }}><div>Quote saved.</div></div>
      )}

      {moves.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Move this quote on<span className="side">{user.role}</span></h2>
          <div className="body" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {moves.map(m => (
              <form action={moveQuote} key={m.to} style={{ display: "contents" }}>
                <input type="hidden" name="id" value={quote.id} />
                <input type="hidden" name="to" value={m.to} />
                <button className={`btn btn-${m.tone ?? "warn"}`} type="submit" title={m.hint}>{m.label}</button>
              </form>
            ))}
            {moves.some(m => m.hint) && (
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)", flexBasis: "100%" }}>
                {moves.find(m => m.hint)?.hint}
              </p>
            )}
          </div>
        </div>
      )}

      {frozen && (
        <div className="note frozen" style={{ marginBottom: 16 }}>
          <div>
            <b>Prices are locked.</b> This quote was sold at {money(totals.fx, 2)} EGP/USD with the rates in force
            on {quote.accepted_at ? shortDate(quote.accepted_at) : "acceptance"}. Editing the price book no longer
            changes it.
            {live && Math.abs(drift) >= 0.01 && (
              <>
                {" "}At today&apos;s rates the same itinerary would cost{" "}
                <b className="tabular">{money(live.costPP)} USD</b> per person —{" "}
                {drift > 0 ? "a" : "an"} <b className="tabular">{money(Math.abs(drift))} USD</b>{" "}
                {drift > 0 ? "increase" : "saving"} you are {drift > 0 ? "absorbing" : "gaining"}.
              </>
            )}
          </div>
        </div>
      )}

      {editable ? (
        <QuoteEditor
          quote={{
            id: quote.id, title: quote.title, client_name: quote.client_name, pax: quote.pax,
            arrival: quote.arrival ? String(quote.arrival).slice(0, 10) : null,
            departure: quote.departure ? String(quote.departure).slice(0, 10) : null,
            fx: quote.fx, margin_pct: quote.margin_pct, flights_usd: quote.flights_usd,
          }}
          initialLines={lines}
          rates={rates}
          showMargin={showMargin}
        />
      ) : (
        <ReadOnlyQuote quote={quote} lines={lines} rates={rates} totals={totals} showMargin={showMargin} frozen={frozen} />
      )}

      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) 330px", marginTop: 16, alignItems: "start" }}>
        <div className="card">
          <h2>History<span className="side">{events.length} entries</span></h2>
          <div className="body">
            <ul className="trail">
              {events.map(e => (
                <li key={e.id}>
                  <span className="when">{stamp(e.created_at)}</span>
                  <span className="what">
                    {e.kind === "status" && e.to_status
                      ? <>Moved {e.from_status ? <>from <b>{STATUS_LABEL[e.from_status]}</b> </> : null}
                          to <b>{STATUS_LABEL[e.to_status]}</b>{e.note ? ` — ${e.note}` : ""}</>
                      : e.note}
                  </span>
                  <span className="who">{e.who ?? "—"}</span>
                </li>
              ))}
              {events.length === 0 && <li><span className="what">Nothing yet.</span></li>}
            </ul>
          </div>
        </div>
        <div className="card">
          <h2>Add a note</h2>
          <form action={addNote} className="body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input type="hidden" name="id" value={quote.id} />
            <textarea className="t" name="note" rows={3} maxLength={500}
                      placeholder="Anything the next desk needs to know" />
            <button className="btn" type="submit">Add note</button>
          </form>
        </div>
      </div>
    </>
  );
}

function ReadOnlyQuote({
  quote, lines, rates, totals, showMargin, frozen,
}: {
  quote: QuoteRow; lines: Line[]; rates: RateItem[];
  totals: ReturnType<typeof compute>; showMargin: boolean; frozen: boolean;
}) {
  // A frozen quote shows the unit prices it was sold at, not today's.
  const snapUnit = new Map<string, number>();
  if (quote.snapshot) for (const l of quote.snapshot.lines) snapUnit.set(`${l.section}|${l.item_name}`, l.unit);

  const unitFor = (section: Line["section"], name: string) => {
    const key = `${section}|${name}`;
    if (snapUnit.has(key)) return snapUnit.get(key)!;
    const r = rates.find(x => x.book === SECTIONS[section].book && x.name === name);
    if (!r) return 0;
    if (section === "transfers") return [r.rate1, r.rate2, r.rate3][quote.pax < 7 ? 0 : quote.pax < 16 ? 1 : 2] ?? 0;
    return r.rate1;
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) 330px", alignItems: "start" }}>
      <div className="card">
        <h2>Itinerary<span className="side">{frozen ? "Sold prices" : "Current prices"}</span></h2>
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr><th>Item</th><th>Qty</th><th>Unit</th><th>Amount</th></tr>
            </thead>
            <tbody>
              {SECTION_ORDER.map(section => {
                const rows = lines.filter(l => l.section === section);
                if (!rows.length) return null;
                const dp = section === "acc" ? 2 : 0;
                return (
                  <Fragment key={section}>
                    <tr>
                      <td colSpan={4} style={{ background: "var(--surface-2)", fontWeight: 600, textAlign: "left" }}>
                        {SECTIONS[section].label}
                        <span className="qref" style={{ display: "inline", marginLeft: 8 }}>{SECTIONS[section].cur}</span>
                      </td>
                    </tr>
                    {rows.map((l, i) => {
                      const u = unitFor(section, l.item_name);
                      return (
                        <tr key={`${section}-${i}`}>
                          <td style={{ paddingLeft: 28 }}>{l.item_name}</td>
                          <td>{l.qty}</td>
                          <td>{money(u, dp)}</td>
                          <td>{money(u * l.qty, dp)}</td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="card">
        <h2>Pricing<span className="side">Per person</span></h2>
        <div className="body" style={{ padding: "6px 16px 12px" }}>
          <div className="lrow"><span className="k">Accommodation</span><span className="v">{money(totals.accUSD)} USD</span></div>
          <div className="lrow"><span className="k">EGP services converted</span><span className="v">{money(totals.lePP / totals.fx)} USD</span></div>
          <div className="lrow"><span className="k">Domestic flights</span><span className="v">{money(totals.flights)} USD</span></div>
          <div className="lrow rule total"><span className="k">Net cost</span><span className="v">{money(totals.costPP)} USD</span></div>
          {showMargin && (
            <div className="lrow"><span className="k">Margin<em>{money(totals.marginPct, 1)}%</em></span>
              <span className="v">+ {money(totals.sellPP - totals.costPP)} USD</span></div>
          )}
        </div>
        <div className="headline">
          <div className="cap">Quotation · per person in DBL</div>
          <div className="fig">{money(totals.sellPP)}<span className="cc">USD</span></div>
          <div className="note" style={{ background: "none", border: 0, padding: 0, marginTop: 6 }}>
            {totals.pax} pax · {money(totals.fx, 2)} EGP/USD
          </div>
        </div>
        <div className="cellgrid">
          <div className="cell"><div className="cap">Single supp.</div><div className="val">{money(totals.sglSell)}</div></div>
          <div className="cell"><div className="cap">Group total</div><div className="val">{money(totals.grpSell)}</div></div>
          {showMargin && (
            <>
              <div className="cell"><div className="cap">Net cost · group</div><div className="val">{money(totals.costPP * totals.pax)}</div></div>
              <div className="cell"><div className="cap">Estimated profit</div><div className="val pos">+{money(totals.grpProfit)}</div></div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
