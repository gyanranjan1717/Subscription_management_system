# Brightloop: Subscription Management and Recurring Billing

Odoo × Make-A-Ton 9.0 (Kochi), Round 1. One system for products, plans, quotations, subscriptions, billing runs, invoices, payments and the finance dashboard.

**Stack:** Node.js 24 + TypeScript + Express · SQLite (WAL, `node:sqlite`) · JWT + bcrypt · React + TypeScript + Vite + Tailwind. No other services.

**What makes it trustworthy:** billing is idempotent (run it twice, the second run creates 0 invoices), missed periods are caught up, every amount is exact to the cent, and a built-in integrity report checks the ledger against the live database.

```
Product → Variant → Plan → Quotation → Subscription → Active → Billing run → Invoice → Payment → Paid → Customer portal → Finance dashboard
```

## Quick start

Requires Node 22 or newer (developed on 24).

```bash
npm --prefix backend install
npm --prefix frontend install
npm run seed        # rebuilds the SQLite database with demo data (wipes existing data)
npm run dev         # API on :5000, UI on http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm test` | 73 backend tests (Node test runner) |
| `npm run build` | type-checks and builds backend and frontend |
| `npm run benchmark` | builds a 5,000-subscription dataset and times the real endpoints |
| `npm run seed` | rebuilds the database (run it after pulling schema changes) |

Copy `.env.example` to `backend/.env` to change settings. In production `JWT_SECRET` (16+ characters) is mandatory, and the password-reset link is not returned by the API unless `EXPOSE_RESET_LINK=true` is set.

## Demo accounts

| Role | Email | Password |
|---|---|---|
| Admin | admin@brightloop.com | Brightloop#2026 |
| Staff | staff@brightloop.com | Brightloop#2026 |
| Customer (Acme) | acme@corp.com | Customer#2026 |
| Customer (Globex) | globex@biz.com | Customer#2026 |

Sign in with these to test each role. Sign out and sign in as a customer to check isolation.

`npm run seed` creates 7 subscriptions (Draft, Quotation, Paused, Closed and three Active, two of them months behind) and one historic billing run with a partly paid, overdue invoice. Three Active subscriptions are due today, so the first billing run shows a catch-up and the second shows `0`.

## 5 to 7 minute demo

1. **Sign in** as admin. The dashboard shows active subscriptions, MRR, invoiced, payments received, outstanding and overdue, plus a "Needs attention" box. Change the period filter.
2. **Catalog:** create a product (₹1,000) with an Odoo variant (+₹560); the list shows `+₹560 → ₹1,560`. Create a plan with minimum quantity, availability dates and lifecycle rules.
3. **Subscriptions → New subscription:** pick the customer, plan, product and variant; the review shows the unit price. Then **Send quotation → Confirm → Activate**; the stepper and Activity log follow each step.
4. **Billing run:** **Preview** (saves nothing), **Run billing** (catch-up creates every missed period), **Run billing again** (0 created). The integrity panel shows 0 duplicate and 0 missing periods. **Confirm all drafts.**
5. **Invoices:** open one (Subtotal − Discount + Tax = Total, then Paid and Outstanding). Record a partial payment, then the full balance: Confirmed → Paid.
6. **Sign in as a customer:** only that customer's subscriptions, invoices and payments appear; pause, resume or renew a subscription. Another customer's invoice id returns 404.
7. **Close with the evidence:** `npm test` (73 passing) and [docs/PERFORMANCE_RESULTS.md](docs/PERFORMANCE_RESULTS.md).

## Architecture

```
frontend/src                   backend/src
  pages/       one per screen    routes/    thin HTTP layer: auth, validation, status codes
  components/  ui.tsx (design    services/  business rules: billing, invoice maths, discounts, tax,
               system), Pager               state machine, payments, integrity report
  lib/         format (INR,      lib/       exact money (integer cents), dates, validation, errors
               dates)            db/        schema.sql (constraints, indexes), database.ts, seed.ts
  services/    api client      backend/tests   73 tests        backend/scripts/benchmark.ts
```

