import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { moveQuote, addNote, duplicateQuote } from "@/lib/actions";
import {
  allowedTransitions, blockedReason, canEditQuote, canSeeMargin,
  STATUS_LABEL, STATUS_DESK, type Status,
} from "@/lib/workflow";
import { outstanding, variance, type Booking, type Supplier } from "@/lib/bookings";
import {
  realised, receivable, supplierBalances,
  type Invoice, type Receipt, type SupplierPayment,
} from "@/lib/money";
import Services from "./services";
import DeleteFile from "./delete-file";
import { Receivables, Payables } from "./money";
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
  searchParams: Promise<{ denied?: string; saved?: string; booked?: string; blocked?: string; needsref?: string; money?: string; badamount?: string; hasmoney?: string; copied?: string }>;
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

  const [lines, rates, events, bookings, suppliers, invoices, receipts, payments] = await Promise.all([
    q<Line>(`SELECT section, item_name, qty::float8 AS qty FROM quote_lines WHERE quote_id=$1 ORDER BY sort, id`, [id]),
    q<RateItem>(`SELECT book, name, rate1::float8 AS rate1, rate2::float8 AS rate2, rate3::float8 AS rate3
                   FROM rate_items WHERE NOT archived ORDER BY book, name`),
    q<Event>(`SELECT e.id, e.kind, e.from_status, e.to_status, e.note, e.created_at, u.name AS who
                FROM quote_events e LEFT JOIN users u ON u.id = e.user_id
               WHERE e.quote_id=$1 ORDER BY e.created_at DESC, e.id DESC`, [id]),
    q<Booking>(`SELECT b.id, b.quote_id, b.section, b.item_name, b.qty::float8 AS qty, b.sort,
                       b.supplier_id, s.name AS supplier_name, b.status, b.confirmation_no,
                       b.service_date, b.currency, b.quoted_cost::float8 AS quoted_cost,
                       b.actual_cost::float8 AS actual_cost, b.notes
                  FROM bookings b LEFT JOIN suppliers s ON s.id = b.supplier_id
                 WHERE b.quote_id=$1 ORDER BY b.sort, b.id`, [id]),
    q<Supplier>(`SELECT id, name, kind, phone, email, notes, archived FROM suppliers
                  WHERE NOT archived ORDER BY name`),
    q<Invoice>(`SELECT i.id, i.quote_id, i.number, i.kind, i.status, i.currency,
                       i.amount::float8 AS amount, i.issued_on, i.due_on, i.notes,
                       COALESCE((SELECT SUM(r.amount) FROM receipts r WHERE r.invoice_id = i.id),0)::float8 AS received
                  FROM invoices i WHERE i.quote_id=$1 ORDER BY i.id`, [id]),
    q<Receipt>(`SELECT r.id, r.invoice_id, r.amount::float8 AS amount, r.currency, r.received_on,
                       r.method, r.reference, r.notes, u.name AS who
                  FROM receipts r
                  JOIN invoices i ON i.id = r.invoice_id
                  LEFT JOIN users u ON u.id = r.recorded_by
                 WHERE i.quote_id=$1 ORDER BY r.received_on DESC, r.id DESC`, [id]),
    q<SupplierPayment>(`SELECT p.id, p.quote_id, p.supplier_id, s.name AS supplier_name,
                               p.amount::float8 AS amount, p.currency, p.fx_rate::float8 AS fx_rate,
                               p.paid_on, p.method, p.reference, p.notes, u.name AS who
                          FROM supplier_payments p
                          LEFT JOIN suppliers s ON s.id = p.supplier_id
                          LEFT JOIN users u ON u.id = p.recorded_by
                         WHERE p.quote_id=$1 ORDER BY p.paid_on DESC, p.id DESC`, [id]),
  ]);

  const editable = canEditQuote(quote.status, user.role);
  const showMargin = canSeeMargin(user.role);
  const recv = receivable(invoices, quote.fx);
  const moves = allowedTransitions(quote.status, user.role)
    .map(m => ({ ...m, blocked: blockedReason(m, bookings, recv) }));
  const balances = supplierBalances(bookings, payments);
  const financeCanEdit = user.role === "finance" || user.role === "admin";
  const seesClientMoney = user.role === "sales" || financeCanEdit;
  const seesSupplierMoney = user.role === "ops" || financeCanEdit;
  const earned = showMargin && invoices.length
    ? realised(invoices, bookings, payments, quote.fx, quote.flights_usd * quote.pax)
    : null;
  const opsCanEdit = user.role === "ops" || user.role === "admin";
  const openServices = outstanding(bookings);
  const costs = bookings.length ? variance(bookings, quote.fx) : null;
  const frozen = Boolean(quote.snapshot);

  const terms = { pax: quote.pax, fx: quote.fx, margin_pct: quote.margin_pct, flights_usd: quote.flights_usd };
  const totals = quote.snapshot ? quote.snapshot.totals : compute(terms, lines, rates);
  // A part-invoiced file would otherwise report an alarming margin that simply
  // reflects the rest of the invoicing not having happened yet.
  const fullyInvoiced = !earned || earned.revenueUSD >= totals.grpSell - 0.005;

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
          {(user.role === "sales" || user.role === "admin") && (
            <form action={duplicateQuote}>
              <input type="hidden" name="id" value={quote.id} />
              <input type="hidden" name="ref" value={quote.ref} />
              <button className="btn btn-sm" type="submit"
                      title="Start a new quote from this itinerary">Duplicate</button>
            </form>
          )}
          <Link href="/quotes" className="btn btn-sm">All quotes</Link>
          {user.role === "admin" && <DeleteFile id={quote.id} reference={quote.ref} />}
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
      {sp.copied && (
        <div className="note" style={{ marginBottom: 16 }}>
          <div>Copied. The itinerary came across — set the client and the dates for this one.</div>
        </div>
      )}
      {sp.booked && (
        <div className="note" style={{ marginBottom: 16 }}><div>Service updated.</div></div>
      )}
      {sp.blocked && (
        <div className="note bad" style={{ marginBottom: 16 }}>
          <div>That move is blocked: {moves.find(m => m.blocked)?.blocked ?? "something still needs finishing."}</div>
        </div>
      )}
      {sp.needsref && (
        <div className="note bad" style={{ marginBottom: 16 }}>
          <div>A confirmed booking needs both a supplier and their confirmation number.</div>
        </div>
      )}
      {sp.money && (
        <div className="note" style={{ marginBottom: 16 }}><div>Recorded.</div></div>
      )}
      {sp.badamount && (
        <div className="note bad" style={{ marginBottom: 16 }}><div>Enter an amount greater than zero.</div></div>
      )}
      {sp.hasmoney && (
        <div className="note bad" style={{ marginBottom: 16 }}>
          <div>
            This file cannot be deleted: money has been recorded against it. Remove the receipts and
            supplier payments first if it really was only a test.
          </div>
        </div>
      )}

      {moves.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Move this quote on<span className="side">{user.role}</span></h2>
          <div className="body" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {moves.map(m => (
              <form action={moveQuote} key={m.to} style={{ display: "contents" }}>
                <input type="hidden" name="id" value={quote.id} />
                <input type="hidden" name="to" value={m.to} />
                <button className={`btn btn-${m.tone ?? "warn"}`} type="submit"
                        disabled={Boolean(m.blocked)} title={m.blocked ?? m.hint}>
                  {m.label}
                </button>
              </form>
            ))}
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)", flexBasis: "100%" }}>
              {moves.find(m => m.blocked)?.blocked ?? moves.find(m => m.hint)?.hint}
            </p>
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

      {bookings.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div className="page-head" style={{ marginBottom: 12 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 17, letterSpacing: "-.01em" }}>Services to operate</h2>
              <p style={{ margin: "3px 0 0", color: "var(--muted)", fontSize: 13 }}>
                {openServices === 0
                  ? "Every service is settled — the file can go to finance."
                  : `${openServices} of ${bookings.length} still to confirm.`}
                {!opsCanEdit && " Operations maintains this."}
              </p>
            </div>
            <div className="actions">
              <Link href={`/quotes/${quote.id}/vouchers`} className="btn btn-sm">Vouchers</Link>
            </div>
          </div>

          {costs && costs.priced > 0 && (
            <div className={`note${Math.abs(costs.diffUSD) >= 0.5 ? " frozen" : ""}`} style={{ marginBottom: 14 }}>
              <div>
                <b>Cost so far:</b> suppliers quoted{" "}
                <span className="tabular">{money(costs.quotedUSD)} USD</span>, actuals recorded on{" "}
                {costs.priced} of {costs.total} services put it at{" "}
                <span className="tabular">{money(costs.actualUSD)} USD</span>
                {Math.abs(costs.diffUSD) >= 0.5 && (
                  <> — <b className="tabular">{money(Math.abs(costs.diffUSD))} USD</b>{" "}
                    {costs.diffUSD > 0 ? "over" : "under"} what was sold</>
                )}.
                {" "}Converted at the file&apos;s own {money(quote.fx, 2)} EGP/USD, so this is supplier movement, not currency.
              </div>
            </div>
          )}

          <Services quoteRef={quote.ref} bookings={bookings} suppliers={suppliers} editable={opsCanEdit} />
        </div>
      )}

      {(seesClientMoney || seesSupplierMoney) && quote.snapshot && (
        <div style={{ marginTop: 22 }}>
          <div className="page-head" style={{ marginBottom: 12 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 17, letterSpacing: "-.01em" }}>Money</h2>
              <p style={{ margin: "3px 0 0", color: "var(--muted)", fontSize: 13 }}>
                {financeCanEdit
                  ? "Recorded here, moved by your bank. This system never touches funds."
                  : "Finance maintains this."}
              </p>
            </div>
          </div>

          {earned && (
            <div className="card" style={{ marginBottom: 14 }}>
              <h2>What this file actually earned<span className="side">Realised</span></h2>
              <div className="cellgrid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", borderTop: 0 }}>
                <div className="cell">
                  <div className="cap">Invoiced</div>
                  <div className="val">{money(earned.revenueUSD)}</div>
                </div>
                <div className="cell">
                  <div className="cap">Cost at sold rate</div>
                  <div className="val">{money(earned.costAtSoldRateUSD)}</div>
                </div>
                <div className="cell">
                  <div className="cap">Cost as paid</div>
                  <div className="val">{money(earned.costAtPaidRateUSD)}</div>
                </div>
                <div className="cell">
                  <div className="cap">{fullyInvoiced ? "Realised margin" : "Margin so far"}</div>
                  <div className={`val ${earned.marginUSD >= 0 ? "pos" : ""}`}
                       style={earned.marginUSD < 0 ? { color: "var(--crit)" } : undefined}>
                    {earned.marginUSD >= 0 ? "+" : ""}{money(earned.marginUSD)}
                    <span style={{ fontSize: 11, color: "var(--faint)", marginLeft: 6 }}>
                      {money(earned.marginPct, 1)}%
                    </span>
                  </div>
                </div>
              </div>
              <div className="body" style={{ borderTop: "1px solid var(--line)" }}>
                <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>
                  {!fullyInvoiced && (
                    <><b style={{ color: "var(--warn)" }}>Not the final figure.</b>{" "}
                      Only {money(earned.revenueUSD)} of the {money(totals.grpSell)} USD quoted has been
                      invoiced so far, so the cost below is running against part of the revenue.{" "}</>
                  )}
                  {Math.abs(earned.fxEffectUSD) < 0.5 ? (
                    <>The exchange rate has not moved this file either way
                       {earned.settledShare < 1 && " on the part settled so far"}.</>
                  ) : (
                    <>
                      The exchange rate has{" "}
                      <b style={{ color: earned.fxEffectUSD > 0 ? "var(--ok)" : "var(--crit)" }}>
                        {earned.fxEffectUSD > 0 ? "earned" : "cost"} you{" "}
                        <span className="tabular">{money(Math.abs(earned.fxEffectUSD))} USD</span>
                      </b>{" "}
                      since this was sold at {money(quote.fx, 2)} EGP/USD — that is currency movement, not pricing.
                    </>
                  )}
                  {earned.settledShare < 1 && (
                    <> Only {money(earned.settledShare * 100, 0)}% of the EGP cost has actually been paid, so the
                       rest is still valued at the sold rate.</>
                  )}
                </p>
              </div>
            </div>
          )}

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(420px,1fr))" }}>
            {seesClientMoney && (
              <Receivables quoteId={quote.id} invoices={invoices} receipts={receipts}
                           editable={financeCanEdit} sellTotal={totals.grpSell} soldFx={quote.fx} />
            )}
            {seesSupplierMoney && (
              <Payables quoteId={quote.id} balances={balances} payments={payments}
                        editable={financeCanEdit} soldFx={quote.fx} />
            )}
          </div>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) 330px", marginTop: 22, alignItems: "start" }}>
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
