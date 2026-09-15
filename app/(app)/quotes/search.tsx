"use client";

import { useEffect, useState } from "react";

/* Filters the table in the page rather than round-tripping to the server:
   a file list is small enough that typing should feel instant. */
export default function QuoteSearch({ count }: { count: number }) {
  const [q, setQ] = useState("");

  useEffect(() => {
    const needle = q.trim().toLowerCase();
    const rows = document.querySelectorAll<HTMLTableRowElement>("table.data tbody tr");
    let shown = 0;
    rows.forEach(row => {
      const hit = !needle || row.textContent!.toLowerCase().includes(needle);
      row.hidden = !hit;
      if (hit) shown++;
    });
    const none = document.getElementById("noMatches");
    if (none) none.hidden = shown > 0 || !needle;
  }, [q]);

  return (
    <input
      className="t"
      type="search"
      value={q}
      onChange={e => setQ(e.target.value)}
      placeholder={`Search ${count} ${count === 1 ? "file" : "files"}…`}
      aria-label="Search quotes"
      style={{ width: 220 }}
    />
  );
}
