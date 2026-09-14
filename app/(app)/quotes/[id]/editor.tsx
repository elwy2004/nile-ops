"use client";

import { useMemo, useState } from "react";
import { saveQuote } from "@/lib/actions";
import {
  compute, SECTIONS, SECTION_ORDER, TIER_LABELS, tierIndex,
  type Line, type RateItem, type Section,
} from "@/lib/pricing";
import { money } from "@/lib/format";

type Terms = {
  id: number; title: string; client_name: string; pax: number;
  arrival: string | null; departure: string | null;
  fx: number; margin_pct: number; flights_usd: number;
};

export default function QuoteEditor({
  quote, initialLines, rates, showMargin,
}: {
  quote: Terms; initialLines: Line[]; rates: RateItem[]; showMargin: boolean;
}) {
  const [terms, setTerms] = useState<Terms>(quote);
  const [lines, setLines] = useState<Line[]>(initialLines);

  const byBook = useMemo(() => {
    const m = new Map<string, RateItem[]>();
    for (const r of rates) {
      const arr = m.get(r.book) ?? [];
      arr.push(r);
      m.set(r.book, arr);
    }
    return m;
  }, [rates]);

  const t = useMemo(
    () => compute({ pax: terms.pax, fx: terms.fx, margin_pct: terms.margin_pct, flights_usd: terms.flights_usd }, lines, rates),
    [terms, lines, rates]
  );

  const unit = (section: Section, name: string) => {
    const r = byBook.get(SECTIONS[section].book)?.find(x => x.name === name);
    if (!r) return 0;
    return section === "transfers" ? [r.rate1, r.rate2, r.rate3][tierIndex(terms.pax)] ?? 0 : r.rate1;
  };

  const setTerm = <K extends keyof Terms>(k: K, v: Terms[K]) => setTerms(p => ({ ...p, [k]: v }));
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines(p => p.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addLine = (section: Section) =>
    setLines(p => [...p, { section, item_name: "", qty: 1 }]);
  const dropLine = (i: number) => setLines(p => p.filter((_, j) => j !== i));

  const tier = tierIndex(terms.pax);

  return (
    <form action={saveQuote} className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) 330px", alignItems: "start" }}>
      <input type="hidden" name="id" value={terms.id} />

      <div className="grid">
        <div className="card">
          <h2>File<span className="side">Sales</span></h2>
          <div className="body grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))" }}>
            <label className="f" style={{ gridColumn: "span 2" }}>
              <span>Quote title</span>
              <input className="t" name="title" value={terms.title}
                     onChange={e => setTerm("title", e.target.value)} placeholder="e.g. 6-night Cairo & Nile cruise" />
            </label>
            <label className="f" style={{ gridColumn: "span 2" }}>
              <span>Client</span>
              <input className="t" name="client_name" value={terms.client_name}
                     onChange={e => setTerm("client_name", e.target.value)} placeholder="Agency or traveller name" />
            </label>
            <label className="f">
              <span>No. of group</span>
              <input className="t num" type="number" min={1} step={1} name="pax" value={terms.pax}
                     onChange={e => setTerm("pax", Math.max(1, Number(e.target.value) || 1))} />
            </label>
            <label className="f">
              <span>Arrival</span>
              <input className="t num" type="date" name="arrival" value={terms.arrival ?? ""}
                     onChange={e => setTerm("arrival", e.target.value || null)} />
            </label>
            <label className="f">
              <span>Departure</span>
              <input className="t num" type="date" name="departure" value={terms.departure ?? ""}
                     onChange={e => setTerm("departure", e.target.value || null)} />
            </label>
            <label className="f">
              <span>Exchange rate · EGP/USD</span>
              <input className="t num" type="number" min={0.0001} step="any" name="fx" value={terms.fx}
                     onChange={e => setTerm("fx", Number(e.target.value) || 0)} />
            </label>
            <label className="f">
              <span>Margin · %</span>
              <input className="t num" type="number" min={0} step="any" name="margin_pct" value={terms.margin_pct}
                     onChange={e => setTerm("margin_pct", Number(e.target.value) || 0)} />
            </label>
            <label className="f">
              <span>Domestic flights · USD</span>
              <input className="t num" type="number" min={0} step="any" name="flights_usd" value={terms.flights_usd}
                     onChange={e => setTerm("flights_usd", Number(e.target.value) || 0)} />
            </label>
          </div>
          <div className="body" style={{ paddingTop: 0, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {TIER_LABELS.map((label, i) => (
              <span key={label} className={`pill${i === tier ? " sales" : ""}`}>{label}</span>
            ))}
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Transfer rates read the {TIER_LABELS[tier].split(" ·")[0]} column for {terms.pax} pax.
            </span>
          </div>
        </div>

        {SECTION_ORDER.map(section => {
          const cfg = SECTIONS[section];
          const options = byBook.get(cfg.book) ?? [];
          const idxs = lines.map((l, i) => [l, i] as const).filter(([l]) => l.section === section);
          const subtotal = idxs.reduce((s, [l]) => s + unit(section, l.item_name) * (Number(l.qty) || 0), 0);
          const dp = section === "acc" ? 2 : 0;
          return (
            <div className="card" key={section}>
              <h2>
                {cfg.label}
                <span className="side">
                  {cfg.cur} · {money(subtotal, dp)}
                  {section === "transfers" || section === "services" ? ` · ${money(subtotal / terms.pax, dp)} pp` : " pp"}
                </span>
              </h2>
              <div className="body" style={{ padding: "8px 10px 12px" }}>
                {idxs.length === 0 && (
                  <p style={{ color: "var(--faint)", fontStyle: "italic", margin: "8px 6px" }}>
                    No {cfg.label.toLowerCase()} lines yet.
                  </p>
                )}
                {idxs.map(([l, i]) => {
                  const u = unit(section, l.item_name);
                  return (
                    <div key={i} className="lineRow">
                      <input type="hidden" name="section" value={section} />
                      <select className="t" name="item" value={l.item_name}
                              onChange={e => setLine(i, { item_name: e.target.value })}>
                        <option value="">— select —</option>
                        {options.map(o => <option key={o.name} value={o.name}>{o.name}</option>)}
                      </select>
                      <input className="t num" type="number" min={0} step="any" name="qty" value={l.qty}
                             aria-label={cfg.qty} onChange={e => setLine(i, { qty: Number(e.target.value) || 0 })} />
                      <span className="tabular" style={{ color: "var(--muted)", textAlign: "right" }}>{money(u, dp)}</span>
                      <span className="tabular" style={{ fontWeight: 600, textAlign: "right" }}>
                        {money(u * (Number(l.qty) || 0), dp)}
                      </span>
                      <button type="button" className="btn btn-sm btn-stop" onClick={() => dropLine(i)}
                              aria-label="Remove line">×</button>
                    </div>
                  );
                })}
                <button type="button" className="btn btn-sm" onClick={() => addLine(section)} style={{ marginTop: 8 }}>
                  + Add {cfg.label.toLowerCase().replace(" & others", "")} line
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <aside className="grid" style={{ position: "sticky", top: 16 }}>
        <div className="card">
          <h2>Cost build-up<span className="side">Per person</span></h2>
          <div className="body" style={{ padding: "6px 16px 12px" }}>
            <Row k="Accommodation" sub="in DBL" v={`${money(t.accUSD)} USD`} />
            <Row k="Sightseeing" v={`${money(t.sightLE, 0)} EGP`} />
            <Row k="Transfers" sub={`${money(t.transLE, 0)} ÷ ${t.pax}`} v={`${money(t.transPP, 0)} EGP`} />
            <Row k="Meals & others" v={`${money(t.mealLE, 0)} EGP`} />
            <Row k="Services" sub={`${money(t.servLE, 0)} ÷ ${t.pax}`} v={`${money(t.servPP, 0)} EGP`} />
            <Row k="EGP converted" sub={`${money(t.lePP, 0)} ÷ ${money(t.fx, 2)}`} v={`${money(t.lePP / t.fx)} USD`} rule />
            <Row k="Domestic flights" v={`${money(t.flights)} USD`} />
            <Row k="Net cost" sub="per person" v={`${money(t.costPP)} USD`} rule total />
            {showMargin && <Row k="Margin" sub={`${money(t.marginPct, 1)}%`} v={`+ ${money(t.sellPP - t.costPP)} USD`} />}
          </div>
          <div className="headline">
            <div className="cap">Quotation · per person in DBL</div>
            <div className="fig">{money(t.sellPP)}<span className="cc">USD</span></div>
            <div className="note" style={{ background: "none", border: 0, padding: 0, marginTop: 6 }}>
              {t.pax} pax · {money(t.fx, 2)} EGP/USD
            </div>
          </div>
          <div className="cellgrid">
            <div className="cell"><div className="cap">Single supp.</div><div className="val">{money(t.sglSell)}</div></div>
            <div className="cell"><div className="cap">Group total</div><div className="val">{money(t.grpSell)}</div></div>
            {showMargin && (
              <>
                <div className="cell"><div className="cap">Net cost · group</div><div className="val">{money(t.costPP * t.pax)}</div></div>
                <div className="cell"><div className="cap">Estimated profit</div><div className="val pos">+{money(t.grpProfit)}</div></div>
              </>
            )}
          </div>
        </div>
        <button className="btn btn-go" type="submit" style={{ justifyContent: "center" }}>Save quote</button>
      </aside>

      <style>{`
        .lineRow{display:grid;grid-template-columns:minmax(0,1fr) 76px 90px 100px 34px;gap:8px;align-items:center;padding:5px 6px}
        .lineRow:hover{background:var(--surface-2);border-radius:6px}
        @media (max-width:900px){
          form.grid{grid-template-columns:1fr!important}
          aside{position:static!important;order:-1}
        }
        @media (max-width:640px){
          .lineRow{grid-template-columns:70px 1fr auto;grid-template-areas:"sel sel kill" "qty rate amt";
                   border-bottom:1px solid var(--line);padding:10px 4px}
          .lineRow select{grid-area:sel}
          .lineRow input[name="qty"]{grid-area:qty}
          .lineRow span:nth-of-type(1){grid-area:rate;text-align:left!important}
          .lineRow span:nth-of-type(2){grid-area:amt}
          .lineRow button{grid-area:kill}
          .lineRow select,.lineRow input{font-size:16px}
        }
      `}</style>
    </form>
  );
}

function Row({ k, sub, v, rule, total }: { k: string; sub?: string; v: string; rule?: boolean; total?: boolean }) {
  return (
    <div className={`lrow${rule ? " rule" : ""}${total ? " total" : ""}`}>
      <span className="k">{k}{sub && <em>{sub}</em>}</span>
      <span className="v">{v}</span>
    </div>
  );
}
