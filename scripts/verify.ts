/* Proves the schema and the pricing/workflow logic against a real Postgres
   engine (PGlite, in-process) so nothing unverified reaches the live database.

   npx tsx scripts/verify.ts */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { compute, freeze, makeLookup, tierIndex, type RateItem, type Line } from "../lib/pricing";
import { allowedTransitions, canEditQuote, canTransition } from "../lib/workflow";
import { hashPassword, verifyPassword } from "../lib/auth-crypto";

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
  const ev = await db.query<{ c: string }>("SELECT count(*)::text c FROM quote_events WHERE quote_id=$1", [qid]);
  check("audit trail records the handoff", ev.rows[0].c, "1");

  await db.query("DELETE FROM quotes WHERE id=$1", [qid]);
  const orphans = await db.query<{ c: string }>("SELECT count(*)::text c FROM quote_lines WHERE quote_id=$1", [qid]);
  check("deleting a quote takes its lines with it", orphans.rows[0].c, "0");

  await db.close();
  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
