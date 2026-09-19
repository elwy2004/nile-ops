import "server-only";
import { q } from "./db";
import { DESK_STATUSES, type DeskFile } from "./desks";
import type { Role } from "./workflow";

export * from "./desks";

/** Every file currently sitting on one desk, newest activity first. */
export async function deskFiles(role: Role): Promise<DeskFile[]> {
  const statuses = DESK_STATUSES[role] ?? [];
  if (statuses.length === 0) return [];

  return q<DeskFile>(
    `SELECT qt.id, qt.ref, qt.title, qt.client_name, qt.status, qt.pax,
            qt.arrival, qt.departure, qt.fx::float8 AS fx, qt.updated_at,
            COALESCE((qt.snapshot->'totals'->>'grpSell')::float8, 0)   AS sell_usd,
            COALESCE((qt.snapshot->'totals'->>'grpProfit')::float8, 0) AS margin_usd,
            COALESCE(bk.total,0)::int    AS services_total,
            COALESCE(bk.open,0)::int     AS services_open,
            bk.next_service,
            COALESCE(inv.invoiced,0)::float8 AS invoiced_usd,
            COALESCE(inv.received,0)::float8 AS received_usd,
            COALESCE(bk.cost,0)::float8      AS cost_usd,
            COALESCE(pay.paid,0)::float8     AS paid_usd
       FROM quotes qt
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE b.status IN ('pending','requested')) AS open,
                MIN(b.service_date) FILTER (WHERE b.status <> 'cancelled') AS next_service,
                SUM(CASE WHEN b.currency='USD' THEN COALESCE(b.actual_cost,b.quoted_cost)
                         ELSE COALESCE(b.actual_cost,b.quoted_cost)/NULLIF(qt.fx,0) END) AS cost
           FROM bookings b WHERE b.quote_id = qt.id AND b.status <> 'cancelled'
       ) bk ON TRUE
       LEFT JOIN LATERAL (
         SELECT SUM(CASE WHEN i.currency='USD' THEN i.amount ELSE i.amount/NULLIF(qt.fx,0) END) AS invoiced,
                SUM(CASE WHEN i.currency='USD' THEN r.got   ELSE r.got  /NULLIF(qt.fx,0) END) AS received
           FROM invoices i
           LEFT JOIN LATERAL (
             SELECT COALESCE(SUM(amount),0) AS got FROM receipts WHERE invoice_id = i.id
           ) r ON TRUE
          WHERE i.quote_id = qt.id AND i.status = 'issued'
       ) inv ON TRUE
       LEFT JOIN LATERAL (
         SELECT SUM(CASE WHEN p.currency='USD' THEN p.amount
                         ELSE p.amount/NULLIF(COALESCE(p.fx_rate, qt.fx),0) END) AS paid
           FROM supplier_payments p WHERE p.quote_id = qt.id
       ) pay ON TRUE
      WHERE qt.status = ANY($1)
      ORDER BY qt.updated_at DESC`,
    [statuses]
  );
}
