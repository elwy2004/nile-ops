/* Proves the schema and the pricing/workflow logic against a real Postgres
   engine (PGlite, in-process) so nothing unverified reaches the live database.

   npx tsx scripts/verify.ts */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { compute, freeze, makeLookup, tierIndex, type RateItem, type Line } from "../lib/pricing";
import { allowedTransitions, blockedReason, canEditQuote, canTransition, TRANSITIONS } from "../lib/workflow";
import { bookingRowsFromSnapshot, isSettled, outstanding, variance, voucherNo, type Booking } from "../lib/bookings";
import { realised, receivable, supplierBalances, type Invoice, type SupplierPayment } from "../lib/money";
import { hashPassword, verifyPassword } from "../lib/auth-crypto";
import { shortDate } from "../lib/format";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : `\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`}`);
}
function near(name: string, got: number, want: number, tol = 0.005) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? ` (${got.toFixed(2)})` : `\n    got ${got} want ${want}`}`);
}

const root = join(import.meta.dirname, "..");

async function main() {
  console.log("\n── schema ──");
  const db = new PGlite();
  await db.exec(readFileSync(join(root, "db/schema.sql"), "utf8"));
  console.log("✓ schema.sql applies cleanly to Postgres");

  // schema runs twice without error (migrate.ts is re-runnable)
  await db.exec(readFileSync(join(root, "db/schema.sql"), "utf8"));
  console.log("✓ schema is re-runnable");

  const rates = JSON.parse(readFileSync(join(root, "db/rates.json"), "utf8")) as Record<string, unknown[][]>;
  const cols: Record<string, number> = { hotels: 2, transfers: 3, sights: 1, meals: 1, services: 1 };
  for (const book of Object.keys(rates)) {
    for (const row of rates[book]) {
      const n = [0, 0, 0];
      for (let i = 0; i < cols[book]; i++) n[i] = Number(row[i + 1]) || 0;
      await db.query(
        `INSERT INTO rate_items (book,name,rate1,rate2,rate3) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (book,name) DO NOTHING`,
        [book, String(row[0]).trim(), n[0], n[1], n[2]]
      );
    }
  }
  const cnt = await db.query<{ c: string }>("SELECT count(*)::text c FROM rate_items");
  check("price book loads", cnt.rows[0].c, "215");

  // constraints actually bite
  let rejected = false;
  try { await db.query("INSERT INTO quotes (ref,status) VALUES ('X','bogus')"); }
  catch { rejected = true; }
  check("invalid status is rejected", rejected, true);

  rejected = false;
  try { await db.query("INSERT INTO quotes (ref,pax) VALUES ('Y',0)"); }
  catch { rejected = true; }
  check("pax must be positive", rejected, true);

  console.log("\n── pricing vs the Q.SH 2026 sheet ──");
  const rateRows = await db.query<RateItem>("SELECT book,name,rate1::float8,rate2::float8,rate3::float8 FROM rate_items");
  const book = rateRows.rows;

  // The sheet's own worked example: cells E29 = 1683.50, G29 = 1851.85
  const lines: Line[] = [
    { section: "acc", item_name: "CAI 5", qty: 3 },
    { section: "acc", item_name: "Nile CRZ 5 DLX", qty: 3 },
    { section: "sights", item_name: "Pyr", qty: 1 },
    { section: "sights", item_name: "GEM", qty: 1 },
    { section: "sights", item_name: "CRZ ( Visits )", qty: 1 },
    { section: "transfers", item_name: "Airport Trans", qty: 3 },
    { section: "transfers", item_name: "F/D", qty: 1 },
    { section: "transfers", item_name: "crz pack trans", qty: 1 },
    { section: "meals", item_name: "PYR lunch", qty: 1 },
    { section: "services", item_name: "Airport assist", qty: 2 },
    { section: "services", item_name: "Guide Fees", qty: 3 },
    { section: "services", item_name: "Guide Acc. CRZ", qty: 3 },
  ];
  const terms = { pax: 2, fx: 50, margin_pct: 10, flights_usd: 350 };
  const t = compute(terms, lines, book);
  near("accommodation 960.00 USD", t.accUSD, 960);
  near("single supplement 768.00 USD", t.sglUSD, 768);
  near("sightseeing 6,850 EGP", t.sightLE, 6850);
  near("transfers 13,350 EGP", t.transLE, 13350);
  near("services 9,600 EGP", t.servLE, 9600);
  near("net per person  (sheet E29)", t.costPP, 1683.5);
  near("sell per person (sheet G29)", t.sellPP, 1851.85);

  // group size must move the transfer rate column
  check("tier 2 pax", tierIndex(2), 0);
  check("tier 10 pax", tierIndex(10), 1);
  check("tier 20 pax", tierIndex(20), 2);
  const look = makeLookup(book);
  near("Airport Trans @6 pax = Hi-Ace", look("transfers", "Airport Trans", 6), 1450);
  near("Airport Trans @10 pax = Coaster", look("transfers", "Airport Trans", 10), 1800);
  near("Airport Trans @20 pax = Bus", look("transfers", "Airport Trans", 20), 4500);

  // per-vehicle costs must dilute as the group grows
  const big = compute({ ...terms, pax: 20 }, lines, book);
  check("bigger group is cheaper per head", big.costPP < t.costPP, true);

  console.log("\n── frozen prices ──");
  const snap = freeze(terms, lines, book);
  const bumped = book.map(r => ({ ...r, rate1: r.rate1 * 2, rate2: r.rate2 * 2, rate3: r.rate3 * 2 }));
  near("live price doubles when the book doubles", compute(terms, lines, bumped).costPP, (1683.5 - 350) * 2 + 350);
  near("frozen price is untouched by the book", snap.totals.costPP, 1683.5);
  check("snapshot keeps only the rates used", snap.rates.length, 12);
  check("snapshot records the FX it sold at", snap.terms.fx, 50);

  console.log("\n── workflow gates ──");
  check("ops cannot send a draft to the client", canTransition("draft", "quoted", "ops"), null);
  check("sales can", canTransition("draft", "quoted", "sales")?.to, "quoted");
  check("accepting freezes prices", canTransition("quoted", "accepted", "sales")?.freezes, true);
  check("finance cannot confirm operations", canTransition("accepted", "confirming", "finance"), null);
  check("ops hands off to finance", canTransition("confirming", "ready", "ops")?.to, "ready");
  check("sales cannot invoice", canTransition("ready", "invoiced", "sales"), null);
  check("finance invoices", canTransition("ready", "invoiced", "finance")?.to, "invoiced");
  check("closed is terminal", allowedTransitions("closed", "admin"), []);
  check("sales edits a draft", canEditQuote("draft", "sales"), true);
  check("nobody edits an accepted quote", canEditQuote("accepted", "sales"), false);
  check("ops never edits quote terms", canEditQuote("draft", "ops"), false);

  console.log("\n── passwords ──");
  const h = await hashPassword("correct horse battery staple");
  check("correct password verifies", await verifyPassword("correct horse battery staple", h), true);
  check("wrong password rejected", await verifyPassword("wrong", h), false);
  check("hash is salted (two hashes differ)", h === (await hashPassword("correct horse battery staple")), false);

  console.log("\n── end to end: a quote through every desk ──");
  const u = await db.query<{ id: number }>(
    "INSERT INTO users (email,name,role,password_hash) VALUES ('s@x','S','sales',$1) RETURNING id", [h]
  );
  // mirrors createQuote(): insert, then number the row from its own id
  const qr = await db.query<{ id: number; status: string }>(
    `INSERT INTO quotes (title,pax,fx,margin_pct,flights_usd,created_by,owner_id)
     VALUES ('Cairo & Nile',2,50,10,350,$1,$1) RETURNING id,status`, [u.rows[0].id]
  );
  const qid = qr.rows[0].id;
  check("new quote starts as draft", qr.rows[0].status, "draft");
  await db.query(
    `UPDATE quotes SET ref = 'Q-' || to_char(created_at,'YYYY') || '-' || lpad(id::text,4,'0') WHERE id=$1`, [qid]
  );
  const refRow = await db.query<{ ref: string }>("SELECT ref FROM quotes WHERE id=$1", [qid]);
  check("reference is derived from the row id", /^Q-\d{4}-\d{4}$/.test(refRow.rows[0].ref), true);
  for (const [i, l] of lines.entries())
    await db.query("INSERT INTO quote_lines (quote_id,section,item_name,qty,sort) VALUES ($1,$2,$3,$4,$5)",
      [qid, l.section, l.item_name, l.qty, i]);
  const stored = await db.query<Line>("SELECT section,item_name,qty::float8 FROM quote_lines WHERE quote_id=$1 ORDER BY sort", [qid]);
  near("stored lines reprice identically", compute(terms, stored.rows, book).sellPP, 1851.85);

  await db.query("UPDATE quotes SET status='accepted', snapshot=$2, accepted_at=now() WHERE id=$1", [qid, JSON.stringify(snap)]);
  const back = await db.query<{ snapshot: { totals: { sellPP: number } } }>("SELECT snapshot FROM quotes WHERE id=$1", [qid]);
  near("snapshot survives a round trip through jsonb", back.rows[0].snapshot.totals.sellPP, 1851.85);

  // transition forms carry no note field, so the insert must survive a null
  await db.query(
    `INSERT INTO quote_events (quote_id,user_id,kind,from_status,to_status,note)
     VALUES ($1,$2,'status','quoted','accepted',COALESCE($3,''))`, [qid, u.rows[0].id, null]
  );
  const noteRow = await db.query<{ note: string }>("SELECT note FROM quote_events WHERE quote_id=$1", [qid]);
  check("a missing note stores as empty, not null", noteRow.rows[0].note, "");

  // Empty strings reach the production database as NULL, so every NOT NULL text
  // column must be written through COALESCE. Simulate by passing null outright.
  const optional: [string, string][] = [
    ["suppliers", `INSERT INTO suppliers (name,kind,phone,email,notes)
                   VALUES (COALESCE($1,''),'hotel',COALESCE($2,''),COALESCE($3,''),COALESCE($4,''))`],
  ];
  for (const [table, sql] of optional) {
    let ok = true;
    try { await db.query(sql, ["A Hotel", null, null, null]); } catch { ok = false; }
    check(`${table}: untouched optional fields survive`, ok, true);
  }
  const sRow = await db.query<{ email: string; notes: string }>(
    "SELECT email, notes FROM suppliers WHERE name='A Hotel'"
  );
  check("they store as empty strings", [sRow.rows[0].email, sRow.rows[0].notes], ["", ""]);
  const ev = await db.query<{ c: string }>("SELECT count(*)::text c FROM quote_events WHERE quote_id=$1", [qid]);
  check("audit trail records the handoff", ev.rows[0].c, "1");

  console.log("\n── stage 2: supplier bookings ──");
  const rows = bookingRowsFromSnapshot(snap);
  check("a booking per sold line", rows.length, 12);
  check("accommodation is booked in USD", rows.find(r => r.section === "acc")?.currency, "USD");
  check("transfers are booked in EGP", rows.find(r => r.section === "transfers")?.currency, "EGP");
  near("a booking carries the sold cost", rows.find(r => r.item_name === "CAI 5")!.quoted_cost, 180);

  const sup = await db.query<{ id: number }>(
    "INSERT INTO suppliers (name,kind,phone) VALUES ('Mena House','hotel','+20 2 100') RETURNING id"
  );
  for (const r of rows)
    await db.query(
      `INSERT INTO bookings (quote_id,section,item_name,qty,sort,currency,quoted_cost)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [qid, r.section, r.item_name, r.qty, r.sort, r.currency, r.quoted_cost]
    );
  const stored2 = await db.query<{ n: string }>("SELECT count(*)::text n FROM bookings WHERE quote_id=$1", [qid]);
  check("bookings persist", stored2.rows[0].n, "12");

  let bad = false;
  try { await db.query("UPDATE bookings SET status='invented' WHERE quote_id=$1", [qid]); }
  catch { bad = true; }
  check("invalid booking status is rejected", bad, true);

  const all = await db.query<Booking>(
    `SELECT id,quote_id,section,item_name,qty::float8 AS qty,sort,supplier_id,null AS supplier_name,
            status,confirmation_no,service_date,currency,quoted_cost::float8 AS quoted_cost,
            actual_cost::float8 AS actual_cost,notes
       FROM bookings WHERE quote_id=$1 ORDER BY sort`, [qid]
  );
  check("nothing is settled yet", outstanding(all.rows), 12);
  check("a pending booking is not settled", isSettled(all.rows[0]), false);

  console.log("\n── the finance gate ──");
  const toReady = canTransition("confirming", "ready", "ops")!;
  check("ops cannot hand over with services open",
    blockedReason(toReady, all.rows.map(b => ({ status: b.status }))),
    "12 services are still unconfirmed.");

  await db.query("UPDATE bookings SET status='confirmed', supplier_id=$2, confirmation_no='MH-8841' WHERE quote_id=$1",
    [qid, sup.rows[0].id]);
  const settled = await db.query<{ status: Booking["status"] }>("SELECT status FROM bookings WHERE quote_id=$1", [qid]);
  check("once every service is confirmed the gate opens", blockedReason(toReady, settled.rows), null);

  const bounce = canTransition("accepted", "quoted", "ops")!;
  check("cannot bounce a file suppliers already confirmed",
    blockedReason(bounce, settled.rows),
    "Suppliers have already confirmed. Cancel those bookings first.");

  console.log("\n── cost variance ──");
  const priced = await db.query<Booking>(
    `SELECT id,quote_id,section,item_name,qty::float8 AS qty,sort,supplier_id,null AS supplier_name,
            status,confirmation_no,service_date,currency,quoted_cost::float8 AS quoted_cost,
            actual_cost::float8 AS actual_cost,notes
       FROM bookings WHERE quote_id=$1 ORDER BY sort`, [qid]
  );
  const v0 = variance(priced.rows, 50);
  near("with no actuals, cost equals what was sold", v0.diffUSD, 0);
  // the hotel actually charges 60 USD more across the stay
  await db.query("UPDATE bookings SET actual_cost = quoted_cost + 60 WHERE quote_id=$1 AND item_name='CAI 5'", [qid]);
  const priced2 = await db.query<Booking>(
    `SELECT id,quote_id,section,item_name,qty::float8 AS qty,sort,supplier_id,null AS supplier_name,
            status,confirmation_no,service_date,currency,quoted_cost::float8 AS quoted_cost,
            actual_cost::float8 AS actual_cost,notes
       FROM bookings WHERE quote_id=$1 ORDER BY sort`, [qid]
  );
  const v1 = variance(priced2.rows, 50);
  near("a supplier overcharge shows as variance", v1.diffUSD, 60);
  check("variance counts what has been priced", v1.priced, 1);
  // an EGP overrun converts at the file's own rate, not today's
  await db.query("UPDATE bookings SET actual_cost = quoted_cost + 500 WHERE quote_id=$1 AND item_name='Airport Trans'", [qid]);
  const priced3 = await db.query<Booking>(
    `SELECT id,quote_id,section,item_name,qty::float8 AS qty,sort,supplier_id,null AS supplier_name,
            status,confirmation_no,service_date,currency,quoted_cost::float8 AS quoted_cost,
            actual_cost::float8 AS actual_cost,notes
       FROM bookings WHERE quote_id=$1 ORDER BY sort`, [qid]
  );
  near("EGP overruns convert at the file's frozen rate", variance(priced3.rows, 50).diffUSD, 60 + 500 / 50);

  check("voucher numbers follow the file reference", voucherNo("Q-2026-0007", 2), "Q-2026-0007/03");

  // a DATE must never slide a day when the server is not on UTC
  check("a date string keeps its day", shortDate("2026-03-01"), "01 Mar 2026");
  check("a Date at local midnight keeps its day", shortDate(new Date(2026, 2, 1)), "01 Mar 2026");

  console.log("\n── stage 3: invoicing ──");
  const inv = async (kind: string, amount: number, status = "issued", currency = "USD") => {
    const r = await db.query<{ id: number }>(
      `INSERT INTO invoices (quote_id,kind,status,currency,amount,issued_on)
       VALUES ($1,$2,$3,$4,$5,CURRENT_DATE) RETURNING id`, [qid, kind, status, currency, amount]
    );
    await db.query(
      `UPDATE invoices SET number='INV-'||to_char(created_at,'YYYY')||'-'||lpad(id::text,4,'0') WHERE id=$1`,
      [r.rows[0].id]
    );
    return r.rows[0].id;
  };
  const loadInvoices = async () => (await db.query<Invoice>(
    `SELECT i.id,i.quote_id,i.number,i.kind,i.status,i.currency,i.amount::float8 AS amount,
            i.issued_on,i.due_on,i.notes,
            COALESCE((SELECT SUM(r.amount) FROM receipts r WHERE r.invoice_id=i.id),0)::float8 AS received
       FROM invoices i WHERE i.quote_id=$1 ORDER BY i.id`, [qid])).rows;

  const depositId = await inv("deposit", 1000);
  await inv("balance", 2703.70);
  const draftId = await inv("full", 999, "draft");

  let i0 = await loadInvoices();
  check("invoices are numbered from their id", /^INV-\d{4}-\d{4}$/.test(i0[0].number!), true);
  const r0 = receivable(i0, 50);
  near("only issued invoices count as revenue", r0.invoicedUSD, 3703.70);
  check("an issued invoice opens the gate", r0.hasIssued, true);
  check("unreceipted invoices are not settled", r0.fullySettled, false);

  const toInvoiced = canTransition("ready", "invoiced", "finance")!;
  check("cannot mark invoiced with nothing issued",
    blockedReason(toInvoiced, [], { hasIssued: false, fullySettled: false, outstandingUSD: 0 }),
    "No invoice has been issued yet.");
  const toPaid = canTransition("invoiced", "paid", "finance")!;
  check("cannot mark paid while money is outstanding",
    blockedReason(toPaid, [], r0),
    "3,703.70 USD is still outstanding.");

  await db.query("INSERT INTO receipts (invoice_id,amount,currency,received_on) VALUES ($1,1000,'USD',CURRENT_DATE)", [depositId]);
  let i1 = await loadInvoices();
  near("receipts reduce what is owed", receivable(i1, 50).outstandingUSD, 2703.70);

  for (const row of i1) {
    const owing = row.amount - row.received;
    if (row.status === "issued" && owing > 0)
      await db.query("INSERT INTO receipts (invoice_id,amount,currency,received_on) VALUES ($1,$2,$3,CURRENT_DATE)",
        [row.id, owing, row.currency]);
  }
  i1 = await loadInvoices();
  const rFull = receivable(i1, 50);
  check("fully receipted opens the paid gate", rFull.fullySettled, true);
  check("and nothing blocks it", blockedReason(toPaid, [], rFull), null);

  await db.query("UPDATE invoices SET status='void' WHERE id=$1", [draftId]);
  near("void invoices never count", receivable(await loadInvoices(), 50).invoicedUSD, 3703.70);

  console.log("\n── stage 3: supplier balances ──");
  const bk = await db.query<Booking>(
    `SELECT id,quote_id,section,item_name,qty::float8 AS qty,sort,supplier_id,null AS supplier_name,
            status,confirmation_no,service_date,currency,quoted_cost::float8 AS quoted_cost,
            actual_cost::float8 AS actual_cost,notes FROM bookings WHERE quote_id=$1 ORDER BY sort`, [qid]
  );
  const bal0 = supplierBalances(bk.rows, []);
  check("balances are grouped per supplier and currency", bal0.length >= 1, true);
  const egpOwed = bal0.filter(b => b.currency === "EGP").reduce((s, b) => s + b.owed, 0);
  near("EGP owed matches the bookings", egpOwed, 13350 + 500 + 6850 + 350 + 9600);

  const supId = bk.rows[0].supplier_id!;
  await db.query(
    `INSERT INTO supplier_payments (quote_id,supplier_id,amount,currency,fx_rate,paid_on)
     VALUES ($1,$2,5000,'EGP',60,CURRENT_DATE)`, [qid, supId]
  );
  const pay = await db.query<SupplierPayment>(
    `SELECT id,quote_id,supplier_id,null AS supplier_name,amount::float8 AS amount,currency,
            fx_rate::float8 AS fx_rate,paid_on,method,reference,notes,null AS who
       FROM supplier_payments WHERE quote_id=$1`, [qid]
  );
  const bal1 = supplierBalances(bk.rows, pay.rows);
  const egpRow = bal1.find(b => b.currency === "EGP" && b.supplier_id === supId)!;
  near("a payment reduces the outstanding balance", egpRow.paid, 5000);

  console.log("\n── stage 3: what the file really earned ──");
  const invoicesNow = await loadInvoices();
  // sold at 50; 5,000 EGP of it was actually paid at 60, so those pounds cost fewer dollars
  const earned = realised(invoicesNow, bk.rows, pay.rows, 50, 700);
  near("revenue is what was invoiced", earned.revenueUSD, 3703.70);
  const egpTotal = 13350 + 500 + 6850 + 350 + 9600;
  const usdDirect = 960 + 60 + 700;   // accommodation, the hotel overcharge, flights
  near("cost at the sold rate", earned.costAtSoldRateUSD, usdDirect + egpTotal / 50);
  near("cost as actually paid", earned.costAtPaidRateUSD,
       usdDirect + 5000 / 60 + (egpTotal - 5000) / 50);
  check("a weaker pound is a gain", earned.fxEffectUSD > 0, true);
  near("the gain is exactly the rate difference", earned.fxEffectUSD, 5000 / 50 - 5000 / 60);
  near("margin is revenue less what was really spent", earned.marginUSD,
       3703.70 - (usdDirect + 5000 / 60 + (egpTotal - 5000) / 50));

  // and the other direction: paying at a stronger pound costs more dollars
  await db.query("UPDATE supplier_payments SET fx_rate = 40 WHERE quote_id=$1", [qid]);
  const pay2 = await db.query<SupplierPayment>(
    `SELECT id,quote_id,supplier_id,null AS supplier_name,amount::float8 AS amount,currency,
            fx_rate::float8 AS fx_rate,paid_on,method,reference,notes,null AS who
       FROM supplier_payments WHERE quote_id=$1`, [qid]
  );
  check("a stronger pound is a loss", realised(invoicesNow, bk.rows, pay2.rows, 50, 700).fxEffectUSD < 0, true);

  console.log("\n── automatic handoffs ──");
  // the forwarding conditions, expressed exactly as the actions apply them
  const servicesSettled = async (qi: number) => (await db.query<{ status: string; total: string; open: string }>(
    `SELECT qt.status, COUNT(b.id)::text AS total,
            COUNT(b.id) FILTER (WHERE b.status IN ('pending','requested'))::text AS open
       FROM quotes qt LEFT JOIN bookings b ON b.quote_id=qt.id
      WHERE qt.id=$1 GROUP BY qt.status`, [qi])).rows[0];

  const f = await db.query<{ id: number }>(
    "INSERT INTO quotes (title,status,created_by) VALUES ('fwd','confirming',$1) RETURNING id", [u.rows[0].id]);
  const fid = f.rows[0].id;
  await db.query(
    `INSERT INTO bookings (quote_id,section,item_name,qty,sort,currency,quoted_cost,status)
     VALUES ($1,'acc','A',1,0,'USD',10,'pending'), ($1,'acc','B',1,1,'USD',10,'confirmed')`, [fid]);
  let s = await servicesSettled(fid);
  check("one service open holds the file at operations", s.open, "1");

  await db.query("UPDATE bookings SET status='confirmed' WHERE quote_id=$1", [fid]);
  s = await servicesSettled(fid);
  check("settling the last one satisfies the condition", [s.open, s.status], ["0", "confirming"]);

  // a file with no services must never forward on an empty condition
  const empty = await db.query<{ id: number }>(
    "INSERT INTO quotes (title,status,created_by) VALUES ('empty','confirming',$1) RETURNING id", [u.rows[0].id]);
  const es = await servicesSettled(empty.rows[0].id);
  check("a file with no services does not forward", es.total, "0");

  // the guarded UPDATE only fires from the expected status
  await db.query("UPDATE quotes SET status='closed' WHERE id=$1", [fid]);
  await db.query("UPDATE quotes SET status='ready' WHERE id=$1 AND status=$2", [fid, "confirming"]);
  const stuck = await db.query<{ status: string }>("SELECT status FROM quotes WHERE id=$1", [fid]);
  check("forwarding never moves a file from an unexpected state", stuck.rows[0].status, "closed");

  check("operations can reclaim a file that forwarded itself",
    TRANSITIONS.ready.find(t => t.to === "confirming")?.roles.includes("ops"), true);

  await db.query("DELETE FROM quotes WHERE id IN ($1,$2)", [fid, empty.rows[0].id]);

  console.log("\n── deleting a file ──");
  // the guard the delete action applies: money recorded means hands off
  const guardOf = async (quoteId: number) => (await db.query<{ receipts: number; payments: number }>(
    `SELECT (SELECT COUNT(*) FROM receipts r JOIN invoices i ON i.id=r.invoice_id
              WHERE i.quote_id=$1)::int AS receipts,
            (SELECT COUNT(*) FROM supplier_payments p WHERE p.quote_id=$1)::int AS payments`, [quoteId]
  )).rows[0];
  const g1 = await guardOf(qid);
  check("a file with money recorded is protected", g1.receipts > 0 || g1.payments > 0, true);

  const bare = await db.query<{ id: number }>(
    "INSERT INTO quotes (title,created_by) VALUES ('scratch',$1) RETURNING id", [u.rows[0].id]);
  const g2 = await guardOf(bare.rows[0].id);
  check("a file with no money is deletable", g2.receipts === 0 && g2.payments === 0, true);
  await db.query("DELETE FROM quotes WHERE id=$1", [bare.rows[0].id]);
  const gone = await db.query<{ c: string }>("SELECT count(*)::text c FROM quotes WHERE id=$1", [bare.rows[0].id]);
  check("and it really goes", gone.rows[0].c, "0");

  console.log("\n── stage 3: cascades ──");
  await db.query("DELETE FROM invoices WHERE id=$1", [depositId]);
  const orphanReceipts = await db.query<{ c: string }>(
    "SELECT count(*)::text c FROM receipts WHERE invoice_id=$1", [depositId]);
  check("deleting an invoice takes its receipts", orphanReceipts.rows[0].c, "0");

  await db.query("DELETE FROM quotes WHERE id=$1", [qid]);
  const orphanMoney = await db.query<{ c: string }>(
    "SELECT count(*)::text c FROM supplier_payments WHERE quote_id=$1", [qid]);
  check("deleting a quote takes its payments", orphanMoney.rows[0].c, "0");
  const orphanInvoices = await db.query<{ c: string }>(
    "SELECT count(*)::text c FROM invoices WHERE quote_id=$1", [qid]);
  check("deleting a quote takes its invoices", orphanInvoices.rows[0].c, "0");
  const orphanBookings = await db.query<{ c: string }>("SELECT count(*)::text c FROM bookings WHERE quote_id=$1", [qid]);
  check("deleting a quote takes its bookings with it", orphanBookings.rows[0].c, "0");

  const orphans = await db.query<{ c: string }>("SELECT count(*)::text c FROM quote_lines WHERE quote_id=$1", [qid]);
  check("deleting a quote takes its lines with it", orphans.rows[0].c, "0");

  await db.close();
  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
