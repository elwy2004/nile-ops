"use client";

import { useActionState } from "react";
import { saveSupplier } from "@/lib/actions";
import { SUPPLIER_KINDS } from "@/lib/bookings";

export default function SupplierForm() {
  const [state, action, pending] = useActionState(saveSupplier, {} as { error?: string; ok?: string });
  return (
    <form action={action} className="card">
      <h2>Add a supplier</h2>
      <div className="body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label className="f"><span>Name</span>
          <input className="t" name="name" required placeholder="e.g. Mena House Marriott" /></label>
        <label className="f"><span>Type</span>
          <select className="t" name="kind" defaultValue="hotel">
            {SUPPLIER_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label className="f"><span>Phone</span><input className="t" name="phone" /></label>
        <label className="f"><span>Email</span><input className="t" type="email" name="email" /></label>
        <label className="f"><span>Note</span>
          <input className="t" name="notes" placeholder="contact person, payment terms" /></label>
        {state?.error && <div className="note bad">{state.error}</div>}
        {state?.ok && <div className="note"><div>{state.ok}</div></div>}
        <button className="btn btn-go" type="submit" disabled={pending} style={{ justifyContent: "center" }}>
          {pending ? "Saving…" : "Add supplier"}
        </button>
      </div>
    </form>
  );
}
