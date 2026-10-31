# Handoff report: what changed and where to continue

Scope: three hardening passes on the existing Brightloop app (backend, performance, then frontend), starting from commit `df651c3`. Stack unchanged: Node + TypeScript + Express, SQLite (WAL), JWT + bcrypt, React + Vite + Tailwind. Total: about 64 files changed.

Current state: **73 backend tests pass**, backend and frontend build, benchmark slowest request 67.5 ms. Nothing was pushed by the assistant; the owner commits manually.

## 1. Backend correctness (billing, money, security)

| Area | What changed | Main files |
|---|---|---|
| Billing engine | Catch-up of every missed period; per-subscription `BEGIN IMMEDIATE` transaction; cursor (`next_period_index`, `next_billing_date`); dry run; auto-close at expiry; invoice numbers from a sequence | `services/billingEngine.ts`, `db/database.ts` |
| Idempotency | `UNIQUE(subscription_id, period_start)` and `UNIQUE(subscription_id, period_index)` | `db/schema.sql` |
| Money | All maths in integer cents, HALF_UP per line, one calculator; `CHECK(total = subtotal − discount + tax)` | `lib/money.ts`, `services/invoiceCalculator.ts` |
| Tax | Per line on the discounted amount; rate stored on the invoice line; rate edit endpoint `PATCH /api/catalog/taxes/:id` | `services/taxEngine.ts`, `routes/catalog.routes.ts` |
| Discounts | Server-side validation, atomic usage claim, usage records, DB cap, judged at each period start | `services/discountEngine.ts` |
| Payments | Exact cents, no overpayment, only on Confirmed invoices, re-read inside the write transaction | `services/paymentService.ts` |
| State machine | Server-enforced subscription and invoice transitions (409 on illegal), plan flags, quotation validity, pause windows | `services/stateMachine.ts`, `subscriptionService.ts` |
| Integrity report | `GET /api/billing/integrity` (duplicates, missing periods, total and payment mismatches, bad references) | `services/integrityService.ts` |
| Auth and RBAC | Role re-read from DB every request, hashed single-use reset tokens, rate limiting, admin-only catalog writes, cost price hidden from non-admins, customer isolation returns 404 | `middleware/auth.ts`, `routes/*.ts` |
| Validation and errors | Central validators and `HttpError`; no stack traces or SQL in responses; CSV formula neutralising, money columns with two decimals | `lib/validation.ts`, `lib/errors.ts`, `routes/analytics.routes.ts` |

## 2. Database

- `schema.sql` rewritten with constraints and purposeful indexes. Schema is versioned (`SCHEMA_VERSION = 2`): an old database is refused until `npm run seed` rebuilds it.
- Added tables: `email_outbox`, `sequences`, `invoice_discounts`, `subscription_pauses`, `subscription_period_skips`. Unique index on `lower(users.email)`.
- `seed.ts` produces a small deterministic demo set plus one historic billing run (so the first run shows catch-up).

## 3. Performance

- Prepared-statement cache; batched line loading in billing; every list paginated (100 default, 200 max) with server-side search and date filters; dashboard aggregated in SQL with a period filter.
- `backend/scripts/benchmark.ts` (`npm run benchmark`) builds 2,000 customers, 5,000 subscriptions, about 25,000 invoices and 18,000 payments, and writes `docs/PERFORMANCE_RESULTS.md`.

## 4. Tests (73)

`api` 27 · `billing` 21 · `catalog_lists` 12 · `money_dates` 8 · `performance` 3 · `concurrency` 1 · `demo_story` 1, in `backend/tests/` (Node test runner, `tsx`). `helpers.ts` + `env.ts` set up an in-memory database. `concurrency.test.ts` spawns four real processes against one file database. The old `business_rules.test.ts` was replaced and its coverage ported. No frontend tests exist.

## 5. Frontend

- Design system in `components/ui.tsx` (Button, labelled form controls, Modal, ConfirmDialog, Card, Stat, Tabs, StatusBadge, toasts, Loading / Empty / Error states, table classes). `lib/format.ts` has INR and date formatting.
- Pages rewritten on that kit: Login (sign in, sign up, forgot password), Dashboard, Catalog (products, variants, plans, taxes, discounts, quotation templates), Subscriptions (create form with review, lifecycle stepper, state-dependent actions, activity), Billing run (preview, run, confirm drafts, runs table, integrity panel), Invoices (invoice view, partial and full payment), Customer portal ("My account"), Staff.
- Layout is full width. The demo account switcher and the demo-accounts box on the login page were removed on request.
- All `alert()` / `confirm()` calls were replaced with toasts, inline errors and dialogs.

## 6. Documentation

`README.md` (quick start, demo script, billing and security explanation, R01–R25 coverage, limitations), `SPEC.md` (R01–R25 with status and tests), `ARCHITECTURE.md`, `docs/PERFORMANCE_RESULTS.md` (generated).

## 7. Run and verify

```bash
npm --prefix backend install && npm --prefix frontend install
npm run seed      # rebuilds the database (wipes data)
npm run dev       # API :5000, UI http://localhost:3000
npm test          # 73 tests
npm run build
npm run benchmark
```

Demo logins (not shown in the UI any more): admin@brightloop.com / staff@brightloop.com with `Brightloop#2026`; acme@corp.com / globex@biz.com with `Customer#2026`.

## 8. Known limitations and good next steps

1. **Plan `price` is not billed** (SPEC assumption A2 is open). Invoices come from subscription lines. Decide with the mentor, then add a "Plan fee" invoice line.
2. **Email is a dev outbox** (`email_outbox`); no SMTP. Reset and invoice emails are stored, not sent. Staff creation sets a password directly (no invite link).
3. Invoice numbers are assigned at billing, not at confirmation. One discount rule per subscription.
4. Tax rates can be edited only through the API; there is no UI. There is no endpoint to deactivate users (`active` is only set in the database).
5. Money columns are 2-decimal numbers protected by `CHECK`, not integer columns.
6. No frontend automated tests (suggest Playwright for the demo path); the UI was verified manually and with the API-level `demo_story` test.
7. SQLite is single-writer: fine here, but a multi-node deployment needs PostgreSQL.
8. Overpayment errors from the server show the amount without the ₹ symbol.
9. The portal shows the stored billing cursor only for Active subscriptions; paused subscriptions show a dash.

## 9. Things to know before editing

- Never compute invoice money outside `services/invoiceCalculator.ts` and `lib/money.ts`.
- Billing writes must stay inside `runTransaction` (re-entrant: outer `BEGIN IMMEDIATE`, inner savepoints).
- Any schema change needs a `SCHEMA_VERSION` bump, a `schema.sql` edit and a reseed; update the tests that rely on constraints.
- The frontend never calculates money. The only exception is the exact-cents list-price preview (product price + variant extra) in Catalog and the new-subscription review; the server recomputes it.
