"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { q, one, tx } from "./db";
import { createSession, destroySession, requireUser, hashPassword, verifyPassword } from "./auth";
import { canEditQuote, canEditRates, canTransition, type Status, type Role } from "./workflow";
import { freeze, SECTION_ORDER, type Line, type RateItem, type Section } from "./pricing";

/* Every action re-checks who is calling and what they may do. A page that
   renders a button is not authorisation. */

async function loadRates(): Promise<RateItem[]> {
  return q<RateItem>(
    `SELECT book, name, rate1::float8 AS rate1, rate2::float8 AS rate2, rate3::float8 AS rate3
       FROM rate_items WHERE NOT archived ORDER BY book, name`
  );
}

async function loadQuote(id: number) {
  return one<{ id: number; status: Status; pax: number; fx: number; margin_pct: number; flights_usd: number }>(
    `SELECT id, status, pax, fx::float8 AS fx, margin_pct::float8 AS margin_pct,
            flights_usd::float8 AS flights_usd
       FROM quotes WHERE id = $1`, [id]
  );
}

async function loadLines(id: number): Promise<Line[]> {
  return q<Line>(
    `SELECT section, item_name, qty::float8 AS qty FROM quote_lines WHERE quote_id = $1 ORDER BY sort, id`, [id]
  );
}

/* ---------- auth ---------- */

export async function login(_prev: unknown, form: FormData): Promise<{ error?: string }> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const user = await one<{ id: number; password_hash: string }>(
    "SELECT id, password_hash FROM users WHERE lower(email) = $1 AND active", [email]
  );
  // Same message either way, so the form can't be used to discover which emails exist.
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return { error: "That email and password don't match." };
  }
  await createSession(user.id);
  redirect("/quotes");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}

export async function changeOwnPassword(_prev: unknown, form: FormData): Promise<{ error?: string; ok?: string }> {
  const user = await requireUser();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  if (next.length < 10) return { error: "Use at least 10 characters." };

  const row = await one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [user.id]);
  if (!row || !(await verifyPassword(current, row.password_hash))) return { error: "Current password is wrong." };

  await q("UPDATE users SET password_hash = $2 WHERE id = $1", [user.id, await hashPassword(next)]);
  return { ok: "Password changed." };
}

/* ---------- quotes ---------- */

export async function createQuote(): Promise<void> {
  const user = await requireUser();
  if (user.role !== "sales" && user.role !== "admin") redirect("/quotes?denied=1");

  // Insert, then number it from its own id. Two steps because a statement
  // cannot read rows its own CTE just inserted.
  const id = await tx(async client => {
    const ins = await client.query<{ id: number }>(
      `INSERT INTO quotes (title, created_by, owner_id) VALUES ('', $1, $1) RETURNING id`, [user.id]
    );
    const newId = ins.rows[0].id;
    await client.query(
      `UPDATE quotes SET ref = 'Q-' || to_char(created_at,'YYYY') || '-' || lpad(id::text, 4, '0')
        WHERE id = $1`, [newId]
    );
    await client.query(
      "INSERT INTO quote_events (quote_id, user_id, kind, note) VALUES ($1,$2,'created','Quote created')",
      [newId, user.id]
    );
    return newId;
  });
  redirect(`/quotes/${id}`);
}

export async function saveQuote(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = Number(form.get("id"));
  const quote = await loadQuote(id);
  if (!quote) redirect("/quotes");
  if (!canEditQuote(quote.status, user.role)) redirect(`/quotes/${id}?denied=1`);

  const num = (k: string, min: number, fallback: number) => {
    const v = Number(form.get(k));
    return Number.isFinite(v) && v >= min ? v : fallback;
  };
  const date = (k: string) => {
    const v = String(form.get(k) ?? "").trim();
    return v === "" ? null : v;
  };

  // Lines arrive as parallel arrays: section[], item[], qty[]
  const sections = form.getAll("section").map(String);
  const items = form.getAll("item").map(String);
  const qtys = form.getAll("qty").map(v => Number(v) || 0);

  await tx(async client => {
    await client.query(
      `UPDATE quotes SET title=$2, client_name=$3, pax=$4, arrival=$5, departure=$6,
              fx=$7, margin_pct=$8, flights_usd=$9, updated_at=now()
         WHERE id=$1`,
      [id,
       String(form.get("title") ?? "").slice(0, 200),
       String(form.get("client_name") ?? "").slice(0, 200),
       num("pax", 1, 1), date("arrival"), date("departure"),
       num("fx", 0.0001, 50), num("margin_pct", 0, 0), num("flights_usd", 0, 0)]
    );
    await client.query("DELETE FROM quote_lines WHERE quote_id = $1", [id]);
    let sort = 0;
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i] as Section;
      const name = (items[i] ?? "").trim();
      if (!SECTION_ORDER.includes(section) || name === "") continue;
      await client.query(
        "INSERT INTO quote_lines (quote_id, section, item_name, qty, sort) VALUES ($1,$2,$3,$4,$5)",
        [id, section, name, qtys[i] ?? 0, sort++]
      );
    }
  });

  revalidatePath(`/quotes/${id}`);
  redirect(`/quotes/${id}?saved=1`);
}

