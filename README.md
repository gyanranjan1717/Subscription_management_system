# Brightloop — Subscription Management & Recurring Billing

Odoo × Make-A-Ton 9.0 (Kochi) · Round 1 · one system for products, plans, quotations, subscriptions, billing runs, invoices, payments and the finance dashboard.

**Stack:** Node.js 24 + TypeScript + Express · SQLite (WAL, `node:sqlite`) · JWT + bcrypt · React + TypeScript + Vite + Tailwind. No other services.

## 1. What it does

`Product → Variant → Plan → Quotation → Subscription → Active → Billing run → Invoice → Payment → Paid → Customer portal → Finance dashboard`

The point of the project is **billing correctness**: running billing twice creates 0 invoices the second time, periods are never skipped (catch-up), every amount is exact to the cent, and a built-in integrity report proves it.

## 2. Architecture

```
frontend/ (React, Vite)      backend/src/
  pages/  Login, Dashboard,    routes/      thin HTTP layer: auth, validation, status codes
          Catalog, Subs,       services/    business rules (billing, invoice math, discounts,
          BillingRun, Invoices,             tax, state machine, payments, integrity report)
          CustomerPortal       lib/         exact money (integer cents), dates, validation, errors
  components/ ui, Pager        db/          schema.sql (constraints + indexes), database.ts, seed.ts
backend/tests/   73 tests      scripts/benchmark.ts   reproducible performance benchmark
```

More detail in [ARCHITECTURE.md](ARCHITECTURE.md); requirement-by-requirement spec in [SPEC.md](SPEC.md).

## 3. Setup, run, test

Requires Node 22+ (developed on 24).

```bash
npm --prefix backend install
npm --prefix frontend install
npm run seed          # (re)builds the SQLite database with demo data. Wipes existing data.
npm run dev           # API on :5000, UI on http://localhost:3000
npm test              # 73 backend tests
npm run build         # type-checks and builds backend and frontend
npm run benchmark     # builds a 5,000-subscription dataset and times the real endpoints
```

Copy `.env.example` to `backend/.env` to change settings. In production `JWT_SECRET` (16+ chars) is mandatory and the password-reset link is not returned by the API unless `EXPOSE_RESET_LINK=true` is set explicitly.

## 4. Demo accounts

| Role | Email | Password |
|---|---|---|
| Admin | admin@brightloop.com | Brightloop#2026 |
| Staff | staff@brightloop.com | Brightloop#2026 |
| Customer (Acme) | acme@corp.com | Customer#2026 |
| Customer (Globex) | globex@biz.com | Customer#2026 |

The sign-in page fills these for you; the bar at the top of the app switches between them with one click.

## 5. Demo data

`npm run seed` creates 7 subscriptions (Draft, Quotation, Paused, Closed and three Active, two of them months behind) and one historic billing run with a partly paid, overdue invoice. Three Active subscriptions are due today, so the first run shows a catch-up and the second run shows `0`.

## 6. Billing idempotency (how "never twice, never skipped" works)

- **Cursor.** Each subscription stores `next_period_index` / `next_billing_date`. Period *k* starts at `start_date + k × interval`, always computed from the start date (so 31 Jan → 28 Feb → 31 Mar, never drifting; leap days handled).
- **Catch-up.** A run advances one period at a time until the cursor passes the "bill as of" date, so a subscription that is three months behind gets three invoices, not one.
- **Database is the authority.** `UNIQUE(subscription_id, period_start)` and `UNIQUE(subscription_id, period_index)` on `invoices`. Even a buggy caller cannot insert a second invoice for a period.
- **Transactions.** Each subscription is billed inside its own `BEGIN IMMEDIATE` transaction: it re-reads the cursor after taking the write lock, inserts invoice, lines, discount record and cursor update together, and rolls back as a unit on any error. One failing subscription never blocks or undoes the others (tested with an injected mid-catch-up failure).
- **Concurrency.** A test starts four real OS processes billing the same file database at once: every period is created exactly once and a 5-use discount is handed out exactly 5 times.
- **Proof in the UI.** Billing Run shows invoices created per run and a live integrity report (duplicate periods, missing periods, total and payment mismatches, invalid references), all computed from the database. *Preview* runs the whole calculation and rolls it back.

## 7. Money

All arithmetic is in integer cents with HALF_UP rounding per line (`backend/src/lib/money.ts`, one calculator in `services/invoiceCalculator.ts`). `total = subtotal − discount + tax` is checked by a database `CHECK`. Amounts typed by users are parsed from strings, never through floats. Line unit price = product price + variant extra, copied when the line is created; later price changes never touch existing lines or invoices. Tax is calculated per line on the discounted amount and the rate is stored on the invoice line.

## 8. Security, RBAC and customer isolation

- Passwords: more than 8 characters (9–64), upper + lower + special, digits not required; bcrypt hashes. Email unique case-insensitively through a database index (`lower(email)`), duplicates return 409.
- Reset: random 32-byte token, only its SHA-256 is stored, 30-minute expiry, single use, a new request kills older links, identical answer for unknown emails. The "email" lands in `email_outbox` (dev mailbox); there is no SMTP.
- JWT (HS256) is verified, then the user is re-read from the database on every request, so role changes and deactivation take effect immediately. Login/forgot-password are rate limited.
- Roles are enforced on the server: only **admin** creates staff, products, plans, taxes, discounts and templates; **staff** runs billing, confirms invoices, records payments; **customers** have no catalog/billing/dashboard access. The UI hides what a role cannot use, but nothing relies on that.
- **Isolation.** A customer asking for another customer's subscription, timeline, invoice, renewal or status change gets the same `404` as for an id that does not exist. List endpoints force the customer filter from the token, so query parameters cannot widen it. Tested explicitly.
- Errors never expose stack traces or SQL; CSV exports neutralise spreadsheet formulas; request bodies are size-limited; every write input is validated server-side.

