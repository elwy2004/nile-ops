import ExcelJS from "exceljs";

/* Shared spreadsheet furniture.

   Numbers are written as numbers with a format, never as pre-formatted text —
   the whole point of handing someone a spreadsheet is that they can total a
   column themselves. */

export const MONEY_2 = '#,##0.00';
export const MONEY_0 = '#,##0';
export const DATE_FMT = 'dd mmm yyyy';

const INK = "FF1C2523";
const RULE = "FFBDC8C4";

export type Align = "left" | "right" | "center";

export type Column = {
  header: string;
  width: number;
  align?: Align;
  numFmt?: string;
  /** Precision to store at. Defaults to 2 for numeric columns, matching the
      NUMERIC(12,2) the figures come from — without it, binary floating point
      writes 169.55000000000018 into the cell and a widened column shows it. */
  decimals?: number;
};

const DEFAULT_DECIMALS = 2;

function store(value: number, column: Column): number {
  const places = column.decimals ?? DEFAULT_DECIMALS;
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** A bold title line with the sheet's subject. */
export function titleBlock(ws: ExcelJS.Worksheet, title: string, subtitle: string): void {
  const t = ws.addRow([title]);
  t.font = { bold: true, size: 14, color: { argb: INK } };
  if (subtitle) {
    const s = ws.addRow([subtitle]);
    s.font = { size: 10, color: { argb: "FF5F6E6A" } };
  }
  ws.addRow([]);
}

/** Key/value lines for the file header — two columns, label then value. */
export function facts(
  ws: ExcelJS.Worksheet,
  rows: ReadonlyArray<readonly [string, string | number | Date | null]>
): void {
  for (const [label, value] of rows) {
    const r = ws.addRow([label, value ?? "—"]);
    r.getCell(1).font = { bold: true, size: 10 };
    if (value instanceof Date) r.getCell(2).numFmt = DATE_FMT;
  }
  ws.addRow([]);
}

/** A table header that stays visible, with the column widths applied once. */
export function tableHead(ws: ExcelJS.Worksheet, columns: readonly Column[]): void {
  const row = ws.addRow(columns.map(c => c.header));
  row.font = { bold: true, size: 10 };
  row.border = { bottom: { style: "thin", color: { argb: RULE } } };
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.max(col.width ?? 0, c.width);
    if (c.align) row.getCell(i + 1).alignment = { horizontal: c.align };
  });
}

/** One body row, formatted against the column definitions. */
export function tableRow(
  ws: ExcelJS.Worksheet,
  columns: readonly Column[],
  values: ReadonlyArray<string | number | Date | null>
): ExcelJS.Row {
  const row = ws.addRow(
    values.map((v, i) =>
      typeof v === "number" && columns[i]?.numFmt ? store(v, columns[i]) : (v ?? "")
    )
  );
  columns.forEach((c, i) => {
    const cell = row.getCell(i + 1);
    if (c.numFmt && typeof values[i] === "number") cell.numFmt = c.numFmt;
    if (values[i] instanceof Date) cell.numFmt = DATE_FMT;
    if (c.align) cell.alignment = { horizontal: c.align };
  });
  return row;
}

/** A sub-heading inside a sheet, e.g. a quote section or a block of money. */
export function sectionRow(ws: ExcelJS.Worksheet, label: string, note = ""): void {
  const row = ws.addRow(note ? [label, note] : [label]);
  row.font = { bold: true, size: 11 };
}

/** The emphasised line at the foot of a block. */
export function totalRow(
  ws: ExcelJS.Worksheet,
  columns: readonly Column[],
  values: ReadonlyArray<string | number | null>
): void {
  const row = tableRow(ws, columns, values);
  row.font = { bold: true };
  row.border = { top: { style: "thin", color: { argb: RULE } } };
}

/** Excel tolerates none of : \\ / ? * [ ] in a sheet name, and caps it at 31. */
export function safeSheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Sheet";
}

export function newWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Nile Ops";
  wb.created = new Date();
  return wb;
}

/** A filename that survives email, Windows and a shared drive. */
export function fileName(parts: ReadonlyArray<string | null | undefined>, ext = "xlsx"): string {
  const base = parts
    .filter(Boolean)
    .join(" ")
    .replace(/[^\w\s.-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return `${base || "export"}.${ext}`;
}
