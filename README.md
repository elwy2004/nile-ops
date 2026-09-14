# Nile Ops — Stage 1

A quotation moving from sales, through operations, to finance. Built on the
pricing model from `Q.SH 2026.xlsx`.

Next.js (App Router) + Postgres. No other services.

## What Stage 1 does

- **Shared quotes.** One database, so ops sees what sales quoted.
- **Accounts and roles.** `sales`, `ops`, `finance`, `admin` — enforced in every
  server action, not just hidden in the UI.
- **The workflow**, with each handoff gated to one role:

  | Stage | Who moves it | What happens |
  | --- | --- | --- |
  | Draft → Sent to client | sales | |
  | → Client accepted | sales | **prices freeze** |
  | → Operations confirming | ops | |
  | → Ready to invoice | ops | |
  | → Invoiced → Paid → Closed | finance | |

  Plus Revise, Lost and Cancelled. `lib/workflow.ts` is the single source of truth.

- **Frozen prices.** On acceptance the quote stores the rates *and* the EGP/USD
  figure it was sold at. Later price-book edits cannot rewrite a sold deal. The
  quote then shows what the same itinerary would cost today, so you can see the
  exposure you are carrying.
- **Audit trail.** Every status change, with who and when. Never deleted.
- **Price book**, maintained by ops — the 215 rates from the 2026 sheet.

Margin is hidden from `ops`: they book hotels, they don't need the markup.

## Not in Stage 1

Supplier bookings and vouchers (Stage 2). Invoices, payment schedules, payables
and the margin variance report (Stage 3). "Invoiced" and "Paid" are currently
status flags, not accounting records.

## Setting it up

### 1. A database

In the Vercel dashboard: your project → **Storage** → **Create Database** →
**Neon (Postgres)**. Connect it to this project; Vercel sets `DATABASE_URL` for you.

### 2. Schema, price book and the first admin

```bash
vercel env pull .env.local          # brings DATABASE_URL down
npm run migrate                     # schema + 215 rates + admin account
```

`migrate` prints the admin email and a generated password. It is safe to re-run;
add `--reset-admin` to set a new admin password. Override the email with
`ADMIN_EMAIL=you@company.com npm run migrate`.

### 3. Sign in and add your team

Change the admin password under **Account**, then create real accounts under
**People**. Keep `admin` for one or two people.

## Local development

No Postgres install needed — PGlite (Postgres compiled to WASM) is served over a
real TCP socket, so the app connects exactly as it will to Neon.

```bash
npm run dev:db     # terminal 1 — database on :55432, data in .devdb/
npm run migrate    # once
npm run dev        # terminal 2
```

`.env.local` for local work:

```
DATABASE_URL=postgres://postgres@localhost:55432/postgres
DB_POOL_MAX=1
```

`DB_POOL_MAX=1` matters locally: the dev socket server takes one connection at a
time. Leave it unset in production.

`npm run seed-demo` adds three throwaway accounts (sales/ops/finance) for trying
the workflow. Never run it against production.

## Checks

```bash
npm run verify
```

Runs the schema against a real Postgres engine and asserts the pricing against
the spreadsheet's own worked example (net 1,683.50 / sell 1,851.85 USD), the
group-size vehicle tiers, the freeze behaviour, and every role gate.

## Layout

| Path | |
| --- | --- |
| `lib/pricing.ts` | The pricing model and the freeze/snapshot logic |
| `lib/workflow.ts` | Statuses, transitions, who may do what |
| `lib/actions.ts` | Every mutation; re-checks auth and role |
| `lib/auth.ts` | Sessions and passwords (scrypt, no native build) |
| `db/schema.sql` | Tables |
| `db/rates.json` | The 2026 price book as extracted from the sheet |

## Two notes on the money

**Transactions.** Never call `q()` inside `tx()` — it waits for a second pooled
connection that cannot be granted until the transaction ends. Read first, then
open the transaction. (`moveQuote` shows the pattern.)

**Payments.** This system records that a payment happened; it never moves money
and holds no card or bank details. Keep it that way.