## 9. Performance (measured)

`npm run benchmark` on the author's laptop (Node 24, Windows, i5-1235U, file database) with 2,000 customers, 5,000 subscriptions, 25,024 invoices, 17,891 payments, 500 due today, real HTTP requests, 20 runs each:

- Slowest request across all list/dashboard/portal endpoints: **67.5 ms** (billing integrity report); finance dashboard median **34 ms**, invoice list page median **1 ms**, deep pages (page 200) **4 ms**.
- Real billing run for the 500 due subscriptions: **184 ms**; repeat run: **0 invoices, 0 ms**.

Run-to-run noise on this machine is roughly 2–4× (earlier runs of the same benchmark measured up to 236 ms for the slowest request), so treat the numbers as an order of magnitude; the full table (and the query plans, which all use indexes) is in [docs/PERFORMANCE_RESULTS.md](docs/PERFORMANCE_RESULTS.md) and is regenerated by each benchmark run. Every list is paginated (100 rows by default, 200 max), aggregates run in SQL, and tests assert that list endpoints execute a constant number of statements regardless of page size.

## 10. Requirement coverage (R01–R25 from SPEC.pdf)

"Tested" = an automated test in `backend/tests`. "Demo" = where to show it. Details and assumptions in [SPEC.md](SPEC.md).

| ID | Requirement | Status | Test | Demo |
|---|---|---|---|---|
| R01 | Customer sign-up | Implemented | api | Sign-in page → Create account |
| R02 | One account per email (case-insensitive) | Implemented (DB index) | api | Create account twice |
| R03 | Password rule (>8, upper, lower, special) | Implemented | money_dates, api | Sign-up form |
| R04 | Reset link to registered email | Implemented; dev outbox, no SMTP | api | Customer Portal → reset |
| R05 | Three roles, customer portal | Implemented | api | Persona switcher |
| R06 | Only admin adds staff | Implemented (admin sets initial password; no invite email) | api | Staff Admin |
| R07 | Product: name, type, prices, notes | Implemented | catalog_lists | Catalog → Products |
| R08 | Variants (Odoo +560) | Implemented | billing, catalog_lists, demo_story | Create subscription (1560) |
| R09 | Plan: cadence, min qty, dates | Implemented; plan price is informational, not billed | catalog_lists, api | Catalog → Plans |
| R10 | Per-plan close/pause/renew/auto-close | Implemented | api, billing | Plan form + portal buttons |
| R11 | Quotation templates with validity | Implemented | catalog_lists, api | New subscription → template |
| R12 | Subscription number, lines, min qty | Implemented | api, billing | Subscriptions |
| R13 | Draft→Quotation→Confirmed→Active→Closed (+Paused) | Implemented; timeline per subscription | api | Subscriptions, Activity |
| R14 | Invoices created from subscriptions | Implemented (Draft) | billing | Billing Run |
| R15 | Automatic tax from admin rules | Implemented (rate edit via API; no edit screen) | billing, catalog_lists | Invoice view |
| R16 | Confirm / cancel / send / print | Implemented (send = outbox; print = browser print) | api, catalog_lists | Invoices |
| R17 | Nothing billed twice or skipped | Implemented | billing, concurrency, demo_story | Billing Run ×2 |
| R18 | Admin-only discount rules | Implemented | api, billing | Catalog → Discounts |
| R19 | Product vs subscription scope | Implemented (one rule per subscription) | billing | Invoice discount line |
| R20 | Discount appears and stops by itself | Implemented | billing | Invoice view |
| R21 | Payments: method, amount, date, note | Implemented (partial; no overpayment) | api, demo_story | Pay button |
| R22 | Paid / outstanding / overdue, chasing | Implemented; no separate reminder email | api | Invoices, Dashboard |
| R23 | Finance view with filters | Implemented (date-range filter) | catalog_lists, api | Dashboard |
| R24 | Pages under 2 s with thousands of rows | Measured, see section 9 | performance | `npm run benchmark` |
| R25 | Customer self-service | Implemented | api | Customer Portal |

## 11. Known limitations

- SQLite single-writer: billing is serialised per database file. Fine for this scale; a multi-node deployment would need PostgreSQL.
- Plan `price` is stored but not invoiced as a separate fee (SPEC assumption A2 left open); invoices come from subscription lines.
- Invoice numbers are assigned when billing creates the invoice, not at confirmation.
- One discount rule per subscription (SPEC A10 allows best-of several).
- Tax-rate editing exists in the API only, not in the UI. There is no endpoint to deactivate users (the `active` column is enforced at login but only set in the database).
- Money is stored as 2-decimal numbers (computed in cents, protected by `CHECK`) rather than integer columns.
- Frontend has no automated tests; it is type-checked, built and was exercised manually.
- Database schema is versioned; after an update run `npm run seed` (it rebuilds the database).
