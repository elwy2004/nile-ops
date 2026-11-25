import Link from "next/link";
import { STATUS_LABEL, type Role } from "@/lib/workflow";
import { DESK_ARRIVES_FROM, DESK_LEAVES_WHEN, type DeskFile } from "@/lib/desks";
import { money, shortDate, stamp } from "@/lib/format";

/* The files sitting on one department's desk. Each department gets the columns
   that answer its own question — sales asks what it is worth, operations what
   is left to confirm, finance who owes whom. */

const TONE: Record<Role, string> = { sales: "sales", ops: "ops", finance: "finance", admin: "" };

export default function DeskFiles({ role, files }: { role: Role; files: DeskFile[] }) {
  const arrives = DESK_ARRIVES_FROM[role];
  const leaves = DESK_LEAVES_WHEN[role];

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h2>
        {/* admin is not a department — it sees every desk at once */}
        {role === "admin" ? "Every live file" : "On your desk"}
        <span className={`pill ${TONE[role]}`} style={{ marginLeft: 4 }}>
          {files.length} {files.length === 1 ? "file" : "files"}
        </span>
        <span className="side" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {role === "admin" ? "all three desks" : role === "ops" ? "operations" : role}
          {files.length > 0 && (
            <a href="/api/desk/excel" className="mini" title="Download this list as a spreadsheet">Excel</a>
          )}
        </span>
      </h2>

      {files.length === 0 ? (
        <div className="empty">
          <b>{role === "admin" ? "No live files" : "Nothing waiting on you"}</b>
          {arrives
            ? `A file arrives here by itself once ${arrives}.`
            : role === "admin"
              ? "Every file is closed, lost or cancelled."
              : "Start a quote when you are ready."}
        </div>
      ) : (
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                <th>File</th>
                <th>Stage</th>
                <th>Travel</th>
                {role === "sales" && <><th>Pax</th><th>Group total</th><th>Margin</th></>}
                {role === "ops" && <><th>Services left</th><th>Next service</th></>}
                {role === "finance" && <><th>Invoiced</th><th>Client owes</th><th>You owe</th></>}
                {role === "admin" && <><th>Pax</th><th>Group total</th></>}
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {files.map(f => {
                const owes = f.invoiced_usd - f.received_usd;
                const weOwe = f.cost_usd - f.paid_usd;
                return (
                  <tr key={f.id}>
                    <td>
                      <Link href={`/quotes/${f.id}`} className="qtitle">{f.title || "Untitled quote"}</Link>
                      <span className="qref">
                        {f.ref}{f.client_name ? ` · ${f.client_name}` : ""}
                      </span>
                    </td>
                    <td><span className={`pill ${TONE[role]}`}>{STATUS_LABEL[f.status]}</span></td>
                    <td>{f.arrival ? shortDate(f.arrival) : "—"}</td>

                    {role === "sales" && (
                      <>
                        <td>{f.pax}</td>
                        <td>{f.sell_usd ? money(f.sell_usd) : "—"}</td>
                        <td>{f.margin_usd ? money(f.margin_usd) : "—"}</td>
                      </>
                    )}

                    {role === "ops" && (
                      <>
                        <td style={{ color: f.services_open > 0 ? "var(--warn)" : "var(--ok)" }}>
                          {f.services_total === 0
                            ? "—"
                            : f.services_open > 0
                              ? `${f.services_open} of ${f.services_total}`
                              : "all confirmed"}
                        </td>
                        <td>{f.next_service ? shortDate(f.next_service) : "—"}</td>
                      </>
                    )}

                    {role === "finance" && (
                      <>
                        <td>{f.invoiced_usd ? money(f.invoiced_usd) : "—"}</td>
                        <td style={{ color: owes > 0.005 ? "var(--warn)" : "var(--faint)" }}>
                          {owes > 0.005 ? money(owes) : "settled"}
                        </td>
                        <td style={{ color: weOwe > 0.005 ? "var(--warn)" : "var(--faint)" }}>
                          {weOwe > 0.005 ? money(weOwe) : "settled"}
                        </td>
                      </>
                    )}

                    {role === "admin" && (
                      <>
                        <td>{f.pax}</td>
                        <td>{f.sell_usd ? money(f.sell_usd) : "—"}</td>
                      </>
                    )}

                    <td>{stamp(f.updated_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(arrives || leaves) && (
        <div className="body" style={{ borderTop: "1px solid var(--line)", background: "var(--surface-2)" }}>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>
            {arrives && <>Files arrive here on their own once {arrives}. </>}
            {leaves && <>They leave once {leaves}.</>}
          </p>
        </div>
      )}
    </div>
  );
}
