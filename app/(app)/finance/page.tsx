import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { deskFiles } from "@/lib/desk";
import DeskFiles from "../desk-files";
import { q } from "@/lib/db";
import { STATUS_LABEL, type Status } from "@/lib/workflow";
import { money, shortDate } from "@/lib/format";

/* The money position across every live file: what clients owe, what suppliers
   are owed, and where the currency has moved against you. */

type FileRow = {
  id: number; ref: string; title: string; client_name: string; status: Status;
  fx: number;
  invoiced_usd: number; received_usd: number;
  cost_usd: number; paid_usd: number;
  next_due: string | null;
  overdue: boolean;
};

export default async function FinancePage({
  searchParams,
}: { searchParams: Promise<{ show?: string }> }) {
  const user = await requireRole("finance", "admin");
  const sp = await searchParams;
  const mine = await deskFiles(user.role);
  const show = sp.show === "all" ? "all" : "open";

  /* Amounts are converted to USD at each file's own sold rate, which is what
     the client was quoted at. Supplier payments carry their own rate; the
     per-file view breaks that out, this one stays at the sold rate so the
     columns are comparable across files. */
  const rows = await q<FileRow>(
    `SELECT qt.id, qt.ref, qt.title, qt.client_name, qt.status, qt.fx::float8 AS fx,
            COALESCE(inv.invoiced,0)::float8 AS invoiced_usd,
            COALESCE(inv.received,0)::float8 AS received_usd,
            COALESCE(bk.cost,0)::float8      AS cost_usd,
            COALESCE(pay.paid,0)::float8     AS paid_usd,
            inv.next_due,
            COALESCE(inv.next_due < CURRENT_DATE, false) AS overdue
       FROM quotes qt
       LEFT JOIN LATERAL (
         SELECT SUM(CASE WHEN i.currency='USD' THEN i.amount ELSE i.amount/NULLIF(qt.fx,0) END) AS invoiced,
                SUM(CASE WHEN i.currency='USD' THEN r.got   ELSE r.got  /NULLIF(qt.fx,0) END) AS received,
                MIN(i.due_on) FILTER (WHERE i.amount > r.got) AS next_due
           FROM invoices i
           LEFT JOIN LATERAL (
             SELECT COALESCE(SUM(amount),0) AS got FROM receipts WHERE invoice_id = i.id
           ) r ON TRUE
          WHERE i.quote_id = qt.id AND i.status = 'issued'
       ) inv ON TRUE
       LEFT JOIN LATERAL (
         SELECT SUM(CASE WHEN b.currency='USD' THEN COALESCE(b.actual_cost,b.quoted_cost)
                         ELSE COALESCE(b.actual_cost,b.quoted_cost)/NULLIF(qt.fx,0) END) AS cost
           FROM bookings b WHERE b.quote_id = qt.id AND b.status <> 'cancelled'
       ) bk ON TRUE
       LEFT JOIN LATERAL (
         SELECT SUM(CASE WHEN p.currency='USD' THEN p.amount
                         ELSE p.amount/NULLIF(COALESCE(p.fx_rate, qt.fx),0) END) AS paid
           FROM supplier_payments p WHERE p.quote_id = qt.id
       ) pay ON TRUE
      WHERE qt.snapshot IS NOT NULL
        AND qt.status NOT IN ('lost','cancelled')
        ${show === "open" ? "AND qt.status <> 'closed'" : ""}
      ORDER BY inv.next_due NULLS LAST, qt.ref`
  );

  const t = rows.reduce(
    (a, r) => ({
      invoiced: a.invoiced + r.invoiced_usd,
      received: a.received + r.received_usd,
      cost: a.cost + r.cost_usd,
      paid: a.paid + r.paid_usd,
    }),
    { invoiced: 0, received: 0, cost: 0, paid: 0 }
  );
  const owedToUs = t.invoiced - t.received;
  const weOwe = t.cost - t.paid;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Finance</h1>
          <p>
            {rows.length
              ? `${rows.length} ${rows.length === 1 ? "file" : "files"} · ${money(owedToUs)} USD owed to you · ${money(weOwe)} USD owed to suppliers`
              : "No accepted files yet."}
          </p>
        </div>
        <div className="actions">
          <nav className="nav">
            <Link href="/finance?show=open" className={show === "open" ? "on" : undefined}>Open</Link>
            <Link href="/finance?show=all" className={show === "all" ? "on" : undefined}>Including closed</Link>
          </nav>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="cellgrid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", marginBottom: 16, border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
          <div className="cell"><div className="cap">Invoiced</div><div className="val">{money(t.invoiced)}</div></div>
          <div className="cell"><div className="cap">Received</div><div className="val pos">{money(t.received)}</div></div>
          <div className="cell">
            <div className="cap">Owed to you</div>
            <div className="val" style={{ color: owedToUs > 0.005 ? "var(--warn)" : undefined }}>{money(owedToUs)}</div>
          </div>
          <div className="cell">
            <div className="cap">Owed to suppliers</div>
            <div className="val" style={{ color: weOwe > 0.005 ? "var(--warn)" : undefined }}>{money(weOwe)}</div>
          </div>
          <div className="cell">
            <div className="cap">Gross on the book</div>
            <div className="val">{money(t.invoiced - t.cost)}</div>
          </div>
        </div>
      )}

      <DeskFiles role={user.role} files={mine} />

      <div className="card">
        <h2>Money position<span className="side">every accepted file</span></h2>
        {rows.length === 0 ? (
          <div className="empty">
            <b>Nothing to reconcile</b>
            Files appear here once a client accepts and prices are locked.
          </div>
        ) : (
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr>
                  <th>File</th><th>Stage</th><th>Invoiced</th><th>Received</th>
                  <th>Client owes</th><th>Supplier cost</th><th>Paid out</th><th>You owe</th><th>Next due</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const clientOwes = r.invoiced_usd - r.received_usd;
                  const supplierOwed = r.cost_usd - r.paid_usd;
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/quotes/${r.id}`} className="qtitle">{r.title || r.ref}</Link>
                        <span className="qref">{r.ref}{r.client_name ? ` · ${r.client_name}` : ""}</span>
                      </td>
                      <td><span className="pill">{STATUS_LABEL[r.status]}</span></td>
                      <td>{r.invoiced_usd ? money(r.invoiced_usd) : "—"}</td>
                      <td style={{ color: r.received_usd > 0 ? "var(--ok)" : undefined }}>
                        {r.received_usd ? money(r.received_usd) : "—"}
                      </td>
                      <td style={{ color: clientOwes > 0.005 ? "var(--warn)" : "var(--faint)" }}>
                        {clientOwes > 0.005 ? money(clientOwes) : "settled"}
                      </td>
                      <td>{r.cost_usd ? money(r.cost_usd) : "—"}</td>
                      <td style={{ color: r.paid_usd > 0 ? "var(--ok)" : undefined }}>
                        {r.paid_usd ? money(r.paid_usd) : "—"}
                      </td>
                      <td style={{ color: supplierOwed > 0.005 ? "var(--warn)" : "var(--faint)" }}>
                        {supplierOwed > 0.005 ? money(supplierOwed) : "settled"}
                      </td>
                      <td style={r.overdue ? { color: "var(--crit)", fontWeight: 600 } : undefined}>
                        {r.next_due ? shortDate(r.next_due) : "—"}
                        {r.overdue && <span className="qref" style={{ color: "var(--crit)" }}>overdue</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="note" style={{ marginTop: 16 }}>
        <div>
          Everything here is stated in USD at each file&apos;s <b>own sold rate</b>, so the columns compare
          like with like. Where the currency has actually moved against a file, the file itself breaks
          that out under <b>What this file actually earned</b>.
        </div>
      </div>
    </>
  );
}
