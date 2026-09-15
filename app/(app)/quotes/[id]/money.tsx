"use client";

import { useState } from "react";
import Link from "next/link";
import {
  createInvoice, setInvoiceStatus, recordReceipt, deleteReceipt,
  recordSupplierPayment, deleteSupplierPayment,
} from "@/lib/actions";
import {
  INVOICE_KIND_LABEL, INVOICE_STATUS_LABEL, INVOICE_TONE, PAYMENT_METHODS,
  type Invoice, type Receipt, type SupplierBalance, type SupplierPayment,
} from "@/lib/money";
import { money, shortDate } from "@/lib/format";

export function Receivables({
  quoteId, invoices, receipts, editable, sellTotal, soldFx,
}: {
  quoteId: number; invoices: Invoice[]; receipts: Receipt[];
  editable: boolean; sellTotal: number; soldFx: number;
}) {
  const [showNew, setShowNew] = useState(false);
  const issued = invoices.filter(i => i.status === "issued");
  const invoiced = issued.reduce((s, i) => s + (i.currency === "USD" ? i.amount : i.amount / soldFx), 0);
  const left = Math.max(0, sellTotal - invoiced);

  return (
    <div className="card">
      <h2>
        Client invoices
        <span className="side">
          {issued.length ? `${money(invoiced)} USD issued` : "nothing issued yet"}
        </span>
      </h2>

      {invoices.length === 0 ? (
        <div className="empty">
          <b>No invoices yet</b>
          {editable ? "Raise one below — the file cannot move on until an invoice is issued."
                    : "Finance raises these."}
        </div>
      ) : (
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr><th>Invoice</th><th>Due</th><th>Amount</th><th>Received</th><th>Outstanding</th><th>Status</th>{editable && <th />}</tr>
            </thead>
            <tbody>
              {invoices.map(inv => {
                const out = inv.amount - inv.received;
                const settled = inv.status === "issued" && out <= 0.005;
                return (
                  <tr key={inv.id}>
                    <td>
                      <Link href={`/quotes/${quoteId}/invoices/${inv.id}`} className="qtitle">
                        {inv.number ?? `Draft ${inv.id}`}
                      </Link>
                      <span className="qref">
                        {INVOICE_KIND_LABEL[inv.kind]}
                        {inv.issued_on ? ` · issued ${shortDate(inv.issued_on)}` : ""}
                      </span>
                    </td>
                    <td>{inv.due_on ? shortDate(inv.due_on) : "—"}</td>
                    <td>{money(inv.amount)} {inv.currency}</td>
                    <td style={{ color: inv.received > 0 ? "var(--ok)" : undefined }}>
                      {inv.received > 0 ? money(inv.received) : "—"}
                    </td>
                    <td style={{ color: settled ? "var(--faint)" : out > 0 ? "var(--warn)" : undefined }}>
                      {settled ? "settled" : money(out)}
                    </td>
                    <td><span className={`pill ${INVOICE_TONE[inv.status]}`}>{INVOICE_STATUS_LABEL[inv.status]}</span></td>
                    {editable && (
                      <td>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          {inv.status === "draft" && (
                            <StatusButton id={inv.id} to="issued" label="Issue" />
                          )}
                          {inv.status !== "void" && inv.received === 0 && (
                            <StatusButton id={inv.id} to="void" label="Void" danger />
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editable && (
        <div className="body" style={{ borderTop: "1px solid var(--line)", background: "var(--surface-2)" }}>
          {showNew ? (
            <form action={createInvoice} className="moneyGrid">
              <input type="hidden" name="quote_id" value={quoteId} />
              <label className="f">
                <span>Type</span>
                <select className="t" name="kind" defaultValue={issued.length ? "balance" : "deposit"}>
                  <option value="deposit">Deposit</option>
                  <option value="balance">Balance</option>
                  <option value="full">Full amount</option>
                </select>
              </label>
              <label className="f">
                <span>Amount</span>
                <input className="t num" type="number" step="any" min={0.01} name="amount"
                       defaultValue={left > 0 ? left.toFixed(2) : sellTotal.toFixed(2)} required />
              </label>
              <label className="f">
                <span>Currency</span>
                <select className="t" name="currency" defaultValue="USD">
                  <option value="USD">USD</option><option value="EGP">EGP</option>
                </select>
              </label>
              <label className="f">
                <span>Due date</span>
                <input className="t num" type="date" name="due_on" />
              </label>
              <label className="f" style={{ gridColumn: "span 2" }}>
                <span>Note on the invoice</span>
                <input className="t" name="notes" placeholder="payment terms, bank reference to quote" />
              </label>
              <div className="moneyActions">
                <button className="btn btn-go btn-sm" type="submit">Create invoice</button>
                <button className="btn btn-sm" type="button" onClick={() => setShowNew(false)}>Cancel</button>
              </div>
            </form>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <button className="btn btn-sm" type="button" onClick={() => setShowNew(true)}>+ Raise an invoice</button>
              <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                Quote total {money(sellTotal)} USD
                {issued.length > 0 && ` · ${money(invoiced)} invoiced · ${money(left)} not yet invoiced`}
              </span>
            </div>
          )}
        </div>
      )}

      {issued.length > 0 && editable && (
        <div className="body" style={{ borderTop: "1px solid var(--line)" }}>
          <ReceiptBlock invoices={issued} receipts={receipts} />
        </div>
      )}

      {!editable && receipts.length > 0 && (
        <div className="body" style={{ borderTop: "1px solid var(--line)" }}>
          <ReceiptList receipts={receipts} invoices={invoices} editable={false} />
        </div>
      )}

      <MoneyStyles />
    </div>
  );
}

function StatusButton({ id, to, label, danger }: { id: number; to: string; label: string; danger?: boolean }) {
  return (
    <form action={setInvoiceStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="to" value={to} />
      <button className={`mini${danger ? " danger" : ""}`} type="submit">{label}</button>
    </form>
  );
}

function ReceiptBlock({ invoices, receipts }: { invoices: Invoice[]; receipts: Receipt[] }) {
  const open = invoices.filter(i => i.amount - i.received > 0.005);
  const [target, setTarget] = useState<number | "">(open[0]?.id ?? "");
  const chosen = invoices.find(i => i.id === target);
  const owing = chosen ? chosen.amount - chosen.received : 0;

  return (
    <>
      <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 600 }}>Record a receipt</h3>
      {open.length === 0 ? (
        <p style={{ margin: "0 0 14px", color: "var(--ok)", fontSize: 13 }}>
          Every issued invoice is fully receipted.
        </p>
      ) : (
        <form action={recordReceipt} className="moneyGrid">
          <label className="f">
            <span>Against</span>
            <select className="t" name="invoice_id" value={target}
                    onChange={e => setTarget(Number(e.target.value))} required>
              {open.map(i => (
                <option key={i.id} value={i.id}>
                  {i.number ?? `Invoice ${i.id}`} — {money(i.amount - i.received)} {i.currency} due
                </option>
              ))}
            </select>
          </label>
          <label className="f">
            <span>Amount{chosen ? ` · ${chosen.currency}` : ""}</span>
            <input className="t num" type="number" step="any" min={0.01} name="amount"
                   defaultValue={owing > 0 ? owing.toFixed(2) : ""} required />
          </label>
          <label className="f">
            <span>Received on</span>
            <input className="t num" type="date" name="received_on"
                   defaultValue={new Date().toISOString().slice(0, 10)} />
          </label>
          <label className="f">
            <span>Method</span>
            <select className="t" name="method" defaultValue="Bank transfer">
              {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="f" style={{ gridColumn: "span 2" }}>
            <span>Bank reference</span>
            <input className="t" name="reference" placeholder="the reference on the statement" />
          </label>
          <div className="moneyActions">
            <button className="btn btn-go btn-sm" type="submit">Record receipt</button>
          </div>
        </form>
      )}
      {receipts.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <ReceiptList receipts={receipts} invoices={invoices} editable />
        </div>
      )}
    </>
  );
}

function ReceiptList({
  receipts, invoices, editable,
}: { receipts: Receipt[]; invoices: Invoice[]; editable: boolean }) {
  const numberOf = (id: number) => invoices.find(i => i.id === id)?.number ?? `#${id}`;
  return (
    <ul className="trail">
      {receipts.map(r => (
        <li key={r.id}>
          <span className="when">{shortDate(r.received_on)}</span>
          <span className="what">
            <b className="tabular">{money(r.amount)} {r.currency}</b> against {numberOf(r.invoice_id)}
            {r.method ? ` · ${r.method}` : ""}{r.reference ? ` · ${r.reference}` : ""}
          </span>
          <span className="who">
            {r.who ?? "—"}
            {editable && (
              <form action={deleteReceipt} style={{ display: "inline", marginLeft: 8 }}>
                <input type="hidden" name="id" value={r.id} />
                <button className="mini danger" type="submit" title="Remove this receipt">×</button>
              </form>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Payables({
  quoteId, balances, payments, editable, soldFx,
}: {
  quoteId: number; balances: SupplierBalance[]; payments: SupplierPayment[];
  editable: boolean; soldFx: number;
}) {
  const assigned = balances.filter(b => b.supplier_id !== null);
  const unassigned = balances.filter(b => b.supplier_id === null);
  const [supplier, setSupplier] = useState<string>(
    assigned.find(b => b.outstanding > 0.005) ? String(assigned.find(b => b.outstanding > 0.005)!.supplier_id) : ""
  );
  const chosen = assigned.find(b => String(b.supplier_id) === supplier);

  return (
    <div className="card">
      <h2>
        Supplier payments
        <span className="side">
          {assigned.length ? `${assigned.filter(b => b.outstanding > 0.005).length} still owed` : "nothing owed"}
        </span>
      </h2>

      {balances.length === 0 ? (
        <div className="empty">
          <b>Nothing to pay yet</b>
          What you owe appears here once operations assigns suppliers to the services.
        </div>
      ) : (
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr><th>Supplier</th><th>Owed</th><th>Paid</th><th>Outstanding</th></tr>
            </thead>
            <tbody>
              {balances.map(b => (
                <tr key={`${b.supplier_id}-${b.currency}`}>
                  <td>
                    <span className="qtitle">{b.supplier_name}</span>
                    <span className="qref">{b.currency}</span>
                  </td>
                  <td>{money(b.owed, b.currency === "USD" ? 2 : 0)}</td>
                  <td style={{ color: b.paid > 0 ? "var(--ok)" : undefined }}>
                    {b.paid > 0 ? money(b.paid, b.currency === "USD" ? 2 : 0) : "—"}
                  </td>
                  <td style={{ color: b.outstanding > 0.005 ? "var(--warn)" : "var(--faint)" }}>
                    {b.outstanding > 0.005 ? money(b.outstanding, b.currency === "USD" ? 2 : 0) : "settled"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {unassigned.length > 0 && (
        <div className="body" style={{ paddingTop: 0 }}>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--warn)" }}>
            Some services have no supplier assigned, so what they cost cannot be paid to anyone yet.
            Operations sets that on the services board.
          </p>
        </div>
      )}

      {editable && assigned.length > 0 && (
        <div className="body" style={{ borderTop: "1px solid var(--line)", background: "var(--surface-2)" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 600 }}>Record a payment out</h3>
          <form action={recordSupplierPayment} className="moneyGrid">
            <input type="hidden" name="quote_id" value={quoteId} />
            <label className="f">
              <span>Supplier</span>
              <select className="t" name="supplier_id" value={supplier}
                      onChange={e => setSupplier(e.target.value)} required>
                <option value="">— choose —</option>
                {assigned.map(b => (
                  <option key={`${b.supplier_id}-${b.currency}`} value={String(b.supplier_id)}>
                    {b.supplier_name} — {money(b.outstanding, b.currency === "USD" ? 2 : 0)} {b.currency} outstanding
                  </option>
                ))}
              </select>
            </label>
            <label className="f">
              <span>Amount</span>
              <input className="t num" type="number" step="any" min={0.01} name="amount"
                     defaultValue={chosen && chosen.outstanding > 0 ? chosen.outstanding.toFixed(2) : ""} required />
            </label>
            <label className="f">
              <span>Currency</span>
              <select className="t" name="currency" defaultValue={chosen?.currency ?? "EGP"} key={chosen?.currency}>
                <option value="EGP">EGP</option><option value="USD">USD</option>
              </select>
            </label>
            <label className="f">
              <span>Rate today · EGP/USD</span>
              <input className="t num" type="number" step="any" min={0} name="fx_rate"
                     defaultValue={soldFx} title="The rate on the day you actually paid" />
            </label>
            <label className="f">
              <span>Paid on</span>
              <input className="t num" type="date" name="paid_on"
                     defaultValue={new Date().toISOString().slice(0, 10)} />
            </label>
            <label className="f">
              <span>Method</span>
              <select className="t" name="method" defaultValue="Bank transfer">
                {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="f" style={{ gridColumn: "span 2" }}>
              <span>Reference</span>
              <input className="t" name="reference" placeholder="transfer reference or supplier invoice no." />
            </label>
            <div className="moneyActions">
              <button className="btn btn-go btn-sm" type="submit">Record payment</button>
              <span style={{ fontSize: 12, color: "var(--muted)", alignSelf: "center" }}>
                The rate you enter is what the margin report uses for this payment.
              </span>
            </div>
          </form>
        </div>
      )}

      {payments.length > 0 && (
        <div className="body" style={{ borderTop: "1px solid var(--line)" }}>
          <ul className="trail">
            {payments.map(p => (
              <li key={p.id}>
                <span className="when">{shortDate(p.paid_on)}</span>
                <span className="what">
                  <b className="tabular">{money(p.amount, p.currency === "USD" ? 2 : 0)} {p.currency}</b>
                  {" to "}{p.supplier_name ?? "—"}
                  {p.currency === "EGP" && p.fx_rate ? ` · at ${money(p.fx_rate, 2)}` : ""}
                  {p.reference ? ` · ${p.reference}` : ""}
                </span>
                <span className="who">
                  {p.who ?? "—"}
                  {editable && (
                    <form action={deleteSupplierPayment} style={{ display: "inline", marginLeft: 8 }}>
                      <input type="hidden" name="id" value={p.id} />
                      <button className="mini danger" type="submit" title="Remove this payment">×</button>
                    </form>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <MoneyStyles />
    </div>
  );
}

function MoneyStyles() {
  return (
    <style>{`
      .moneyGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:12px}
      .moneyActions{grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap}
      @media (max-width:640px){ .moneyGrid{grid-template-columns:1fr} }
    `}</style>
  );
}
