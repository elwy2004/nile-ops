"use client";

import { useActionState } from "react";
import { createUser } from "@/lib/actions";

export default function NewUserForm() {
  const [state, action, pending] = useActionState(createUser, {} as { error?: string; ok?: string });
  return (
    <form action={action} className="card">
      <h2>Add someone</h2>
      <div className="body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label className="f"><span>Name</span><input className="t" name="name" required /></label>
        <label className="f"><span>Email</span><input className="t" type="email" name="email" required /></label>
        <label className="f"><span>Role</span>
          <select className="t" name="role" defaultValue="sales">
            <option value="sales">sales</option>
            <option value="ops">ops</option>
            <option value="finance">finance</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <label className="f"><span>Starting password</span>
          <input className="t" name="password" minLength={10} required
                 placeholder="at least 10 characters" autoComplete="new-password" />
        </label>
        {state?.error && <div className="note bad">{state.error}</div>}
        {state?.ok && <div className="note"><div>{state.ok}</div></div>}
        <button className="btn btn-go" type="submit" disabled={pending} style={{ justifyContent: "center" }}>
          {pending ? "Adding…" : "Add person"}
        </button>
      </div>
    </form>
  );
}
