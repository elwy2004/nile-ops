import type ExcelJS from "exceljs";
import {
  makeLookup, SECTIONS, SECTION_ORDER,
  type Line, type RateItem, type Section, type Snapshot, type Totals,
} from "../pricing";
import { voucherNo, BOOKING_LABEL, type Booking } from "../bookings";
import {
  INVOICE_KIND_LABEL, INVOICE_STATUS_LABEL,
  type Invoice, type Receipt, type SupplierPayment,
} from "../money";
import { STATUS_LABEL, type Status } from "../workflow";
import {
  Column, MONEY_0, MONEY_2, facts, fileName, newWorkbook,
  sectionRow, tableHead, tableRow, titleBlock, totalRow,
} from "./sheet";

/* One quote file as a workbook: the quotation, the services behind it, and the
   money against it. Each sheet is omitted when the file has nothing of that
   kind, and what a reader may see follows the same rules as the screen —
   operations never gets a margin column here either. */

export interface QuoteHeader {
  readonly id: number;
  readonly ref: string;
  readonly title: string;
  readonly client_name: string;
  readonly status: Status;
  readonly pax: number;
  readonly arrival: string | null;
  readonly departure: string | null;
  readonly fx: number;
  readonly margin_pct: number;
  readonly flights_usd: number;
  readonly snapshot: Snapshot | null;
  readonly owner: string | null;
}

export interface ExportPermissions {
  readonly showMargin: boolean;
  readonly showClientMoney: boolean;
  readonly showSupplierMoney: boolean;
}

export interface QuoteExportData {
  readonly quote: QuoteHeader;
  readonly lines: readonly Line[];
  readonly rates: readonly RateItem[];
  readonly totals: Totals;
  readonly bookings: readonly Booking[];
  readonly invoices: readonly Invoice[];
  readonly receipts: readonly Receipt[];
  readonly payments: readonly SupplierPayment[];
  readonly permissions: ExportPermissions;
}

const asDate = (value: string | null): Date | null =>
  value ? new Date(`${String(value).slice(0, 10)}T00:00:00Z`) : null;

const decimals = (section: Section): string =>
  SECTIONS[section].cur === "USD" ? MONEY_2 : MONEY_0;

const ITINERARY_COLUMNS: readonly Column[] = [
  { header: "Item", width: 34 },
  { header: "Qty", width: 8, align: "right", numFmt: MONEY_0 },
  { header: "Unit", width: 12, align: "right", numFmt: MONEY_2 },
  { header: "Amount", width: 14, align: "right", numFmt: MONEY_2 },
  { header: "Currency", width: 10, align: "center" },
];

function addQuotationSheet(wb: ExcelJS.Workbook, data: QuoteExportData): void {
  const { quote, lines, rates, totals, permissions } = data;
  const ws = wb.addWorksheet("Quotation");

  titleBlock(ws, quote.title || "Untitled quote", `${quote.ref} · ${STATUS_LABEL[quote.status]}`);
  facts(ws, [
    ["Client", quote.client_name || null],
    ["Owner", quote.owner],
    ["Arrival", asDate(quote.arrival)],
    ["Departure", asDate(quote.departure)],
    ["Group size", quote.pax],
    ["Exchange rate (EGP/USD)", quote.fx],
    ["Prices", quote.snapshot ? "Locked at acceptance" : "Against today's price book"],
  ]);

  // The unit a line was sold at, which after acceptance is not today's rate.
  const soldUnit = new Map<string, number>();
  for (const line of quote.snapshot?.lines ?? []) {
    soldUnit.set(`${line.section}|${line.item_name}`, line.unit);
  }
  const live = makeLookup([...rates]);
  const unitFor = (section: Section, item: string): number =>
    soldUnit.get(`${section}|${item}`) ?? live(section, item, quote.pax);

  tableHead(ws, ITINERARY_COLUMNS);
  for (const section of SECTION_ORDER) {
    const rows = lines.filter(l => l.section === section);
    if (rows.length === 0) continue;

    sectionRow(ws, SECTIONS[section].label, SECTIONS[section].cur);
    const format = decimals(section);
    const columns = ITINERARY_COLUMNS.map((c, i) =>
      i >= 2 && i <= 3 ? { ...c, numFmt: format } : c
    );
    for (const line of rows) {
      const unit = unitFor(section, line.item_name);
      tableRow(ws, columns, [
        line.item_name, line.qty, unit, unit * line.qty, SECTIONS[section].cur,
      ]);
    }
  }

  ws.addRow([]);
  sectionRow(ws, "Per person");
  const summary: readonly Column[] = [
    { header: "", width: 34 },
    { header: "", width: 8 },
    { header: "", width: 12 },
    { header: "", width: 14, align: "right", numFmt: MONEY_2 },
    { header: "", width: 10, align: "center" },
  ];
  tableRow(ws, summary, ["Accommodation", null, null, totals.accUSD, "USD"]);
  tableRow(ws, summary, ["Sightseeing", null, null, totals.sightLE, "EGP"]);
  tableRow(ws, summary, [`Transfers (${totals.transLE} EGP ÷ ${totals.pax})`, null, null, totals.transPP, "EGP"]);
  tableRow(ws, summary, ["Meals & others", null, null, totals.mealLE, "EGP"]);
  tableRow(ws, summary, [`Services (${totals.servLE} EGP ÷ ${totals.pax})`, null, null, totals.servPP, "EGP"]);
  tableRow(ws, summary, [`EGP converted at ${totals.fx}`, null, null, totals.lePP / totals.fx, "USD"]);
  tableRow(ws, summary, ["Domestic flights", null, null, totals.flights, "USD"]);
  totalRow(ws, summary, ["Net cost per person", null, null, totals.costPP, "USD"]);

  if (permissions.showMargin) {
    tableRow(ws, summary, [`Margin (${totals.marginPct}%)`, null, null, totals.sellPP - totals.costPP, "USD"]);
  }
  totalRow(ws, summary, ["Quotation per person in DBL", null, null, totals.sellPP, "USD"]);
  tableRow(ws, summary, ["Single supplement", null, null, totals.sglSell, "USD"]);
  totalRow(ws, summary, [`Group total (${totals.pax} pax)`, null, null, totals.grpSell, "USD"]);
  if (permissions.showMargin) {
    tableRow(ws, summary, ["Estimated profit", null, null, totals.grpProfit, "USD"]);
  }
}

