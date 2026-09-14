/* Creates the schema, loads the Q.SH 2026 price book, and makes the first admin.
   Safe to run more than once: the schema uses IF NOT EXISTS and rates upsert.

   Usage:  DATABASE_URL=postgres://... npx tsx scripts/migrate.ts
           add --reset-admin to set a fresh admin password */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { hashPassword } from "../lib/auth-crypto";
import { connectionString, sslFor } from "../lib/db-url";

type Book = "hotels" | "transfers" | "sights" | "meals" | "services";
const COLUMNS: Record<Book, number> = { hotels: 2, transfers: 3, sights: 1, meals: 1, services: 1 };

async function main() {
  let url: string;
  try {
    url = connectionString();
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url, ssl: sslFor(url) });

  const root = join(import.meta.dirname, "..");
  await pool.query(readFileSync(join(root, "db/schema.sql"), "utf8"));
  console.log("✓ schema applied");

  const rates = JSON.parse(readFileSync(join(root, "db/rates.json"), "utf8")) as Record<Book, unknown[][]>;
  let count = 0;
  for (const book of Object.keys(rates) as Book[]) {
    for (const row of rates[book]) {
      const name = String(row[0]).trim();
      const nums = [0, 0, 0];
      for (let i = 0; i < COLUMNS[book]; i++) nums[i] = Number(row[i + 1]) || 0;
      await pool.query(
        `INSERT INTO rate_items (book, name, rate1, rate2, rate3) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (book, name) DO NOTHING`,
        [book, name, nums[0], nums[1], nums[2]]
      );
      count++;
    }
  }
  console.log(`✓ price book loaded (${count} items)`);

  // trim: values piped through the CLI can arrive with a trailing newline
  const email = (process.env.ADMIN_EMAIL || "admin@nileops.local").trim().toLowerCase();
  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  const reset = process.argv.includes("--reset-admin");

  if (existing.rowCount === 0 || reset) {
    const password = (process.env.ADMIN_PASSWORD || "").trim() || randomBytes(9).toString("base64url");
    const hash = await hashPassword(password);
    if (existing.rowCount === 0) {
      await pool.query(
        `INSERT INTO users (email, name, role, password_hash) VALUES ($1,$2,'admin',$3)`,
        [email, (process.env.ADMIN_NAME || "Administrator").trim(), hash]
      );
    } else {
      await pool.query("UPDATE users SET password_hash = $2 WHERE email = $1", [email, hash]);
    }
    console.log("\n  Admin sign-in");
    console.log(`  email     ${email}`);
    console.log(`  password  ${password}`);
    console.log("  Change it after signing in, and create the real accounts from Admin → Users.\n");
  } else {
    console.log("✓ admin already exists (run with --reset-admin to set a new password)");
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
