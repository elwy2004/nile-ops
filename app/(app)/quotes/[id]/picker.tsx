"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

/* Type-to-search picker for the price book.

   A plain <select> of 87 sights is unusable: you cannot type "kar" to reach
   Karnak, you scroll. This filters as you type, keeps the keyboard working,
   and only ever commits a name that exists in the book. */

export default function ItemPicker({
  value, options, onChange, placeholder = "type to search…",
}: {
  value: string;
  options: string[];
  onChange: (name: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    // names that start with the query first — "kar" should reach Karnak before
    // anything that merely contains it
    const starts: string[] = [], has: string[] = [];
    for (const o of options) {
      const l = o.toLowerCase();
      if (l.startsWith(q)) starts.push(o);
      else if (l.includes(q)) has.push(o);
    }
    return [...starts, ...has];
  }, [query, options]);

  useEffect(() => { setActive(0); }, [query]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function commit(name: string) {
    onChange(name);
    close();
    inputRef.current?.blur();
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setActive(i => {
        const next = e.key === "ArrowDown" ? i + 1 : i - 1;
        return Math.max(0, Math.min(matches.length - 1, next));
      });
    } else if (e.key === "Enter") {
      if (open && matches[active]) { e.preventDefault(); commit(matches[active]); }
    } else if (e.key === "Escape") {
      if (open) { e.preventDefault(); close(); }
    }
  }

  return (
    <div className="picker" ref={boxRef}>
      <input
        ref={inputRef}
        className="t"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={open ? query : value}
        placeholder={value ? value : placeholder}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onKeyDown={onKey}
      />
      {!value && !open && <span className="pickerHint" aria-hidden="true">nothing chosen</span>}
      {open && (
        <ul className="pickerList" id={listId} role="listbox">
          {matches.length === 0 && (
            <li className="pickerEmpty">
              Nothing in the price book matches “{query}”.
            </li>
          )}
          {matches.slice(0, 60).map((o, i) => (
            <li
              key={o}
              role="option"
              aria-selected={i === active}
              className={i === active ? "on" : undefined}
              onMouseEnter={() => setActive(i)}
              onMouseDown={e => { e.preventDefault(); commit(o); }}
            >
              {o}
            </li>
          ))}
          {matches.length > 60 && (
            <li className="pickerEmpty">{matches.length - 60} more — keep typing to narrow.</li>
          )}
        </ul>
      )}

      <style>{`
        .picker{position:relative;min-width:0}
        .picker input{width:100%}
        .pickerHint{position:absolute;left:10px;top:50%;transform:translateY(-50%);
                    pointer-events:none;color:var(--faint);font-size:13px}
        .pickerList{position:absolute;z-index:30;top:calc(100% + 4px);left:0;right:0;
                    max-height:260px;overflow-y:auto;margin:0;padding:4px;list-style:none;
                    background:var(--surface);border:1px solid var(--line-strong);border-radius:8px;
                    box-shadow:0 12px 32px -12px rgba(0,0,0,.85)}
        .pickerList li{padding:7px 9px;border-radius:5px;font-size:13px;cursor:pointer;color:var(--ink-2)}
        .pickerList li.on{background:var(--accent-soft);color:var(--accent-ink)}
        .pickerEmpty{color:var(--faint);cursor:default;font-style:italic}
        .pickerEmpty.on{background:none;color:var(--faint)}
      `}</style>
    </div>
  );
}
