"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { q, one, tx } from "./db";
import { createSession, destroySession, requireUser, hashPassword, verifyPassword } from "./auth";
import { blockedReason, canEditQuote, canEditRates, canTransition, type Status, type Role } from "./workflow";
import { freeze, SECTION_ORDER, type Line, type RateItem, type Section, type Snapshot } from "./pricing";
import { bookingRowsFromSnapshot, SUPPLIER_KINDS, type BookingStatus } from "./bookings";

/* Every action re-checks who is calling and what they may do. A page that
   renders a button is not authorisation.

   Every NOT NULL text column is written through COALESCE($n,''). An empty
   string reaches this database as NULL, so an untouched optional field would
   otherwise violate the constraint and fail the whole request. */

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
      `UPDATE quotes SET title=COALESCE($2,''), client_name=COALESCE($3,''), pax=$4, arrival=$5, departure=$6,
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
        "INSERT INTO quote_lines (quote_id, section, item_name, qty, sort) VALUES ($1,$2,COALESCE($3,''),$4,$5)",
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
  const raw = form.get("note");
  const note = typeof raw === "string" ? raw.slice(0, 500) : "";

  const quote = await loadQuote(id);
  if (!quote) redirect("/quotes");

  const move = canTransition(quote.status, to, user.role);
  if (!move) redirect(`/quotes/${id}?denied=1`);

  // The gates are enforced here, not only in the UI that renders the button.
  const bookingStates = await q<{ status: BookingStatus }>(
    "SELECT status FROM bookings WHERE quote_id = $1", [id]
  );
  if (blockedReason(move, bookingStates)) redirect(`/quotes/${id}?blocked=1`);

  // Build the snapshot BEFORE opening the transaction: a query issued inside
  // tx() would wait for a second pooled connection that cannot be granted until
  // the transaction finishes, which deadlocks.
  let snapshot: string | null = null;
  let newBookings: ReturnType<typeof bookingRowsFromSnapshot> = [];
  if (move.freezes) {
    const rates = await loadRates();
    const lines = await loadLines(id);
    const snap = freeze(
      { pax: quote.pax, fx: quote.fx, margin_pct: quote.margin_pct, flights_usd: quote.flights_usd },
      lines, rates
    );
    snapshot = JSON.stringify(snap);
    // Each sold line becomes a service operations has to confirm.
    newBookings = bookingRowsFromSnapshot(snap);
  }

  await tx(async client => {
    if (move.freezes) {
      // Stop reading the live price book: keep the rates and FX this sold at.
      await client.query(
        "UPDATE quotes SET status=$2, snapshot=$3, accepted_at=now(), updated_at=now() WHERE id=$1",
        [id, to, snapshot]
      );
      // Re-accepting after a bounce should not duplicate the service list.
      await client.query("DELETE FROM bookings WHERE quote_id = $1", [id]);
      for (const b of newBookings) {
        await client.query(
          `INSERT INTO bookings (quote_id, section, item_name, qty, sort, currency, quoted_cost)
           VALUES ($1,$2,COALESCE($3,''),$4,$5,$6,$7)`,
          [id, b.section, b.item_name, b.qty, b.sort, b.currency, b.quoted_cost]
        );
      }
    } else if (move.thaws) {
      await client.query(
        "UPDATE quotes SET status=$2, snapshot=NULL, accepted_at=NULL, updated_at=now() WHERE id=$1", [id, to]
      );
      // The sold prices are gone, so the services built from them are stale.
      await client.query("DELETE FROM bookings WHERE quote_id = $1", [id]);
    } else {
      await client.query("UPDATE quotes SET status=$2, updated_at=now() WHERE id=$1", [id, to]);
    }
    await client.query(
      `INSERT INTO quote_events (quote_id, user_id, kind, from_status, to_status, note)
       VALUES ($1,$2,'status',$3,$4,COALESCE($5,''))`,
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

  await q("INSERT INTO quote_events (quote_id, user_id, kind, note) VALUES ($1,$2,'note',COALESCE($3,''))", [id, user.id, note]);
  revalidatePath(`/quotes/${id}`);
  redirect(`/quotes/${id}`);
}

/* ---------- price book ---------- */

export async function saveRate(form: FormData): Promise<void> {
  const user = await requireUser();
  if (!canEditRates(user.role)) redirect("/rates?denied=1");

  const id = Number(form.get("id"));
  const r = (k: string) => Math.max(0, Number(form.get(k)) || 0);
  await q("UPDATE rate_items SET name=COALESCE($2,''), rate1=$3, rate2=$4, rate3=$5 WHERE id=$1",
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
    `INSERT INTO rate_items (book,name,rate1,rate2,rate3) VALUES ($1,COALESCE($2,''),$3,$4,$5)
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

  await q("INSERT INTO users (email,name,role,password_hash) VALUES (COALESCE($1,''),COALESCE($2,''),$3,$4)",
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

/* ---------- bookings (operations) ---------- */

/** Operations owns the supplier side; sales and finance only read it. */
function assertOps(role: Role, backTo: string): void {
  if (role !== "ops" && role !== "admin") redirect(`${backTo}?denied=1`);
}

export async function updateBooking(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = Number(form.get("id"));
  const row = await one<{ quote_id: number; status: BookingStatus; item_name: string }>(
    "SELECT quote_id, status, item_name FROM bookings WHERE id = $1", [id]
  );
  if (!row) redirect("/quotes");
  const back = `/quotes/${row.quote_id}`;
  assertOps(user.role, back);

  const status = String(form.get("status") ?? row.status) as BookingStatus;
  if (!["pending", "requested", "confirmed", "cancelled"].includes(status)) redirect(back);

  const supplierRaw = String(form.get("supplier_id") ?? "").trim();
  const supplier_id = supplierRaw === "" ? null : Number(supplierRaw);
  const dateRaw = String(form.get("service_date") ?? "").trim();
  const actualRaw = String(form.get("actual_cost") ?? "").trim();

  // A confirmation needs a supplier and a reference, or it isn't one.
  const confirmation_no = String(form.get("confirmation_no") ?? "").trim().slice(0, 80);
  if (status === "confirmed" && (!supplier_id || confirmation_no === "")) {
    redirect(`${back}?needsref=1`);
  }

  await tx(async client => {
    await client.query(
      `UPDATE bookings SET supplier_id=$2, status=$3, confirmation_no=COALESCE($4,''),
              service_date=$5, actual_cost=$6, notes=COALESCE($7,''), updated_at=now()
         WHERE id=$1`,
      [id, supplier_id, status, confirmation_no,
       dateRaw === "" ? null : dateRaw,
       actualRaw === "" ? null : Number(actualRaw),
       String(form.get("notes") ?? "").slice(0, 300)]
    );
    if (status !== row.status) {
      await client.query(
        `INSERT INTO quote_events (quote_id, user_id, kind, note)
         VALUES ($1,$2,'booking',COALESCE($3,''))`,
        [row.quote_id, user.id, `${row.item_name}: ${status}${confirmation_no ? ` (${confirmation_no})` : ""}`]
      );
    }
  });

  revalidatePath(back);
  redirect(`${back}?booked=1`);
}

/** Apply a supplier and date to every still-unassigned line of one section. */
export async function bulkAssignSupplier(form: FormData): Promise<void> {
  const user = await requireUser();
  const quoteId = Number(form.get("quote_id"));
  const back = `/quotes/${quoteId}`;
  assertOps(user.role, back);

  const section = String(form.get("section")) as Section;
  if (!SECTION_ORDER.includes(section)) redirect(back);
  const supplierRaw = String(form.get("supplier_id") ?? "").trim();
  if (supplierRaw === "") redirect(back);

  await q(
    `UPDATE bookings SET supplier_id=$3, updated_at=now()
       WHERE quote_id=$1 AND section=$2 AND supplier_id IS NULL AND status IN ('pending','requested')`,
    [quoteId, section, Number(supplierRaw)]
  );
  revalidatePath(back);
  redirect(`${back}?booked=1`);
}

/* ---------- suppliers ---------- */

export async function saveSupplier(_prev: unknown, form: FormData): Promise<{ error?: string; ok?: string }> {
  const user = await requireUser();
  if (user.role !== "ops" && user.role !== "admin") {
    return { error: "Only operations and administrators manage suppliers." };
  }

  const idRaw = String(form.get("id") ?? "").trim();
  const name = String(form.get("name") ?? "").trim().slice(0, 160);
  const kind = String(form.get("kind") ?? "other");
  if (!name) return { error: "Enter a supplier name." };
  if (!SUPPLIER_KINDS.includes(kind as never)) return { error: "Pick a supplier type." };

  const fields = [
    name, kind,
    String(form.get("phone") ?? "").trim().slice(0, 60),
    String(form.get("email") ?? "").trim().slice(0, 160),
    String(form.get("notes") ?? "").trim().slice(0, 400),
  ];

  if (idRaw === "") {
    const clash = await one("SELECT id FROM suppliers WHERE lower(name) = lower($1)", [name]);
    if (clash) return { error: "A supplier with that name already exists." };
    await q(`INSERT INTO suppliers (name,kind,phone,email,notes)
             VALUES (COALESCE($1,''),$2,COALESCE($3,''),COALESCE($4,''),COALESCE($5,''))`, fields);
    revalidatePath("/suppliers");
    return { ok: `${name} added.` };
  }

  await q(
    `UPDATE suppliers SET name=COALESCE($2,''), kind=$3, phone=COALESCE($4,''),
            email=COALESCE($5,''), notes=COALESCE($6,'') WHERE id=$1`,
    [Number(idRaw), ...fields]
  );
  revalidatePath("/suppliers");
  return { ok: `${name} updated.` };
}

export async function archiveSupplier(form: FormData): Promise<void> {
  const user = await requireUser();
  assertOps(user.role, "/suppliers");
  await q("UPDATE suppliers SET archived = NOT archived WHERE id = $1", [Number(form.get("id"))]);
  revalidatePath("/suppliers");
  redirect("/suppliers");
}

/* ---------- money (finance) ----------
   Nothing here moves money. It records that money moved, so the file can be
   reconciled and the real margin worked out. */

function assertFinance(role: Role, backTo: string): void {
  if (role !== "finance" && role !== "admin") redirect(`${backTo}?denied=1`);
}

export async function createInvoice(form: FormData): Promise<void> {
  const user = await requireUser();
  const quoteId = Number(form.get("quote_id"));
  const back = `/quotes/${quoteId}`;
  assertFinance(user.role, back);

  const kind = String(form.get("kind") ?? "full");
  if (!["deposit", "balance", "full"].includes(kind)) redirect(back);
  const amount = Math.max(0, Number(form.get("amount")) || 0);
  if (amount <= 0) redirect(`${back}?badamount=1`);
  const currency = String(form.get("currency") ?? "USD");
  if (!["USD", "EGP"].includes(currency)) redirect(back);
  const dueRaw = String(form.get("due_on") ?? "").trim();

  await tx(async client => {
    const ins = await client.query<{ id: number }>(
      `INSERT INTO invoices (quote_id, kind, currency, amount, due_on, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,''),$7) RETURNING id`,
      [quoteId, kind, currency, amount, dueRaw === "" ? null : dueRaw,
       String(form.get("notes") ?? "").slice(0, 300), user.id]
    );
    // Numbered from its own id, same as quote references.
    await client.query(
      `UPDATE invoices SET number = 'INV-' || to_char(created_at,'YYYY') || '-' || lpad(id::text,4,'0')
        WHERE id = $1`, [ins.rows[0].id]
    );
  });

  revalidatePath(back);
  redirect(`${back}?money=1`);
}

export async function setInvoiceStatus(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = Number(form.get("id"));
  const row = await one<{ quote_id: number; number: string | null; status: string }>(
    "SELECT quote_id, number, status FROM invoices WHERE id = $1", [id]
  );
  if (!row) redirect("/quotes");
  const back = `/quotes/${row.quote_id}`;
  assertFinance(user.role, back);

  const to = String(form.get("to"));
  if (!["draft", "issued", "void"].includes(to)) redirect(back);

  await tx(async client => {
    await client.query(
      `UPDATE invoices SET status=$2, issued_on = CASE WHEN $2='issued' THEN COALESCE(issued_on, CURRENT_DATE) ELSE issued_on END,
              updated_at=now() WHERE id=$1`,
      [id, to]
    );
    await client.query(
      `INSERT INTO quote_events (quote_id, user_id, kind, note) VALUES ($1,$2,'invoice',COALESCE($3,''))`,
      [row.quote_id, user.id, `Invoice ${row.number ?? id}: ${to}`]
    );
  });

  revalidatePath(back);
  redirect(`${back}?money=1`);
}

export async function recordReceipt(form: FormData): Promise<void> {
  const user = await requireUser();
  const invoiceId = Number(form.get("invoice_id"));
  const inv = await one<{ quote_id: number; number: string | null; currency: string }>(
    "SELECT quote_id, number, currency FROM invoices WHERE id = $1", [invoiceId]
  );
  if (!inv) redirect("/quotes");
  const back = `/quotes/${inv.quote_id}`;
  assertFinance(user.role, back);

  const amount = Number(form.get("amount")) || 0;
  if (amount <= 0) redirect(`${back}?badamount=1`);
  const receivedRaw = String(form.get("received_on") ?? "").trim();

  await tx(async client => {
    await client.query(
      `INSERT INTO receipts (invoice_id, amount, currency, received_on, method, reference, notes, recorded_by)
       VALUES ($1,$2,$3,$4,COALESCE($5,''),COALESCE($6,''),COALESCE($7,''),$8)`,
      [invoiceId, amount, inv.currency,
       receivedRaw === "" ? new Date().toISOString().slice(0, 10) : receivedRaw,
       String(form.get("method") ?? "").slice(0, 60),
       String(form.get("reference") ?? "").slice(0, 120),
       String(form.get("notes") ?? "").slice(0, 300), user.id]
    );
    await client.query(
      `INSERT INTO quote_events (quote_id, user_id, kind, note) VALUES ($1,$2,'receipt',COALESCE($3,''))`,
      [inv.quote_id, user.id,
       `Received ${amount.toFixed(2)} ${inv.currency} against ${inv.number ?? `invoice ${invoiceId}`}`]
    );
  });

  revalidatePath(back);
  redirect(`${back}?money=1`);
}

export async function deleteReceipt(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = Number(form.get("id"));
  const row = await one<{ quote_id: number }>(
    `SELECT i.quote_id FROM receipts r JOIN invoices i ON i.id = r.invoice_id WHERE r.id = $1`, [id]
  );
  if (!row) redirect("/quotes");
  assertFinance(user.role, `/quotes/${row.quote_id}`);
  await q("DELETE FROM receipts WHERE id = $1", [id]);
  revalidatePath(`/quotes/${row.quote_id}`);
  redirect(`/quotes/${row.quote_id}?money=1`);
}

export async function recordSupplierPayment(form: FormData): Promise<void> {
  const user = await requireUser();
  const quoteId = Number(form.get("quote_id"));
  const back = `/quotes/${quoteId}`;
  assertFinance(user.role, back);

  const supplierId = Number(form.get("supplier_id"));
  if (!supplierId) redirect(back);
  const amount = Number(form.get("amount")) || 0;
  if (amount <= 0) redirect(`${back}?badamount=1`);
  const currency = String(form.get("currency") ?? "EGP");
  if (!["USD", "EGP"].includes(currency)) redirect(back);

  // The rate on the day it went out. Without it there is no way to tell a
  // pricing problem from a currency movement.
  const fxRaw = Number(form.get("fx_rate")) || 0;
  const fx_rate = currency === "EGP" && fxRaw > 0 ? fxRaw : null;
  const paidRaw = String(form.get("paid_on") ?? "").trim();

  const sup = await one<{ name: string }>("SELECT name FROM suppliers WHERE id = $1", [supplierId]);

  await tx(async client => {
    await client.query(
      `INSERT INTO supplier_payments
         (quote_id, supplier_id, amount, currency, fx_rate, paid_on, method, reference, notes, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,''),COALESCE($8,''),COALESCE($9,''),$10)`,
      [quoteId, supplierId, amount, currency, fx_rate,
       paidRaw === "" ? new Date().toISOString().slice(0, 10) : paidRaw,
       String(form.get("method") ?? "").slice(0, 60),
       String(form.get("reference") ?? "").slice(0, 120),
       String(form.get("notes") ?? "").slice(0, 300), user.id]
    );
    await client.query(
      `INSERT INTO quote_events (quote_id, user_id, kind, note) VALUES ($1,$2,'payment',COALESCE($3,''))`,
      [quoteId, user.id,
       `Paid ${amount.toFixed(2)} ${currency} to ${sup?.name ?? `supplier ${supplierId}`}`]
    );
  });

  revalidatePath(back);
  redirect(`${back}?money=1`);
}

export async function deleteSupplierPayment(form: FormData): Promise<void> {
  const user = await requireUser();
  const id = Number(form.get("id"));
  const row = await one<{ quote_id: number }>("SELECT quote_id FROM supplier_payments WHERE id = $1", [id]);
  if (!row) redirect("/quotes");
  assertFinance(user.role, `/quotes/${row.quote_id}`);
  await q("DELETE FROM supplier_payments WHERE id = $1", [id]);
  revalidatePath(`/quotes/${row.quote_id}`);
  redirect(`/quotes/${row.quote_id}?money=1`);
}