export async function moveQuote(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = Number(form.get("id"));
  const to = String(form.get("to")) as Status;
  const note = String(form.get("note") ?? "").slice(0, 500);

  const quote = await loadQuote(id);
  if (!quote) redirect("/quotes");

  const move = canTransition(quote.status, to, user.role);
  if (!move) redirect(`/quotes/${id}?denied=1`);

  // Build the snapshot BEFORE opening the transaction: a query issued inside
  // tx() would wait for a second pooled connection that cannot be granted until
  // the transaction finishes, which deadlocks.
  let snapshot: string | null = null;
  if (move.freezes) {
    const rates = await loadRates();
    const lines = await loadLines(id);
    snapshot = JSON.stringify(freeze(
      { pax: quote.pax, fx: quote.fx, margin_pct: quote.margin_pct, flights_usd: quote.flights_usd },
      lines, rates
    ));
  }

  await tx(async client => {
    if (move.freezes) {
      // Stop reading the live price book: keep the rates and FX this sold at.
      await client.query(
        "UPDATE quotes SET status=$2, snapshot=$3, accepted_at=now(), updated_at=now() WHERE id=$1",
        [id, to, snapshot]
      );
    } else if (move.thaws) {
      await client.query(
        "UPDATE quotes SET status=$2, snapshot=NULL, accepted_at=NULL, updated_at=now() WHERE id=$1", [id, to]
      );
    } else {
      await client.query("UPDATE quotes SET status=$2, updated_at=now() WHERE id=$1", [id, to]);
    }
    await client.query(
      `INSERT INTO quote_events (quote_id, user_id, kind, from_status, to_status, note)
       VALUES ($1,$2,'status',$3,$4,$5)`,
      [id, user.id, quote.status, to, note]
    );
  });

  revalidatePath("/quotes");
  revalidatePath(`/quotes/${id}`);
  redirect(`/quotes/${id}`);
}

export async function addNote(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = Number(form.get("id"));
  const note = String(form.get("note") ?? "").trim().slice(0, 500);
  if (!note) redirect(`/quotes/${id}`);

  const quote = await loadQuote(id);
  if (!quote) redirect("/quotes");

  await q("INSERT INTO quote_events (quote_id, user_id, kind, note) VALUES ($1,$2,'note',$3)", [id, user.id, note]);
  revalidatePath(`/quotes/${id}`);
  redirect(`/quotes/${id}`);
}

/* ---------- price book ---------- */

export async function saveRate(form: FormData): Promise<void> {
  const user = await requireUser();
  if (!canEditRates(user.role)) redirect("/rates?denied=1");

  const id = Number(form.get("id"));
  const r = (k: string) => Math.max(0, Number(form.get(k)) || 0);
  await q("UPDATE rate_items SET name=$2, rate1=$3, rate2=$4, rate3=$5 WHERE id=$1",
    [id, String(form.get("name") ?? "").trim().slice(0, 120), r("rate1"), r("rate2"), r("rate3")]);
  revalidatePath("/rates");
  redirect("/rates?saved=1");
}

export async function addRate(form: FormData): Promise<void> {
  const user = await requireUser();
  if (!canEditRates(user.role)) redirect("/rates?denied=1");

  const book = String(form.get("book"));
  const name = String(form.get("name") ?? "").trim().slice(0, 120);
  if (!name) redirect("/rates");
  const r = (k: string) => Math.max(0, Number(form.get(k)) || 0);
  await q(
    `INSERT INTO rate_items (book,name,rate1,rate2,rate3) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (book,name) DO UPDATE SET rate1=EXCLUDED.rate1, rate2=EXCLUDED.rate2, rate3=EXCLUDED.rate3`,
    [book, name, r("rate1"), r("rate2"), r("rate3")]
  );
  revalidatePath("/rates");
  redirect("/rates?saved=1");
}

export async function archiveRate(form: FormData): Promise<void> {
  const user = await requireUser();
  if (!canEditRates(user.role)) redirect("/rates?denied=1");
  await q("UPDATE rate_items SET archived = NOT archived WHERE id = $1", [Number(form.get("id"))]);
  revalidatePath("/rates");
  redirect("/rates");
}

/* ---------- users (admin) ---------- */

export async function createUser(_prev: unknown, form: FormData): Promise<{ error?: string; ok?: string }> {
  const user = await requireUser();
  if (user.role !== "admin") return { error: "Only an administrator can add people." };

  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const name = String(form.get("name") ?? "").trim();
  const role = String(form.get("role")) as Role;
  const password = String(form.get("password") ?? "");

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "That doesn't look like an email address." };
  if (!name) return { error: "Enter a name." };
  if (!["sales", "ops", "finance", "admin"].includes(role)) return { error: "Pick a role." };
  if (password.length < 10) return { error: "The starting password needs at least 10 characters." };

  const clash = await one("SELECT id FROM users WHERE lower(email) = $1", [email]);
  if (clash) return { error: "Someone already has that email." };

  await q("INSERT INTO users (email,name,role,password_hash) VALUES ($1,$2,$3,$4)",
    [email, name, role, await hashPassword(password)]);
  revalidatePath("/admin");
  return { ok: `${name} can now sign in. Tell them to change the password.` };
}

export async function setUserActive(form: FormData): Promise<void> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/quotes?denied=1");
  const id = Number(form.get("id"));
  if (id === user.id) redirect("/admin?self=1");   // don't let an admin lock themselves out
  await q("UPDATE users SET active = NOT active WHERE id = $1", [id]);
  await q("DELETE FROM sessions WHERE user_id = $1", [id]);   // sign them out immediately
  revalidatePath("/admin");
  redirect("/admin");
}

export async function setUserRole(form: FormData): Promise<void> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/quotes?denied=1");
  const id = Number(form.get("id"));
  const role = String(form.get("role")) as Role;
  if (!["sales", "ops", "finance", "admin"].includes(role)) redirect("/admin");
  if (id === user.id) redirect("/admin?self=1");
  await q("UPDATE users SET role = $2 WHERE id = $1", [id, role]);
  revalidatePath("/admin");
  redirect("/admin");
}