Details are in [ARCHITECTURE.md](ARCHITECTURE.md) and the requirement-by-requirement spec in [SPEC.md](SPEC.md).

### Frontend

A small design system (`components/ui.tsx`): labelled form controls, modal and confirm dialog (focus trap, Escape), status badges that pair colour with text, toasts, and loading / empty / error states. Navigation is role-aware and scrolls sideways on narrow screens. Amounts are shown, never calculated, in the browser (one exception: the exact-cents list-price preview of product price + variant extra, which the server recomputes and fixes when the line is saved). Lists use server-side pagination and search.

## How billing stays correct

- **Cursor and catch-up.** Each subscription stores `next_period_index` and `next_billing_date`. Period *k* starts at `start_date + k × interval`, always computed from the start date (31 Jan → 28 Feb → 31 Mar, no drift; leap days handled). A run advances period by period until the cursor passes the "bill as of" date, so a subscription three months behind gets three invoices.
- **The database is the authority.** `UNIQUE(subscription_id, period_start)` and `UNIQUE(subscription_id, period_index)` on `invoices`: a second invoice for the same period cannot be inserted.
- **Transactions.** Each subscription is billed in its own `BEGIN IMMEDIATE` transaction that re-reads the cursor after taking the write lock, then writes the invoice, lines, discount record and cursor together. Any error rolls that subscription back; the others are unaffected (tested with an injected failure mid catch-up).
- **Concurrency.** A test starts four real OS processes billing one file database at once: each period is created exactly once and a 5-use discount is handed out exactly 5 times.
- **Proof.** `GET /api/billing/integrity` (shown on the Billing run page) reports duplicate periods, missing periods, invoice total mismatches, payment mismatches and invalid references.

**Money.** All arithmetic is in integer cents with HALF_UP rounding per line, in one calculator (`services/invoiceCalculator.ts`). `total = subtotal − discount + tax` is enforced by a database `CHECK`. User-entered amounts are parsed from text, never via floats. A line's unit price (product price + variant extra) is copied when the line is created, so later price changes never touch existing lines or invoices. Tax is computed per line on the discounted amount and its rate is stored on the invoice line.

## Security, roles and isolation

- **Passwords:** more than 8 characters (9–64) with upper, lower and special character; bcrypt. Email is unique case-insensitively through a database index (`lower(email)`); duplicates return 409.
- **Reset:** random 32-byte token, only its SHA-256 is stored, 30-minute expiry, single use, a new request kills older links, identical response for unknown emails. The email is written to `email_outbox` (dev mailbox; there is no SMTP).
- **Sessions:** JWT (HS256) is verified, then the user is re-read from the database on every request, so role changes and deactivation apply immediately. Login and forgot-password are rate limited.
- **Roles (enforced on the server):** only **admin** creates staff, products, plans, taxes, discounts and quotation templates. **Staff** runs billing, confirms invoices and records payments. **Customers** have no catalog, billing or dashboard access.
- **Isolation:** a customer requesting another customer's subscription, timeline, invoice, renewal or status change gets the same `404` as for an id that does not exist, and list filters are forced from the token. Tested explicitly.
- Errors never expose stack traces or SQL; CSV exports neutralise spreadsheet formulas; request bodies are size-limited; all writes are validated server-side.

## Performance (measured)

`npm run benchmark` builds 2,000 customers, 5,000 subscriptions, 25,024 invoices, 17,891 payments (500 subscriptions due today) in a temporary file database and times real HTTP requests (20 runs each) on the author's laptop (Node 24, Windows, i5-1235U).

| Measure | Result |
|---|---|
| Slowest request across all list, dashboard and portal endpoints | 67.5 ms (billing integrity report) |
| Finance dashboard (median) | 34 ms |
| Invoice list, page 1 / page 200 (median) | 1 ms / 4 ms |
| Real billing run, 500 due subscriptions | 184 ms (repeat run: 0 invoices) |

