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
            {user.role === "ops" && <NavLink href="/operations">My desk</NavLink>}
            {user.role === "finance" && <NavLink href="/finance">My desk</NavLink>}
            <NavLink href="/quotes">Quotes</NavLink>
            {user.role !== "ops" && <NavLink href="/operations">Operations</NavLink>}
            {(user.role === "admin") && <NavLink href="/finance">Finance</NavLink>}
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
