import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { canSeeMargin } from "@/lib/workflow";
import { SECTIONS, SECTION_ORDER, type Line, type Snapshot } from "@/lib/pricing";
import { INVOICE_KIND_LABEL, type Invoice, type Receipt } from "@/lib/money";
import { money, shortDate } from "@/lib/format";
import PrintButton from "../../vouchers/print-button";

/* The document the client receives: what they are being charged and what is
   still due. Never shows costs or margin. */

export default async function InvoicePage({
  params,
}: { params: Promise<{ id: string; invoiceId: string }> }) {
  const user = await requireUser();
  const { id: idParam, invoiceId: invParam } = await params;
  const id = Number(idParam), invId = Number(invParam);
  if (!Number.isInteger(id) || !Number.isInteger(invId)) notFound();
  if (!canSeeMargin(user.role) && user.role !== "ops") notFound();

  const quote = await one<{
    id: number; ref: string; title: string; client_name: string; pax: number;
    arrival: string | null; departure: string | null; snapshot: Snapshot | null;
  }>(`SELECT id, ref, title, client_name, pax, arrival, departure, snapshot FROM quotes WHERE id=$1`, [id]);
  if (!quote) notFound();

  const invoice = await one<Invoice>(
    `SELECT i.id, i.quote_id, i.number, i.kind, i.status, i.currency, i.amount::float8 AS amount,
            i.issued_on, i.due_on, i.notes,
            COALESCE((SELECT SUM(r.amount) FROM receipts r WHERE r.invoice_id=i.id),0)::float8 AS received
       FROM invoices i WHERE i.id=$1 AND i.quote_id=$2`, [invId, id]
  );
  if (!invoice) notFound();

  const receipts = await q<Receipt>(
    `SELECT r.id, r.invoice_id, r.amount::float8 AS amount, r.currency, r.received_on,
            r.method, r.reference, r.notes, null AS who
       FROM receipts r WHERE r.invoice_id=$1 ORDER BY r.received_on, r.id`, [invId]
  );

  const lines = await q<Line>(
    `SELECT section, item_name, qty::float8 AS qty FROM quote_lines WHERE quote_id=$1 ORDER BY sort, id`, [id]
  );
  const outstanding = invoice.amount - invoice.received;

  return (
    <>
      <div className="page-head noprint">
        <div>
          <h1>{invoice.number ?? "Draft invoice"}</h1>
          <p>{INVOICE_KIND_LABEL[invoice.kind]} · {quote.ref}</p>
        </div>
        <div className="actions">
          <Link href={`/quotes/${quote.id}`} className="btn btn-sm">Back to file</Link>
          <PrintButton label="Print invoice" />
        </div>
      </div>

      {invoice.status === "draft" && (
        <div className="note" style={{ marginBottom: 16 }}>
          <div>This invoice is still a draft. Issue it from the file before sending it to the client.</div>
        </div>
      )}

      <article className="invoice">
        <header>
          <div>
            <div className="ilabel">{invoice.status === "draft" ? "Draft invoice" : "Invoice"}</div>
            <div className="ino">{invoice.number ?? `Draft ${invoice.id}`}</div>
          </div>
          <div className="ibrand">Nile Ops</div>
        </header>

        <div className="imeta">
          <div><dt>Billed to</dt><dd>{quote.client_name || quote.title || "—"}</dd></div>
          <div><dt>File</dt><dd className="tabular">{quote.ref}</dd></div>
          <div><dt>Issued</dt><dd>{invoice.issued_on ? shortDate(invoice.issued_on) : "not yet issued"}</dd></div>
          <div><dt>Due</dt><dd>{invoice.due_on ? shortDate(invoice.due_on) : "on receipt"}</dd></div>
          <div><dt>Travel</dt><dd>
            {quote.arrival ? shortDate(quote.arrival) : "—"}
            {quote.departure ? ` – ${shortDate(quote.departure)}` : ""} · {quote.pax} {quote.pax === 1 ? "person" : "people"}
          </dd></div>
        </div>

        <h3>{quote.title || "Tour arrangements"}</h3>
        <ul className="ilines">
          {SECTION_ORDER.map(section => {
            const rows = lines.filter(l => l.section === section);
            if (!rows.length) return null;
            return (
              <li key={section}>
                <b>{SECTIONS[section].label}</b>
                <span>{rows.map(r => `${r.item_name}${r.qty > 1 ? ` ×${r.qty}` : ""}`).join(" · ")}</span>
              </li>
            );
          })}
        </ul>

        <table className="itotals">
          <tbody>
            <tr>
              <td>{INVOICE_KIND_LABEL[invoice.kind]}</td>
              <td className="tabular">{money(invoice.amount)} {invoice.currency}</td>
            </tr>
            {receipts.map(r => (
              <tr key={r.id} className="ipaid">
                <td>Received {shortDate(r.received_on)}{r.reference ? ` · ${r.reference}` : ""}</td>
                <td className="tabular">− {money(r.amount)} {r.currency}</td>
              </tr>
            ))}
            <tr className="idue">
              <td>{outstanding <= 0.005 ? "Settled in full" : "Amount due"}</td>
              <td className="tabular">{money(Math.max(0, outstanding))} {invoice.currency}</td>
            </tr>
          </tbody>
        </table>

        {invoice.notes && <p className="inote">{invoice.notes}</p>}
        <footer>
          Please quote {invoice.number ?? quote.ref} with your payment.
        </footer>
      </article>

      <style>{`
        .invoice{max-width:760px;background:var(--surface);border:1px solid var(--line-strong);
                 border-radius:10px;padding:26px}
        .invoice header{display:flex;align-items:flex-start;gap:12px;border-bottom:1px solid var(--line);
                        padding-bottom:14px;margin-bottom:18px}
        .ilabel{font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
        .ino{font-family:var(--mono);font-size:19px;font-weight:600;color:var(--brass)}
        .ibrand{margin-left:auto;font-weight:700;font-size:14px}
        .imeta{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px 18px;margin-bottom:22px}
        .imeta dt{font-family:var(--mono);font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
        .imeta dd{margin:2px 0 0;font-size:13.5px}
        .invoice h3{margin:0 0 12px;font-size:16px;letter-spacing:-.01em}
        .ilines{list-style:none;margin:0 0 22px;padding:0;display:grid;gap:8px}
        .ilines li{display:grid;grid-template-columns:150px 1fr;gap:12px;font-size:13px;
                   padding-bottom:8px;border-bottom:1px solid var(--line)}
        .ilines b{font-weight:600}
        .ilines span{color:var(--ink-2)}
        .itotals{width:100%;border-collapse:collapse;font-size:14px}
        .itotals td{padding:8px 0;border-bottom:1px solid var(--line)}
        .itotals td:last-child{text-align:right;white-space:nowrap}
        .itotals .ipaid td{color:var(--ok);font-size:13px}
        .itotals .idue td{font-weight:700;font-size:16px;border-bottom:0;padding-top:12px}
        .inote{margin:18px 0 0;padding:11px 13px;background:var(--surface-2);border-radius:6px;
               font-size:12.5px;color:var(--ink-2)}
        .invoice footer{margin-top:20px;padding-top:12px;border-top:1px solid var(--line);
                        font-family:var(--mono);font-size:10.5px;color:var(--faint)}
        @media print{
          :root{color-scheme:light}
          .noprint,.masthead,.note{display:none!important}
          body{background:#fff;color:#111}
          .invoice{background:#fff;border:0;padding:0;max-width:none;color:#111}
          .invoice h3,.imeta dd,.itotals td{color:#111}
          .ino{color:#111}
          .inote{background:#f3f3f3;color:#111}
        }
      `}</style>
    </>
  );
}
