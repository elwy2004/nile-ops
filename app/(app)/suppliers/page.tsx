import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { archiveSupplier } from "@/lib/actions";
import { SUPPLIER_KINDS, type Supplier } from "@/lib/bookings";
import SupplierForm from "./form";

type Row = Supplier & { live_bookings: number };

export default async function SuppliersPage({
  searchParams,
}: { searchParams: Promise<{ denied?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const editable = user.role === "ops" || user.role === "admin";

  const suppliers = await q<Row>(
    `SELECT s.id, s.name, s.kind, s.phone, s.email, s.notes, s.archived,
            COUNT(b.id) FILTER (WHERE b.status IN ('pending','requested','confirmed'))::int AS live_bookings
       FROM suppliers s LEFT JOIN bookings b ON b.supplier_id = s.id
      GROUP BY s.id
      ORDER BY s.archived, s.kind, s.name`
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Suppliers</h1>
          <p>
            {editable
              ? "The hotels, boats, transport companies and guides you book through."
              : "Read-only. Operations maintains this list."}
          </p>
        </div>
      </div>

      {sp.denied && <div className="note bad" style={{ marginBottom: 16 }}>
        <div>Only operations and administrators manage suppliers.</div></div>}

      <div className="grid" style={{ gridTemplateColumns: editable ? "minmax(0,1fr) 330px" : "1fr", alignItems: "start" }}>
        <div className="card">
          <h2>Directory<span className="side">{suppliers.filter(s => !s.archived).length} active</span></h2>
          {suppliers.length === 0 ? (
            <div className="empty">
              <b>No suppliers yet</b>
              Add the hotels and transport companies you work with, then assign them to services.
            </div>
          ) : (
            <div className="tablewrap">
              <table className="data">
                <thead>
                  <tr><th>Supplier</th><th>Type</th><th>Contact</th><th>Live bookings</th>{editable && <th />}</tr>
                </thead>
                <tbody>
                  {suppliers.map(s => (
                    <tr key={s.id} style={s.archived ? { opacity: 0.45 } : undefined}>
                      <td>
                        <span className="qtitle">{s.name}</span>
                        {s.notes && <span className="qref">{s.notes}</span>}
                      </td>
                      <td><span className="pill">{s.kind}</span></td>
                      <td style={{ textAlign: "left", fontFamily: "var(--sans)" }}>
                        {s.phone || s.email
                          ? <>{s.phone}{s.phone && s.email ? " · " : ""}{s.email}</>
                          : <span style={{ color: "var(--faint)" }}>—</span>}
                      </td>
                      <td>{s.live_bookings || "—"}</td>
                      {editable && (
                        <td>
                          <form action={archiveSupplier}>
                            <input type="hidden" name="id" value={s.id} />
                            <button className="mini danger" type="submit">
                              {s.archived ? "Restore" : "Retire"}
                            </button>
                          </form>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {editable && (
          <div className="grid">
            <SupplierForm />
            <div className="card">
              <h2>Types</h2>
              <div className="body" style={{ color: "var(--muted)", fontSize: 12.5 }}>
                The type decides which suppliers are offered first when operations assigns a
                service: hotels for accommodation, transport for transfers, and so on.
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                  {SUPPLIER_KINDS.map(k => <span className="pill" key={k}>{k}</span>)}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
