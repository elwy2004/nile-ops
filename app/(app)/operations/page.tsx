import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { deskFiles } from "@/lib/desk";
import DeskFiles from "../desk-files";
import { q } from "@/lib/db";
import { SECTIONS } from "@/lib/pricing";
import { BOOKING_LABEL, BOOKING_TONE, type BookingStatus } from "@/lib/bookings";
import type { Section } from "@/lib/pricing";
import { shortDate } from "@/lib/format";

/* Everything operations still owes a supplier, across every live file, in the
   order the services actually happen. This is the daily worklist. */

type Row = {
  id: number; quote_id: number; quote_ref: string; quote_title: string; client_name: string;
  section: Section; item_name: string; qty: number; status: BookingStatus;
  supplier_name: string | null; confirmation_no: string; service_date: string | null;
  quote_status: string; pax: number;
};

const FILTERS = [
  { key: "open", label: "Still to confirm" },
  { key: "unassigned", label: "No supplier yet" },
  { key: "confirmed", label: "Confirmed" },
  { key: "all", label: "Everything" },
] as const;

export default async function OperationsPage({
  searchParams,
}: { searchParams: Promise<{ show?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const mine = await deskFiles(user.role);
  const show = FILTERS.some(f => f.key === sp.show) ? sp.show! : "open";

  const where =
    show === "open" ? "b.status IN ('pending','requested')"
    : show === "unassigned" ? "b.supplier_id IS NULL AND b.status <> 'cancelled'"
    : show === "confirmed" ? "b.status = 'confirmed'"
    : "TRUE";

  const rows = await q<Row>(
    `SELECT b.id, b.quote_id, qt.ref AS quote_ref, qt.title AS quote_title, qt.client_name,
            b.section, b.item_name, b.qty::float8 AS qty, b.status,
            s.name AS supplier_name, b.confirmation_no, b.service_date,
            qt.status AS quote_status, qt.pax
       FROM bookings b
       JOIN quotes qt ON qt.id = b.quote_id
       LEFT JOIN suppliers s ON s.id = b.supplier_id
      WHERE ${where}
        AND qt.status NOT IN ('cancelled','lost')
      ORDER BY b.service_date NULLS LAST, qt.ref, b.sort`
  );

  const counts = await q<{ status: BookingStatus; n: number }>(
    `SELECT b.status, COUNT(*)::int AS n FROM bookings b JOIN quotes qt ON qt.id = b.quote_id
      WHERE qt.status NOT IN ('cancelled','lost') GROUP BY b.status`
  );
  const openCount = counts.filter(c => c.status === "pending" || c.status === "requested")
                          .reduce((s, c) => s + c.n, 0);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Operations</h1>
          <p>
            {openCount === 0
              ? "Every service on every live file is settled."
              : `${openCount} ${openCount === 1 ? "service" : "services"} still to confirm across all files.`}
          </p>
        </div>
        <div className="actions">
          <nav className="nav">
            {FILTERS.map(f => (
              <Link key={f.key} href={`/operations?show=${f.key}`} className={show === f.key ? "on" : undefined}>
                {f.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <DeskFiles role={user.role} files={mine} />

      <div className="card">
        <h2>Services to chase<span className="side">across every file</span></h2>
        {rows.length === 0 ? (
          <div className="empty">
            <b>Nothing here</b>
            {show === "open" ? "No services are waiting on a supplier." : "No services match this filter."}
          </div>
        ) : (
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Service</th><th>File</th><th>Date</th><th>Supplier</th>
                  <th>Confirmation</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const overdue = r.service_date && String(r.service_date).slice(0, 10) < today
                                  && (r.status === "pending" || r.status === "requested");
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/quotes/${r.quote_id}`} className="qtitle">{r.item_name}</Link>
                        <span className="qref">{r.qty} × {SECTIONS[r.section].label.toLowerCase()} · {r.pax} pax</span>
                      </td>
                      <td style={{ textAlign: "left", fontFamily: "var(--sans)" }}>
                        <Link href={`/quotes/${r.quote_id}`}>{r.quote_title || r.quote_ref}</Link>
                        <span className="qref">{r.quote_ref}{r.client_name ? ` · ${r.client_name}` : ""}</span>
                      </td>
                      <td style={overdue ? { color: "var(--crit)", fontWeight: 600 } : undefined}>
                        {r.service_date ? shortDate(r.service_date) : "—"}
                        {overdue && <span className="qref" style={{ color: "var(--crit)" }}>date passed</span>}
                      </td>
                      <td style={{ textAlign: "left", fontFamily: "var(--sans)" }}>
                        {r.supplier_name ?? <span style={{ color: "var(--faint)" }}>not assigned</span>}
                      </td>
                      <td style={{ textAlign: "left" }}>
                        {r.confirmation_no || <span style={{ color: "var(--faint)" }}>—</span>}
                      </td>
                      <td><span className={`pill ${BOOKING_TONE[r.status]}`}>{BOOKING_LABEL[r.status]}</span></td>
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
          Services appear here the moment a client accepts a quote. A file cannot move to finance
          until every one of its services is confirmed or marked not needed.
        </div>
      </div>
    </>
  );
}
