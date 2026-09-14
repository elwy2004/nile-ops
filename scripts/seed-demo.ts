/* Demo accounts for trying the workflow locally. Not run in production. */
import { Pool } from "pg";
import { hashPassword } from "../lib/auth-crypto";

const people: [string, string, string][] = [
  ["sara@nileops.local", "Sara Fahmy", "sales"],
  ["omar@nileops.local", "Omar Nabil", "ops"],
  ["mona@nileops.local", "Mona Adel", "finance"],
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const password = process.env.DEMO_PASSWORD || "test-password-2026";
  for (const [email, name, role] of people) {
    await pool.query(
      `INSERT INTO users (email,name,role,password_hash) VALUES ($1,$2,$3,$4)
       ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, role=EXCLUDED.role`,
      [email, name, role, await hashPassword(password)]
    );
    console.log("seeded", role, email);
  }
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
