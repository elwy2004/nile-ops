import type { DeskFile } from "../desks";
import { STATUS_LABEL, type Role } from "../workflow";
import {
  Column, MONEY_0, MONEY_2, fileName, newWorkbook, tableHead, tableRow, titleBlock,
} from "./sheet";

/* A department's queue as a spreadsheet — the same columns it sees on screen,
   so the export matches the view it was taken from. */

const SHARED: readonly Column[] = [
  { header: "Reference", width: 16 },
  { header: "File", width: 32 },
  { header: "Client", width: 26 },
  { header: "Stage", width: 20 },
  { header: "Arrival", width: 14 },
  { header: "Departure", width: 14 },
];

const BY_ROLE: Record<Role, readonly Column[]> = {
  sales: [
    { header: "Pax", width: 7, align: "right", numFmt: MONEY_0 },
    { header: "Group total (USD)", width: 18, align: "right", numFmt: MONEY_2 },
    { header: "Margin (USD)", width: 16, align: "right", numFmt: MONEY_2 },
  ],
  ops: [
    { header: "Services open", width: 14, align: "right", numFmt: MONEY_0 },
    { header: "Services total", width: 14, align: "right", numFmt: MONEY_0 },
    { header: "Next service", width: 14 },
  ],
  finance: [
    { header: "Invoiced (USD)", width: 16, align: "right", numFmt: MONEY_2 },
    { header: "Client owes (USD)", width: 18, align: "right", numFmt: MONEY_2 },
    { header: "You owe (USD)", width: 16, align: "right", numFmt: MONEY_2 },
  ],
  admin: [
    { header: "Pax", width: 7, align: "right", numFmt: MONEY_0 },
    { header: "Group total (USD)", width: 18, align: "right", numFmt: MONEY_2 },
    { header: "Services open", width: 14, align: "right", numFmt: MONEY_0 },
    { header: "Client owes (USD)", width: 18, align: "right", numFmt: MONEY_2 },
    { header: "You owe (USD)", width: 16, align: "right", numFmt: MONEY_2 },
  ],
};

const asDate = (value: string | null): Date | null =>
  value ? new Date(`${String(value).slice(0, 10)}T00:00:00Z`) : null;

function valuesFor(role: Role, f: DeskFile): ReadonlyArray<string | number | Date | null> {
  const owes = f.invoiced_usd - f.received_usd;
  const weOwe = f.cost_usd - f.paid_usd;
  const shared = [
    f.ref, f.title || "Untitled quote", f.client_name || null,
    STATUS_LABEL[f.status], asDate(f.arrival), asDate(f.departure),
  ];

  if (role === "sales") return [...shared, f.pax, f.sell_usd, f.margin_usd];
  if (role === "ops") return [...shared, f.services_open, f.services_total, asDate(f.next_service)];
  if (role === "finance") return [...shared, f.invoiced_usd, owes, weOwe];
  return [...shared, f.pax, f.sell_usd, f.services_open, owes, weOwe];
}

const DESK_LABEL: Record<Role, string> = {
  sales: "Sales", ops: "Operations", finance: "Finance", admin: "Every live file",
};

export async function deskWorkbook(role: Role, files: readonly DeskFile[]): Promise<Buffer> {
  const wb = newWorkbook();
  const ws = wb.addWorksheet(DESK_LABEL[role]);
  const columns: readonly Column[] = [...SHARED, ...BY_ROLE[role]];

  const taken = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  titleBlock(ws, DESK_LABEL[role], `${files.length} ${files.length === 1 ? "file" : "files"} · taken ${taken}`);
  tableHead(ws, columns);
  for (const f of files) tableRow(ws, columns, valuesFor(role, f));

  ws.views = [{ state: "frozen", ySplit: ws.rowCount }];
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

export function deskFileName(role: Role): string {
  return fileName(["Nile Ops", DESK_LABEL[role], new Date().toISOString().slice(0, 10)]);
}
