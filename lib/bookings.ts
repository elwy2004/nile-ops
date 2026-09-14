/* Bookings: the operations side of an accepted quote.

   Every frozen quote line becomes one booking. Operations assigns a supplier,
   gets a confirmation number, and records what the supplier actually charges.
   A file cannot reach finance until every booking is settled. */

import { SECTIONS, type Section, type Snapshot } from "./pricing";

export type BookingStatus = "pending" | "requested" | "confirmed" | "cancelled";
export type SupplierKind = "hotel" | "cruise" | "transport" | "guide" | "restaurant" | "site" | "other";

export const BOOKING_LABEL: Record<BookingStatus, string> = {
  pending: "To request",
  requested: "Awaiting supplier",
  confirmed: "Confirmed",
  cancelled: "Not needed",
};

/** Pill styling class per status. */
export const BOOKING_TONE: Record<BookingStatus, string> = {
  pending: "", requested: "ops", confirmed: "finance", cancelled: "done",
};

export const SUPPLIER_KINDS: SupplierKind[] = [
  "hotel", "cruise", "transport", "guide", "restaurant", "site", "other",
];

/** Which kind of supplier a quote section usually needs — used to sort the picker. */
export const SECTION_KIND: Record<Section, SupplierKind> = {
  acc: "hotel", transfers: "transport", sights: "site", meals: "restaurant", services: "guide",
};

export type Booking = {
  id: number;
  quote_id: number;
  section: Section;
  item_name: string;
  qty: number;
  sort: number;
  supplier_id: number | null;
  supplier_name: string | null;
  status: BookingStatus;
  confirmation_no: string;
  service_date: string | null;
  currency: "USD" | "EGP";
  quoted_cost: number;
  actual_cost: number | null;
  notes: string;
};

export type Supplier = {
  id: number; name: string; kind: SupplierKind;
  phone: string; email: string; notes: string; archived: boolean;
};

/** A booking is settled once it no longer needs chasing. */
export function isSettled(b: { status: BookingStatus }): boolean {
  return b.status === "confirmed" || b.status === "cancelled";
}

export function outstanding(bookings: { status: BookingStatus }[]): number {
  return bookings.filter(b => !isSettled(b)).length;
}

/** The rows to create when a quote is accepted, taken from the frozen snapshot
    so a booking always reflects what was sold, not today's price book. */
export function bookingRowsFromSnapshot(snapshot: Snapshot) {
  return snapshot.lines
    .filter(l => l.item_name.trim() !== "")
    .map((l, i) => ({
      section: l.section,
      item_name: l.item_name,
      qty: Number(l.qty) || 0,
      sort: i,
      currency: SECTIONS[l.section].cur,
      quoted_cost: Number(l.amount) || 0,
    }));
}

/** Voucher number, derived from the file reference — no extra column to keep in step. */
export function voucherNo(quoteRef: string, sort: number): string {
  return `${quoteRef}/${String(sort + 1).padStart(2, "0")}`;
}

/* ---- cost variance -------------------------------------------------------
   Quoted and actual costs are held in the currency they were priced in.
   Converting at the quote's own frozen FX keeps the comparison honest: it
   isolates supplier price movement from exchange-rate movement. */

export type Variance = {
  quotedUSD: number;
  actualUSD: number;
  diffUSD: number;
  priced: number;   // bookings with an actual cost recorded
  total: number;
};

export function variance(bookings: Booking[], fx: number): Variance {
  const rate = Number(fx) || 1;
  const toUSD = (v: number, cur: "USD" | "EGP") => (cur === "USD" ? v : v / rate);

  let quotedUSD = 0, actualUSD = 0, priced = 0;
  for (const b of bookings) {
    if (b.status === "cancelled") continue;
    quotedUSD += toUSD(Number(b.quoted_cost) || 0, b.currency);
    if (b.actual_cost !== null && b.actual_cost !== undefined) {
      actualUSD += toUSD(Number(b.actual_cost), b.currency);
      priced++;
    } else {
      actualUSD += toUSD(Number(b.quoted_cost) || 0, b.currency);   // assume as quoted until told otherwise
    }
  }
  return {
    quotedUSD, actualUSD, diffUSD: actualUSD - quotedUSD, priced,
    total: bookings.filter(b => b.status !== "cancelled").length,
  };
}
