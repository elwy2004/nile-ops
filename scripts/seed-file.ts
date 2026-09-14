/* Builds one accepted file locally so the operations screens have something
   real to show. Development only. */
import { Pool } from "pg";
import { connectionString, sslFor } from "../lib/db-url";

const ITINERARY: [string, string, number][] = [
  ["acc","CAI 5",3],["acc","Nile CRZ 5 DLX",3],
  ["sights","Pyr",1],["sights","GEM",1],["sights","CRZ ( Visits )",1],
  ["transfers","Airport Trans",3],["transfers","F/D",1],["transfers","crz pack trans",1],
  ["meals","PYR lunch",1],
  ["services","Airport assist",2],["services","Guide Fees",3],["services","Guide Acc. CRZ",3],
];
const SUPPLIERS: [string, string, string][] = [
  ["Mena House Marriott","hotel","+20 2 3377 3222"],
  ["Sonesta St. George","cruise","+20 95 238 2575"],
  ["Cairo Coach Co.","transport","+20 2 2266 1180"],
  ["Ahmed Zaki (guide)","guide","+20 100 555 2210"],
  ["Felfela Restaurant","restaurant","+20 2 2392 2751"],
];

async function main() {
  const url = connectionString();
  const p = new Pool({ connectionString: url, ssl: sslFor(url), max: 1 });
  const sales = await p.query<{ id: number }>("SELECT id FROM users WHERE role='sales' LIMIT 1");
  const owner = sales.rows[0].id;

  for (const [name, kind, phone] of SUPPLIERS)
    await p.query("INSERT INTO suppliers (name,kind,phone) VALUES ($1,$2,$3) ON CONFLICT (name) DO NOTHING",
      [name, kind, phone]);

  const ins = await p.query<{ id: number }>(
    `INSERT INTO quotes (title,client_name,pax,arrival,departure,fx,margin_pct,flights_usd,created_by,owner_id)
     VALUES ('6-night Cairo & Nile cruise','Wanderlust Travel, Berlin',2,'2026-03-01','2026-03-07',50,10,350,$1,$1)
     RETURNING id`, [owner]
  );
  const id = ins.rows[0].id;
  await p.query(`UPDATE quotes SET ref='Q-'||to_char(created_at,'YYYY')||'-'||lpad(id::text,4,'0') WHERE id=$1`, [id]);
  let sort = 0;
  for (const [section, name, qty] of ITINERARY)
    await p.query("INSERT INTO quote_lines (quote_id,section,item_name,qty,sort) VALUES ($1,$2,$3,$4,$5)",
      [id, section, name, qty, sort++]);
  await p.query("INSERT INTO quote_events (quote_id,user_id,kind,note) VALUES ($1,$2,'created','Quote created')",
    [id, owner]);
  console.log(`seeded quote ${id} with ${sort} lines and ${SUPPLIERS.length} suppliers`);
  await p.end();
}
main().catch(e => { console.error(e); process.exit(1); });
