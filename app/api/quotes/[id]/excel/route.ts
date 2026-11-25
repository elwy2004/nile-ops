import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { q, one } from "@/lib/db";
import { canSeeMargin } from "@/lib/workflow";
import { compute, type Line, type RateItem } from "@/lib/pricing";
import type { Booking } from "@/lib/bookings";
import type { Invoice, Receipt, SupplierPayment } from "@/lib/money";
import { quoteWorkbook, quoteFileName, type QuoteHeader } from "@/lib/excel/quote";

export const runtime = "nodejs";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/* Downloading a file as a spreadsheet must not reveal more than the screen
   does, so the same role rules decide what goes into the workbook. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await requireUser();
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "That is not a file reference." }, { status: 400 });
  }

  try {
    const quote = await one<QuoteHeader>(
      `SELECT qt.id, qt.ref, qt.title, qt.client_name, qt.status, qt.pax, qt.arrival, qt.departure,
              qt.fx::float8 AS fx, qt.margin_pct::float8 AS margin_pct,
              qt.flights_usd::float8 AS flights_usd, qt.snapshot, u.name AS owner
         FROM quotes qt LEFT JOIN users u ON u.id = qt.owner_id
        WHERE qt.id = $1`,
      [id]
    );
    if (!quote) {
      return NextResponse.json({ error: "No such file." }, { status: 404 });
    }

    const [lines, rates, bookings, invoices, receipts, payments] = await Promise.all([
      q<Line>(
        `SELECT section, item_name, qty::float8 AS qty FROM quote_lines
          WHERE quote_id = $1 ORDER BY sort, id`, [id]
      ),
      q<RateItem>(
        `SELECT book, name, rate1::float8 AS rate1, rate2::float8 AS rate2, rate3::float8 AS rate3
           FROM rate_items WHERE NOT archived`
      ),
      q<Booking>(
        `SELECT b.id, b.quote_id, b.section, b.item_name, b.qty::float8 AS qty, b.sort,
                b.supplier_id, s.name AS supplier_name, b.status, b.confirmation_no,
                b.service_date, b.currency, b.quoted_cost::float8 AS quoted_cost,
                b.actual_cost::float8 AS actual_cost, b.notes
           FROM bookings b LEFT JOIN suppliers s ON s.id = b.supplier_id
          WHERE b.quote_id = $1 ORDER BY b.sort, b.id`, [id]
      ),
      q<Invoice>(
        `SELECT i.id, i.quote_id, i.number, i.kind, i.status, i.currency,
                i.amount::float8 AS amount, i.issued_on, i.due_on, i.notes,
                COALESCE((SELECT SUM(r.amount) FROM receipts r WHERE r.invoice_id = i.id),0)::float8 AS received
           FROM invoices i WHERE i.quote_id = $1 ORDER BY i.id`, [id]
      ),
      q<Receipt>(
        `SELECT r.id, r.invoice_id, r.amount::float8 AS amount, r.currency, r.received_on,
                r.method, r.reference, r.notes, u.name AS who
           FROM receipts r
           JOIN invoices i ON i.id = r.invoice_id
           LEFT JOIN users u ON u.id = r.recorded_by
          WHERE i.quote_id = $1 ORDER BY r.received_on, r.id`, [id]
      ),
      q<SupplierPayment>(
        `SELECT p.id, p.quote_id, p.supplier_id, s.name AS supplier_name,
                p.amount::float8 AS amount, p.currency, p.fx_rate::float8 AS fx_rate,
                p.paid_on, p.method, p.reference, p.notes, u.name AS who
           FROM supplier_payments p
           LEFT JOIN suppliers s ON s.id = p.supplier_id
           LEFT JOIN users u ON u.id = p.recorded_by
          WHERE p.quote_id = $1 ORDER BY p.paid_on, p.id`, [id]
      ),
    ]);

    const terms = {
      pax: quote.pax, fx: quote.fx,
      margin_pct: quote.margin_pct, flights_usd: quote.flights_usd,
    };
    const totals = quote.snapshot ? quote.snapshot.totals : compute(terms, lines, rates);

    const workbook = await quoteWorkbook({
      quote, lines, rates, totals, bookings, invoices, receipts, payments,
      permissions: {
        showMargin: canSeeMargin(user.role),
        showClientMoney: user.role !== "ops",
        showSupplierMoney: user.role !== "sales",
      },
    });

    return new Response(new Uint8Array(workbook), {
      headers: {
        "Content-Type": XLSX_TYPE,
        "Content-Disposition": `attachment; filename="${quoteFileName(quote)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : "unknown error";
    console.error(`[excel] quote ${id} failed: ${detail}`);
    return NextResponse.json(
      { error: "The spreadsheet could not be built. Try again, or tell an administrator." },
      { status: 500 }
    );
  }
}
