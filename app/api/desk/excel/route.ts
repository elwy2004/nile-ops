import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { deskFiles } from "@/lib/desk";
import { deskWorkbook, deskFileName } from "@/lib/excel/desk";

export const runtime = "nodejs";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The signed-in department's own queue, as a spreadsheet. */
export async function GET(): Promise<Response> {
  const user = await requireUser();
  try {
    const files = await deskFiles(user.role);
    const workbook = await deskWorkbook(user.role, files);
    return new Response(new Uint8Array(workbook), {
      headers: {
        "Content-Type": XLSX_TYPE,
        "Content-Disposition": `attachment; filename="${deskFileName(user.role)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : "unknown error";
    console.error(`[excel] desk ${user.role} failed: ${detail}`);
    return NextResponse.json(
      { error: "The spreadsheet could not be built. Try again, or tell an administrator." },
      { status: 500 }
    );
  }
}
