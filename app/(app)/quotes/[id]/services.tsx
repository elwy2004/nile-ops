"use client";

import { useState } from "react";
import { updateBooking, bulkAssignSupplier } from "@/lib/actions";
import { SECTIONS, SECTION_ORDER, type Section } from "@/lib/pricing";
import {
  BOOKING_LABEL, BOOKING_TONE, SECTION_KIND, isSettled,
  voucherNo, type Booking, type BookingStatus, type Supplier,
} from "@/lib/bookings";
import { money } from "@/lib/format";

/* The operations board: one row per sold service, each needing a supplier,
   a confirmation and — once known — what it actually costs. */
export default function Services({
  quoteRef, bookings, suppliers, editable,
}: {
  quoteRef: string; bookings: Booking[]; suppliers: Supplier[]; editable: boolean;
}) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="grid">
      {SECTION_ORDER.map(section => {
        const rows = bookings.filter(b => b.section === section);
        if (!rows.length) return null;
        const dp = SECTIONS[section].cur === "USD" ? 2 : 0;
        const left = rows.filter(b => !isSettled(b)).length;
        const preferred = suppliers.filter(s => s.kind === SECTION_KIND[section]);
        const others = suppliers.filter(s => s.kind !== SECTION_KIND[section]);

        return (
          <div className="card" key={section}>
            <h2>
              {SECTIONS[section].label}
              <span className={`pill ${left ? "ops" : "finance"}`} style={{ marginLeft: 4 }}>
                {left ? `${left} to confirm` : "All settled"}
              </span>
              {editable && (
                <form action={bulkAssignSupplier} className="side" style={{ display: "flex", gap: 6 }}>
                  <input type="hidden" name="quote_id" value={rows[0].quote_id} />
                  <input type="hidden" name="section" value={section} />
                  <select className="t" name="supplier_id" defaultValue="" style={{ padding: "4px 7px", width: 170 }}
                          aria-label={`Assign all ${SECTIONS[section].label} to a supplier`}>
                    <option value="">Assign all to…</option>
                    <SupplierOptions preferred={preferred} others={others} />
                  </select>
                  <button className="btn btn-sm" type="submit">Apply</button>
                </form>
              )}
            </h2>
            <div className="tablewrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Service</th><th>Supplier</th><th>Date</th><th>Confirmation</th>
                    <th>Quoted</th><th>Actual</th><th>Status</th>{editable && <th />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(b => {
                    const isOpen = open === b.id;
                    const over = b.actual_cost !== null && b.actual_cost > b.quoted_cost;
                    const under = b.actual_cost !== null && b.actual_cost < b.quoted_cost;
                    return (
                      <tr key={b.id}>
                        <td colSpan={isOpen ? 8 : undefined} style={isOpen ? { padding: 0 } : undefined}>
                          {isOpen ? (
                            <EditRow b={b} preferred={preferred} others={others}
                                     onClose={() => setOpen(null)} quoteRef={quoteRef} />
                          ) : (
                            <>
                              <span className="qtitle">{b.item_name}</span>
                              <span className="qref">
                                {b.qty} × · voucher {voucherNo(quoteRef, b.sort)}
                              </span>
                            </>
                          )}
                        </td>
                        {!isOpen && (
                          <>
                            <td style={{ textAlign: "left", fontFamily: "var(--sans)" }}>
                              {b.supplier_name ?? <span style={{ color: "var(--faint)" }}>not assigned</span>}
                            </td>
                            <td>{b.service_date ? String(b.service_date).slice(0, 10) : "—"}</td>
                            <td style={{ textAlign: "left" }}>
                              {b.confirmation_no || <span style={{ color: "var(--faint)" }}>—</span>}
                            </td>
                            <td>{money(b.quoted_cost, dp)}</td>
                            <td style={{ color: over ? "var(--crit)" : under ? "var(--ok)" : undefined }}>
                              {b.actual_cost === null ? "—" : money(b.actual_cost, dp)}
                            </td>
                            <td>
                              <span className={`pill ${BOOKING_TONE[b.status]}`}>{BOOKING_LABEL[b.status]}</span>
                            </td>
                            {editable && (
                              <td>
                                <button className="mini" type="button" onClick={() => setOpen(b.id)}>Edit</button>
                              </td>
                            )}
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SupplierOptions({ preferred, others }: { preferred: Supplier[]; others: Supplier[] }) {
  return (
    <>
      {preferred.length > 0 && (
        <optgroup label="Usual for this service">
          {preferred.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </optgroup>
      )}
      {others.length > 0 && (
        <optgroup label="Other suppliers">
          {others.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </optgroup>
      )}
    </>
  );
}

function EditRow({
  b, preferred, others, onClose, quoteRef,
}: {
  b: Booking; preferred: Supplier[]; others: Supplier[]; onClose: () => void; quoteRef: string;
}) {
  const [status, setStatus] = useState<BookingStatus>(b.status);
  const [supplier, setSupplier] = useState(b.supplier_id ? String(b.supplier_id) : "");
  const [ref, setRef] = useState(b.confirmation_no);
  const needsRef = status === "confirmed" && (supplier === "" || ref.trim() === "");
  const dp = b.currency === "USD" ? 2 : 0;

  return (
    <form action={updateBooking} className="bookEdit">
      <input type="hidden" name="id" value={b.id} />
      <div className="bookHead">
        <strong>{b.item_name}</strong>
        <span className="qref">{b.qty} × · quoted {money(b.quoted_cost, dp)} {b.currency}
          {" · voucher "}{voucherNo(quoteRef, b.sort)}</span>
      </div>
      <div className="bookGrid">
        <label className="f">
          <span>Supplier</span>
          <select className="t" name="supplier_id" value={supplier} onChange={e => setSupplier(e.target.value)}>
            <option value="">— not assigned —</option>
            <SupplierOptions preferred={preferred} others={others} />
          </select>
        </label>
        <label className="f">
          <span>Service date</span>
          <input className="t num" type="date" name="service_date"
                 defaultValue={b.service_date ? String(b.service_date).slice(0, 10) : ""} />
        </label>
        <label className="f">
          <span>Confirmation no.</span>
          <input className="t" name="confirmation_no" value={ref} onChange={e => setRef(e.target.value)}
                 placeholder="supplier's reference" />
        </label>
        <label className="f">
          <span>Actual cost · {b.currency}</span>
          <input className="t num" type="number" step="any" min={0} name="actual_cost"
                 defaultValue={b.actual_cost ?? ""} placeholder={money(b.quoted_cost, dp)} />
        </label>
        <label className="f">
          <span>Status</span>
          <select className="t" name="status" value={status}
                  onChange={e => setStatus(e.target.value as BookingStatus)}>
            <option value="pending">{BOOKING_LABEL.pending}</option>
            <option value="requested">{BOOKING_LABEL.requested}</option>
            <option value="confirmed">{BOOKING_LABEL.confirmed}</option>
            <option value="cancelled">{BOOKING_LABEL.cancelled}</option>
          </select>
        </label>
        <label className="f" style={{ gridColumn: "span 2" }}>
          <span>Note</span>
          <input className="t" name="notes" defaultValue={b.notes} placeholder="room type, pick-up time, anything the guide needs" />
        </label>
      </div>
      {needsRef && (
        <p className="bookWarn">
          A confirmed booking needs a supplier and their confirmation number.
        </p>
      )}
      <div className="bookActions">
        <button className="btn btn-go btn-sm" type="submit" disabled={needsRef}>Save</button>
        <button className="btn btn-sm" type="button" onClick={onClose}>Cancel</button>
      </div>

      <style>{`
        .bookEdit{padding:14px;background:var(--surface-2);border-left:3px solid var(--accent)}
        .bookHead{margin-bottom:12px}
        .bookGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
        .bookWarn{margin:12px 0 0;font-size:12.5px;color:var(--warn)}
        .bookActions{display:flex;gap:8px;margin-top:14px}
        @media (max-width:640px){ .bookGrid{grid-template-columns:1fr} }
      `}</style>
    </form>
  );
}