Run-to-run noise on this machine is roughly 2 to 4× (an earlier run measured 236 ms for the slowest request), so read these as an order of magnitude, all far below the 2-second target. The full table and the query plans (all index-backed) are in [docs/PERFORMANCE_RESULTS.md](docs/PERFORMANCE_RESULTS.md) and are regenerated by each run. Every list is paginated (100 rows by default, 200 maximum), aggregates run in SQL, and a test asserts that list endpoints run a constant number of statements regardless of page size.

## Requirement coverage (R01–R25)

"Test" names a file in `backend/tests`. Assumptions and details are in [SPEC.md](SPEC.md).

| ID | Requirement | Status | Test | Where to see it |
|---|---|---|---|---|
| R01 | Customer sign-up | Done | api | Sign-in → Create account |
| R02 | One account per email, case-insensitive | Done (DB index) | api | Create the same account twice |
| R03 | Password rule | Done | money_dates, api | Sign-up form |
| R04 | Reset link to registered email | Partial: dev outbox, no SMTP | api | My account → Password |
| R05 | Three roles, customer portal | Done | api, demo_story | Sign in as each role |
| R06 | Only admin adds staff | Partial: admin sets the initial password, no invite email | api | Staff |
| R07 | Product with prices and notes | Done | catalog_lists | Catalog → Products |
| R08 | Variants (Odoo +560) | Done | billing, catalog_lists, demo_story | New subscription review (₹1,560) |
| R09 | Plan cadence, minimum quantity, dates | Partial: plan `price` is informational | catalog_lists, api | Catalog → Plans |
| R10 | Per-plan close, pause, renew, auto-close | Done | api, billing | Plan form, portal buttons |
| R11 | Quotation templates with validity | Done | catalog_lists, api | New subscription → template |
| R12 | Subscription number, lines, minimum quantity | Done | api, billing | Subscriptions |
| R13 | Draft → Quotation → Confirmed → Active → Closed | Done (plus Paused, timeline) | api | Subscription detail |
| R14 | Invoices created from subscriptions | Done (Draft) | billing, demo_story | Billing run |
| R15 | Automatic tax from admin rules | Done (rate edit via API only) | billing, catalog_lists | Invoice view |
| R16 | Confirm, cancel, send, print | Done (send = outbox, print = browser) | api, catalog_lists | Invoices |
| R17 | Nothing billed twice or skipped | Done | billing, concurrency, demo_story | Billing run twice |
| R18 | Admin-only discount rules | Done | api, billing | Catalog → Discounts |
| R19 | Product or subscription scope | Done (one rule per subscription) | billing | Invoice discount line |
| R20 | Discount applies and stops by itself | Done | billing, concurrency | Invoice view |
| R21 | Payments with method, amount, date, note | Done (partial allowed, no overpayment) | api, demo_story | Record payment |
| R22 | Paid, outstanding, overdue, chasing | Partial: "Send" re-sends the invoice, no separate reminder | api | Invoices, Dashboard |
| R23 | Finance view with filters | Done (date range) | catalog_lists, api | Dashboard |
| R24 | Pages under 2 seconds | Done (measured above) | performance | `npm run benchmark` |
| R25 | Customer self-service | Done | api | My account |

## Tests (73)

`api` 27 · `billing` 21 · `catalog_lists` 12 · `money_dates` 8 · `performance` 3 · `concurrency` 1 · `demo_story` 1. `demo_story` follows the demo script end to end through the API. The frontend has no automated tests; it is type-checked, built and was exercised manually.

## Known limitations

- SQLite has a single writer, so billing is serialised per database file. That is fine at this scale; a multi-node deployment would need PostgreSQL.
- Plan `price` is stored but not invoiced as a separate fee (SPEC assumption A2 is open); invoices are built from subscription lines.
- Invoice numbers are assigned when billing creates the invoice, not at confirmation. One discount rule per subscription.
- Tax-rate editing is API-only, and there is no endpoint to deactivate users (the `active` flag is enforced at login but set only in the database).
- Money is stored as 2-decimal numbers (computed in cents, protected by `CHECK`) rather than integer columns.
- The schema is versioned; after an update run `npm run seed`, which rebuilds the database.
