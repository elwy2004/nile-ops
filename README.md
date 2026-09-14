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

Live at **https://nile-ops.vercel.app** (Vercel project `elwy1/nile-ops`,
Nile Postgres via the Vercel Marketplace).

### Deploying

`npm run build` runs the migration first, so **deploying applies the schema and
loads any new rates**. The database credential therefore never has to leave
Vercel:

```bash
vercel deploy --prod
```

The migration is idempotent — safe on every deploy.

### The first admin

Created by the migration from `ADMIN_EMAIL` / `ADMIN_PASSWORD` if that email has
no account yet. `ADMIN_PASSWORD` was removed from the project after first use;
set it again (plus `--reset-admin`) only if you are locked out.

Add the rest of the team under **People**, and keep `admin` for one or two people.

### Notes on this Postgres

Nile rejects standalone `CREATE SEQUENCE`, so quote references are derived from
the row id rather than a sequence. Implicit `SERIAL` sequences are fine. If you
ever move to another Postgres, nothing needs to change.

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
