"use client";

import { useActionState } from "react";
import { changeOwnPassword } from "@/lib/actions";

export default function PasswordForm() {
  const [state, action, pending] = useActionState(changeOwnPassword, {} as { error?: string; ok?: string });
  return (
    <form action={action} className="card">
      <h2>Change password</h2>
      <div className="body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label className="f"><span>Current password</span>
          <input className="t" type="password" name="current" autoComplete="current-password" required /></label>
        <label className="f"><span>New password</span>
          <input className="t" type="password" name="next" minLength={10} autoComplete="new-password" required
                 placeholder="at least 10 characters" /></label>
        {state?.error && <div className="note bad">{state.error}</div>}
        {state?.ok && <div className="note"><div>{state.ok}</div></div>}
        <button className="btn btn-go" type="submit" disabled={pending} style={{ justifyContent: "center" }}>
          {pending ? "Saving…" : "Change password"}
        </button>
      </div>
    </form>
  );
}
