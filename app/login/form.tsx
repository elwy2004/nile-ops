"use client";

import { useActionState } from "react";
import { login } from "@/lib/actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState(login, {} as { error?: string });
  return (
    <form action={action} className="card">
      <div className="body">
        <label className="f">
          <span>Email</span>
          <input className="t" type="email" name="email" autoComplete="username" required autoFocus />
        </label>
        <label className="f">
          <span>Password</span>
          <input className="t" type="password" name="password" autoComplete="current-password" required />
        </label>
        {state?.error && <div className="note bad">{state.error}</div>}
        <button className="btn btn-go" type="submit" disabled={pending}
                style={{ justifyContent: "center" }}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </form>
  );
}
