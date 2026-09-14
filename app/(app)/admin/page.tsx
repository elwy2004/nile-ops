import { requireRole } from "@/lib/auth";
import { q } from "@/lib/db";
import { setUserActive, setUserRole } from "@/lib/actions";
import { stamp } from "@/lib/format";
import NewUserForm from "./new-user";

type U = { id: number; email: string; name: string; role: string; active: boolean; created_at: string };

const ROLE_NOTE: Record<string, string> = {
  sales: "Builds and sends quotes; marks them accepted or lost.",
  ops: "Confirms services and maintains the price book. Doesn't see margin.",
  finance: "Invoices, records payment and closes files.",
  admin: "Everything, plus managing people.",
};

export default async function AdminPage({
  searchParams,
}: { searchParams: Promise<{ self?: string }> }) {
  const me = await requireRole("admin");
  const sp = await searchParams;
  const users = await q<U>("SELECT id,email,name,role,active,created_at FROM users ORDER BY active DESC, name");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>People</h1>
          <p>Who can sign in, and what they may do.</p>
        </div>
      </div>

      {sp.self && <div className="note bad" style={{ marginBottom: 16 }}>
        <div>You can&apos;t change your own role or switch yourself off — ask another administrator.</div></div>}

      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) 340px", alignItems: "start" }}>
        <div className="card">
          <h2>Accounts<span className="side">{users.filter(u => u.active).length} active</span></h2>
          <div className="tablewrap">
            <table className="data">
              <thead><tr><th>Person</th><th>Role</th><th>Added</th><th /></tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} style={u.active ? undefined : { opacity: 0.5 }}>
                    <td>
                      <span className="qtitle">{u.name}</span>
                      <span className="qref">{u.email}{u.id === me.id ? " · you" : ""}</span>
                    </td>
                    <td>
                      <form action={setUserRole} style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <input type="hidden" name="id" value={u.id} />
                        <select className="t" name="role" defaultValue={u.role} disabled={u.id === me.id}
                                style={{ width: 110, padding: "5px 7px" }}>
                          <option value="sales">sales</option>
                          <option value="ops">ops</option>
                          <option value="finance">finance</option>
                          <option value="admin">admin</option>
                        </select>
                        <button className="btn btn-sm" type="submit" disabled={u.id === me.id}>Set</button>
                      </form>
                    </td>
                    <td>{stamp(u.created_at)}</td>
                    <td>
                      <form action={setUserActive}>
                        <input type="hidden" name="id" value={u.id} />
                        <button className="btn btn-sm btn-stop" type="submit" disabled={u.id === me.id}>
                          {u.active ? "Switch off" : "Switch on"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid">
          <NewUserForm />
          <div className="card">
            <h2>What each role can do</h2>
            <div className="body">
              {Object.entries(ROLE_NOTE).map(([role, note]) => (
                <div className="lrow" key={role} style={{ display: "block", paddingBottom: 10 }}>
                  <span className="rolechip">{role}</span>
                  <div style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 4 }}>{note}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
