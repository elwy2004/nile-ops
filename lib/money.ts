/* The money layer.

   Revenue comes from invoices the client has been sent; cost comes from the
   bookings operations confirmed. What is owed to a supplier is derived from
   those bookings rather than stored twice — supplier_payments only records
   what has actually been settled.

   The one subtlety worth its own machinery: a file is sold in USD at a rate
   fixed on the day the client accepted, but its EGP costs are paid weeks or
   months later at whatever the rate is then. Comparing the two is the
   difference between "did we price this well" and "did the currency move". */

import type { Booking } from "./bookings";

export type InvoiceKind = "deposit" | "balance" | "full";
export type InvoiceStatus = "draft" | "issued" | "void";

export const INVOICE_KIND_LABEL: Record<InvoiceKind, string> = {
  deposit: "Deposit", balance: "Balance", full: "Full amount",
};
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft", issued: "Issued", void: "Void",
};
export const INVOICE_TONE: Record<InvoiceStatus, string> = {
  draft: "", issued: "ops", void: "dead",
};

export type Invoice = {
  id: number; quote_id: number; number: string | null;
  kind: InvoiceKind; status: InvoiceStatus;
  currency: "USD" | "EGP"; amount: number;
  issued_on: string | null; due_on: string | null; notes: string;
  received: number;            // receipts totalled, in the invoice's currency
};

export type Receipt = {
  id: number; invoice_id: number; amount: number; currency: "USD" | "EGP";
  received_on: string; method: string; reference: string; notes: string; who: string | null;
};

export type SupplierPayment = {
  id: number; quote_id: number; supplier_id: number; supplier_name: string | null;
  amount: number; currency: "USD" | "EGP"; fx_rate: number | null;
  paid_on: string; method: string; reference: string; notes: string; who: string | null;
};

export const PAYMENT_METHODS = ["Bank transfer", "Cash", "Cheque", "Card", "Other"] as const;

/* ---- client side ---- */

export type Receivable = {
  invoicedUSD: number;
  receivedUSD: number;
  outstandingUSD: number;
  hasIssued: boolean;
  fullySettled: boolean;
};

/** EGP amounts are stated in USD at the file's own sold rate. */
const usd = (amount: number, currency: "USD" | "EGP", fx: number) =>
  currency === "USD" ? amount : amount / (fx || 1);

export function receivable(invoices: Invoice[], fx: number): Receivable {
  let invoicedUSD = 0, receivedUSD = 0, hasIssued = false;
  for (const inv of invoices) {
    if (inv.status !== "issued") continue;
    hasIssued = true;
    invoicedUSD += usd(Number(inv.amount) || 0, inv.currency, fx);
    receivedUSD += usd(Number(inv.received) || 0, inv.currency, fx);
  }
  const outstandingUSD = invoicedUSD - receivedUSD;
  return {
    invoicedUSD, receivedUSD, outstandingUSD, hasIssued,
    // a hair of tolerance so rounding never leaves a file looking unpaid
    fullySettled: hasIssued && outstandingUSD <= 0.005,
  };
}

/* ---- supplier side ---- */

export type SupplierBalance = {
  supplier_id: number | null;
  supplier_name: string;
  currency: "USD" | "EGP";
  owed: number;        // from confirmed bookings, in that currency
  paid: number;
  outstanding: number;
};

/** What each supplier is owed on a file, from its bookings, less what is paid. */
export function supplierBalances(
  bookings: Booking[],
  payments: SupplierPayment[]
): SupplierBalance[] {
  const key = (id: number | null, cur: string) => `${id ?? 0}|${cur}`;
  const map = new Map<string, SupplierBalance>();

  for (const b of bookings) {
    if (b.status === "cancelled") continue;
    const cost = b.actual_cost ?? b.quoted_cost;      // assume as quoted until told otherwise
    const k = key(b.supplier_id, b.currency);
    const row = map.get(k) ?? {
      supplier_id: b.supplier_id,
      supplier_name: b.supplier_name ?? "Unassigned",
      currency: b.currency, owed: 0, paid: 0, outstanding: 0,
    };
    row.owed += Number(cost) || 0;
    map.set(k, row);
  }

  for (const p of payments) {
    const k = key(p.supplier_id, p.currency);
    const row = map.get(k) ?? {
      supplier_id: p.supplier_id,
      supplier_name: p.supplier_name ?? "Unassigned",
      currency: p.currency, owed: 0, paid: 0, outstanding: 0,
    };
    row.paid += Number(p.amount) || 0;
    map.set(k, row);
  }

  for (const row of map.values()) row.outstanding = row.owed - row.paid;
  return [...map.values()].sort((a, b) => a.supplier_name.localeCompare(b.supplier_name));
}

/* ---- what the file actually earned ---- */

export type Realised = {
  revenueUSD: number;          // invoiced (issued) in USD
  costAtSoldRateUSD: number;   // every cost converted at the rate the file sold at
  costAtPaidRateUSD: number;   // EGP settled converted at the rate on the day paid
  marginUSD: number;           // revenue − cost actually incurred
  marginPct: number;
  fxEffectUSD: number;         // positive = the currency moved in your favour
  settledShare: number;        // 0–1, how much of the EGP cost has actually been paid
};

/**
 * Cost is taken from the bookings. For the EGP portion that has already been
 * paid, we use the rate on the payment date; the rest is still valued at the
 * rate the file was sold at, because that is the only rate known for it.
 */
export function realised(
  invoices: Invoice[],
  bookings: Booking[],
  payments: SupplierPayment[],
  soldFx: number,
  flightsUSD = 0
): Realised {
  const fx = soldFx || 1;
  const revenueUSD = receivable(invoices, fx).invoicedUSD;

  let costUSDdirect = 0, costEGP = 0;
  for (const b of bookings) {
    if (b.status === "cancelled") continue;
    const cost = Number(b.actual_cost ?? b.quoted_cost) || 0;
    if (b.currency === "USD") costUSDdirect += cost;
    else costEGP += cost;
  }
  costUSDdirect += flightsUSD;

  const costAtSoldRateUSD = costUSDdirect + costEGP / fx;

  // EGP actually paid, valued at the rate used on the day it went out
  let egpPaid = 0, egpPaidAtPaidRateUSD = 0;
  for (const p of payments) {
    if (p.currency !== "EGP") continue;
    const amt = Number(p.amount) || 0;
    egpPaid += amt;
    egpPaidAtPaidRateUSD += amt / (Number(p.fx_rate) || fx);
  }
  const egpUnpaid = Math.max(0, costEGP - egpPaid);
  const costAtPaidRateUSD = costUSDdirect + egpPaidAtPaidRateUSD + egpUnpaid / fx;

  const marginUSD = revenueUSD - costAtPaidRateUSD;
  return {
    revenueUSD,
    costAtSoldRateUSD,
    costAtPaidRateUSD,
    marginUSD,
    marginPct: revenueUSD > 0 ? (marginUSD / revenueUSD) * 100 : 0,
    // paying less USD than the sold rate implied is a gain
    fxEffectUSD: costAtSoldRateUSD - costAtPaidRateUSD,
    settledShare: costEGP > 0 ? Math.min(1, egpPaid / costEGP) : 1,
  };
}
