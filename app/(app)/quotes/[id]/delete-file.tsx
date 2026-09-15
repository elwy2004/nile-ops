"use client";

import { useState } from "react";
import { deleteQuoteFile } from "@/lib/actions";

/* Two steps on purpose: this destroys the file and everything recorded
   against it, and nothing here can be undone. */
export default function DeleteFile({ id, reference }: { id: number; reference: string }) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button className="btn btn-sm btn-stop" type="button" onClick={() => setArmed(true)}>
        Delete file
      </button>
    );
  }
  return (
    <form action={deleteQuoteFile} style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <input type="hidden" name="id" value={id} />
      <span style={{ fontSize: 12.5, color: "var(--crit)" }}>
        Delete {reference} and its whole history?
      </span>
      <button className="btn btn-sm btn-stop" type="submit"
              style={{ background: "var(--crit)", borderColor: "var(--crit)", color: "#2A0F0A" }}>
        Yes, delete
      </button>
      <button className="btn btn-sm" type="button" onClick={() => setArmed(false)}>Keep it</button>
    </form>
  );
}
