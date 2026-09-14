import { requireUser } from "@/lib/auth";
import { logout } from "@/lib/actions";
import NavLink from "./nav-link";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <header className="masthead">
        <div className="masthead-in">
          <div className="brand">
            <strong>Nile Ops</strong>
            <span className="season">Q.SH 2026</span>
          </div>
          <nav className="nav">
            <NavLink href="/quotes">Quotes</NavLink>
            <NavLink href="/operations">Operations</NavLink>
            <NavLink href="/suppliers">Suppliers</NavLink>
            <NavLink href="/rates">Price book</NavLink>
            {user.role === "admin" && <NavLink href="/admin">People</NavLink>}
            <NavLink href="/account">Account</NavLink>
          </nav>
          <div className="who">
            <span>{user.name}</span>
            <span className="rolechip">{user.role}</span>
            <form action={logout}><button className="btn btn-sm" type="submit">Sign out</button></form>
          </div>
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
