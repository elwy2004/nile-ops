import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { SECTIONS } from "@/lib/pricing";
import { voucherNo, type Booking } from "@/lib/bookings";
import { shortDate } from "@/lib/format";
import PrintButton from "./print-button";

/* One voucher per confirmed service — what the client or guide hands over.
   Deliberately shows no prices: it is a proof of booking, not an invoice. */

export default async function VouchersPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const quote = await one<{
    id: number; ref: string; title: string; client_name: string; pax: number;
    arrival: string | null; departure: string | null;
  }>(
    `SELECT id, ref, title, client_name, pax, arrival, departure FROM quotes WHERE id = $1`, [id]
  );
  if (!quote) notFound();

  const bookings = await q<Booking>(
    `SELECT b.id, b.quote_id, b.section, b.item_name, b.qty::float8 AS qty, b.sort,
            b.supplier_id, s.name AS supplier_name, s.phone AS supplier_phone, b.status,
            b.confirmation_no, b.service_date, b.currency,
            b.quoted_cost::float8 AS quoted_cost, b.actual_cost::float8 AS actual_cost, b.notes
       FROM bookings b LEFT JOIN suppliers s ON s.id = b.supplier_id
      WHERE b.quote_id = $1 AND b.status = 'confirmed'
      ORDER BY b.service_date NULLS LAST, b.sort`, [id]
  ) as (Booking & { supplier_phone: string | null })[];

  return (
    <>
      <div className="page-head noprint">
        <div>
          <h1>Vouchers</h1>
          <p>
            {bookings.length
              ? `${bookings.length} confirmed ${bookings.length === 1 ? "service" : "services"} for ${quote.ref}.`
              : `Nothing confirmed yet for ${quote.ref}.`}
          </p>
        </div>
        <div className="actions">
          <Link href={`/quotes/${quote.id}`} className="btn btn-sm">Back to file</Link>
          {bookings.length > 0 && <PrintButton />}
        </div>
      </div>

      {bookings.length === 0 ? (
        <div className="card"><div className="empty">
          <b>No confirmed services</b>
          A voucher appears here once operations confirms the booking with a supplier.
        </div></div>
      ) : (
        <div className="vouchers">
          {bookings.map(b => (
            <article className="voucher" key={b.id}>
              <header>
                <div>
                  <div className="vlabel">Service voucher</div>
                  <div className="vno">{voucherNo(quote.ref, b.sort)}</div>
                </div>
                <div className="vbrand">Nile Ops</div>
              </header>

              <h3>{b.item_name}</h3>
              <dl>
                <div><dt>Client</dt><dd>{quote.client_name || quote.title || "—"}</dd></div>
                <div><dt>Party</dt><dd>{quote.pax} {quote.pax === 1 ? "person" : "people"}</dd></div>
                <div><dt>Service date</dt><dd>{b.service_date ? shortDate(b.service_date) : "as per itinerary"}</dd></div>
                <div><dt>Quantity</dt><dd>{b.qty} × {SECTIONS[b.section].label.toLowerCase()}</dd></div>
                <div><dt>Supplier</dt><dd>{b.supplier_name ?? "—"}{b.supplier_phone ? ` · ${b.supplier_phone}` : ""}</dd></div>
                <div><dt>Confirmation</dt><dd className="tabular">{b.confirmation_no}</dd></div>
              </dl>
              {b.notes && <p className="vnote">{b.notes}</p>}
              <footer>
                File {quote.ref}
                {quote.arrival ? ` · ${shortDate(quote.arrival)}` : ""}
                {quote.departure ? ` – ${shortDate(quote.departure)}` : ""}
              </footer>
            </article>
          ))}
        </div>
      )}

      <style>{`
        .vouchers{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px}
        .voucher{background:var(--surface);border:1px solid var(--line-strong);border-radius:10px;padding:18px;
                 break-inside:avoid}
        .voucher header{display:flex;align-items:flex-start;gap:12px;border-bottom:1px solid var(--line);
                        padding-bottom:10px;margin-bottom:12px}
        .vlabel{font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
        .vno{font-family:var(--mono);font-size:15px;font-weight:600;color:var(--brass);letter-spacing:.02em}
        .vbrand{margin-left:auto;font-weight:700;font-size:13px;letter-spacing:-.01em}
        .voucher h3{margin:0 0 12px;font-size:16px;letter-spacing:-.01em}
        .voucher dl{margin:0;display:grid;gap:7px}
        .voucher dl>div{display:flex;gap:12px;align-items:baseline;font-size:13px}
        .voucher dt{font-family:var(--mono);font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;
                    color:var(--faint);min-width:98px}
        .voucher dd{margin:0;color:var(--ink)}
        .vnote{margin:12px 0 0;padding:9px 11px;background:var(--surface-2);border-radius:6px;
               font-size:12.5px;color:var(--ink-2)}
        .voucher footer{margin-top:14px;padding-top:10px;border-top:1px solid var(--line);
                        font-family:var(--mono);font-size:10.5px;color:var(--faint)}
        @media print{
          :root{color-scheme:light}
          .noprint,.masthead{display:none!important}
          body{background:#fff;color:#111}
          .vouchers{grid-template-columns:1fr 1fr;gap:12px}
          .voucher{background:#fff;border:1px solid #999;color:#111}
          .voucher dd,.voucher h3{color:#111}
          .vno{color:#111}
          .vnote{background:#f3f3f3;color:#111}
        }
      `}</style>
    </>
  );
}