const SERVICE_COLUMNS: readonly Column[] = [
  { header: "Service", width: 30 },
  { header: "Part of", width: 16 },
  { header: "Qty", width: 7, align: "right", numFmt: MONEY_0 },
  { header: "Supplier", width: 24 },
  { header: "Service date", width: 14 },
  { header: "Confirmation", width: 18 },
  { header: "Status", width: 18 },
  { header: "Quoted", width: 12, align: "right", numFmt: MONEY_2 },
  { header: "Actual", width: 12, align: "right", numFmt: MONEY_2 },
  { header: "Currency", width: 10, align: "center" },
  { header: "Voucher", width: 18 },
];

function addServicesSheet(wb: ExcelJS.Workbook, data: QuoteExportData): void {
  const { quote, bookings } = data;
  if (bookings.length === 0) return;

  const ws = wb.addWorksheet("Services");
  titleBlock(ws, "Services", `${quote.ref} · ${bookings.length} booked`);
  tableHead(ws, SERVICE_COLUMNS);

  for (const b of bookings) {
    const format = b.currency === "USD" ? MONEY_2 : MONEY_0;
    const columns = SERVICE_COLUMNS.map((c, i) =>
      i === 7 || i === 8 ? { ...c, numFmt: format } : c
    );
    tableRow(ws, columns, [
      b.item_name,
      SECTIONS[b.section].label,
      b.qty,
      b.supplier_name,
      asDate(b.service_date),
      b.confirmation_no,
      BOOKING_LABEL[b.status],
      b.quoted_cost,
      b.actual_cost,
      b.currency,
      voucherNo(quote.ref, b.sort),
    ]);
  }
}

const MONEY_COLUMNS: readonly Column[] = [
  { header: "Reference", width: 20 },
  { header: "Detail", width: 30 },
  { header: "Date", width: 14 },
  { header: "Amount", width: 14, align: "right", numFmt: MONEY_2 },
  { header: "Currency", width: 10, align: "center" },
  { header: "Status", width: 16 },
];

function addMoneySheet(wb: ExcelJS.Workbook, data: QuoteExportData): void {
  const { quote, invoices, receipts, payments, permissions } = data;
  const client = permissions.showClientMoney ? invoices : [];
  const supplier = permissions.showSupplierMoney ? payments : [];
  if (client.length === 0 && supplier.length === 0) return;

  const ws = wb.addWorksheet("Money");
  titleBlock(ws, "Money", `${quote.ref} · recorded, not processed`);

  if (client.length > 0) {
    sectionRow(ws, "Invoices");
    tableHead(ws, MONEY_COLUMNS);
    for (const inv of client) {
      tableRow(ws, MONEY_COLUMNS, [
        inv.number ?? `Draft ${inv.id}`,
        INVOICE_KIND_LABEL[inv.kind],
        asDate(inv.issued_on ?? inv.due_on),
        inv.amount,
        inv.currency,
        INVOICE_STATUS_LABEL[inv.status],
      ]);
    }
    ws.addRow([]);

    const byInvoice = new Map(client.map(i => [i.id, i.number ?? `Draft ${i.id}`]));
    const visible = receipts.filter(r => byInvoice.has(r.invoice_id));
    if (visible.length > 0) {
      sectionRow(ws, "Receipts");
      tableHead(ws, MONEY_COLUMNS);
      for (const r of visible) {
        tableRow(ws, MONEY_COLUMNS, [
          byInvoice.get(r.invoice_id) ?? "",
          [r.method, r.reference].filter(Boolean).join(" · "),
          asDate(r.received_on),
          r.amount,
          r.currency,
          "Received",
        ]);
      }
      ws.addRow([]);
    }
  }

  if (supplier.length > 0) {
    sectionRow(ws, "Paid to suppliers");
    const columns: readonly Column[] = [
      ...MONEY_COLUMNS.slice(0, 5),
      { header: "Rate used", width: 12, align: "right", numFmt: MONEY_2, decimals: 4 },
    ];
    tableHead(ws, columns);
    for (const p of supplier) {
      tableRow(ws, columns, [
        p.supplier_name ?? "—",
        [p.method, p.reference].filter(Boolean).join(" · "),
        asDate(p.paid_on),
        p.amount,
        p.currency,
        p.currency === "EGP" ? p.fx_rate : null,
      ]);
    }
  }
}

/** The whole file as one workbook, ready to send. */
export async function quoteWorkbook(data: QuoteExportData): Promise<Buffer> {
  const wb = newWorkbook();
  addQuotationSheet(wb, data);
  addServicesSheet(wb, data);
  addMoneySheet(wb, data);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

export function quoteFileName(quote: QuoteHeader): string {
  return fileName([quote.ref, quote.client_name || quote.title]);
}
