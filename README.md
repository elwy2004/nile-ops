# Nile Ops — Stages 1 & 2

A quotation moving from sales, through operations, to finance. Built on the
pricing model from `Q.SH 2026.xlsx`.

Next.js (App Router) + Postgres. No other services.

## Stage 1 — the quote through the desks

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

## Stage 2 — the supplier side

- **Every sold line becomes a booking** the moment a client accepts, taken from
  the frozen snapshot so it reflects what was sold rather than today's prices.
- **Suppliers** — a directory of hotels, boats, transport, guides and
  restaurants, typed so the right ones are offered first for each service.
- **Operations board** on each file: assign a supplier, set the service date,
  record the confirmation number and what the supplier actually charges.
  Confirming requires both a supplier and their reference.
- **A cross-file worklist** at `/operations` — everything still owed to a
  supplier, in service-date order, with passed dates flagged.
- **The finance handoff is gated**: a file cannot reach finance until every
  service is confirmed or marked not needed. A file cannot be bounced back to
  sales once suppliers have confirmed.
- **Vouchers** — a printable voucher per confirmed service, numbered from the
  file reference (`Q-2026-0001/03`). Deliberately shows no prices.
- **Cost variance** — quoted against actual supplier cost, converted at the
  file's *own* frozen rate so it isolates supplier movement from currency
  movement.

Booking confirmations are written into the same file history as status changes.

## Not built yet (Stage 3)

Invoices, payment schedules, supplier payables, and the realised margin report.
"Invoiced" and "Paid" are still status flags, not accounting records.

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
