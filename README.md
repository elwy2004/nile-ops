# Nile Ops

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

## Stage 3 — the money

**This system records money movement. It never moves money and holds no card or
bank details.** Payment itself stays with your bank or payment provider.

- **Invoices** — deposit, balance or full, raised in USD or EGP, numbered
  `INV-2026-0001`. Draft until issued; a balance invoice pre-fills with exactly
  what is left uninvoiced. Printable, showing the itinerary and what is due,
  never costs or margin.
- **Receipts** against each invoice, with method and bank reference.
- **Supplier payments.** What you *owe* is derived from the bookings — there is
  no second list to keep in step. Each payment records the **rate on the day it
  went out**.
- **Gates**: a file cannot be marked Invoiced with nothing issued, nor Paid
  while anything is outstanding — the button names the exact figure.
- **What this file actually earned** — revenue against cost valued two ways:
  at the rate the file was sold at, and at the rates actually paid. The gap is
  labelled as currency movement rather than pricing. A part-invoiced file says
  so instead of reporting an alarming margin.
- **`/finance`** — every live file's position: invoiced, received, client owes,
  supplier cost, paid out, still owed, and the next due date with overdue
  flagged. Stated at each file's own sold rate so the columns compare.

### Why the rate on the payment date matters

A file is sold in USD at a rate fixed the day the client accepts, but its EGP
costs are paid weeks or months later. Without the payment-date rate there is no
way to tell a pricing mistake from a currency movement. With it, 13,350 EGP
quoted at 50 and paid at 62.5 shows as **+53.40 USD of currency gain**, kept
separate from margin.

## Each desk, and how files move between them

Every department gets its own view, and **a file belongs to exactly one desk at
a time, decided by its status**. It appears there and nowhere else, and moves
the instant the status moves. `lib/desks.ts` holds that mapping; a test asserts
every live stage sits on exactly one desk and agrees with the workflow.

| Desk | Holds files at | Leads with | Its columns |
| --- | --- | --- | --- |
| `sales` | draft, sent to client | **Sales** | pax, group total, margin |
| `ops` | accepted, confirming | **Operations** | services left, next service date |
| `finance` | ready, invoiced, paid | **Finance** | invoiced, client owes, you owe |

Closed, lost and cancelled files sit on no desk at all.

Each view opens on an **On your desk** card — only that department's files —
and says in plain words what makes a file arrive and what makes it leave.
Underneath sits that department's working tool: every file for sales, the
services worklist for operations, the money position for finance. Margin stays
hidden from operations throughout.

**Files forward themselves** the moment the desk that held them is demonstrably
finished — the conditions are exactly the ones the manual buttons already
checked, so nothing moves earlier than it used to:

- the last service is confirmed → **Ready to invoice** (finance)
- an invoice is issued → **Invoiced**
- every issued invoice is fully receipted → **Paid**

A part payment does not forward anything. A file with no services never
forwards. Each move is written to the history as *Forwarded automatically* with
the reason, so it is never mistaken for someone's decision, and the person who
triggered it is told on screen.

Marking a client's acceptance stays manual — only a person knows the client
said yes. And operations can pull a file back from **Ready to invoice** if it
moved on before they were finished.

## Working quickly

- **Type-to-search item picker.** The price book has 215 entries; a dropdown of
  87 sights was unusable. Typing `kar` puts Karnak first (prefix matches rank
  above substring ones), Enter commits, Escape backs out. Only names that exist
  in the book can be committed.
- **Duplicate.** Most files are variations on one you have already built.
  Duplicate copies the terms and itinerary into a fresh quote and deliberately
  leaves the client, dates, bookings, invoices and history behind.
- **Unsaved changes are visible.** Saving is explicit, so a sticky bar appears
  the moment anything differs from what is stored, the button reads *Save
  changes* rather than *Saved*, and leaving the page warns you.
- **Search the file list** once there are more than four.
- **Confirm a service inline.** Once a supplier is assigned, type the reference
  straight into the row — the full editor is only needed for dates, costs and
  notes.

## Deleting a file

There is no delete for sales, operations or finance: a quote's history is the
record of who agreed to what. An **administrator** gets a guarded Delete on the
file, which refuses once any receipt or supplier payment has been recorded —
so a file where real money moved cannot be destroyed. Deleting takes the lines,
bookings, invoices, history and everything else with it, and cannot be undone.
Quote numbering never reuses a reference.

## Not built

Aged debtor reports, multi-file supplier statements, and accounting-package
export. Egyptian e-invoicing is not implemented — confirm with your accountant
what applies to a DMC billing foreign clients in USD before relying on these
invoices as tax documents.

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
