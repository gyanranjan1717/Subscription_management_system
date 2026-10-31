# Architecture

## Layers

```
React UI  ──HTTP/JSON──▶  Express routes  ──▶  services  ──▶  SQLite (WAL, constraints)
(pages, ui, Pager)        (auth, validation,    (business      schema.sql is the final
                           status codes)         rules)         authority on integrity)
```

| Layer | Files | Responsibility |
|---|---|---|
| Routes | `backend/src/routes/*.routes.ts` | Authenticate, authorise, validate input, map errors to status codes. No business rules. |
| Middleware | `middleware/auth.ts` | JWT verification, role re-read from the database, `requireRole`, customer-isolation helper (404), login rate limit |
| Services | `services/*.ts` | `billingEngine`, `invoiceCalculator` (single place where invoice money is computed), `discountEngine`, `taxEngine`, `stateMachine` (subscription + invoice lifecycle), `paymentService`, `subscriptionService`, `integrityService`, `timelineService`, `audit` |
| Lib | `lib/money.ts` `dates.ts` `validation.ts` `errors.ts` | Integer-cent arithmetic (HALF_UP), UTC date arithmetic with month-end clamping, request validation, `HttpError` |
| Database | `db/schema.sql`, `db/database.ts` | Constraints, indexes, re-entrant transactions (`BEGIN IMMEDIATE` / savepoints), prepared-statement cache, gap-free sequences |

## Data model (SQLite)

`users` · `password_resets` (hashed token) · `email_outbox` · `sequences` · `tax_rules` · `products` · `product_variants` · `plans` · `quotation_templates` + `_lines` · `discount_rules` · `subscriptions` + `subscription_lines` · `subscription_pauses` · `subscription_period_skips` · `invoices` + `invoice_lines` + `invoice_discounts` · `payments` · `audit_logs`.

Guarantees enforced by the database itself (not only by code):

- `UNIQUE(subscription_id, period_start)` and `UNIQUE(subscription_id, period_index)` on `invoices`: a period can be billed once.
- `CHECK(total = subtotal − discount + tax)`, `amount_paid ≤ total_amount`, 2-decimal money, `due_date ≥ issue_date`.
- `CHECK(max_uses = 0 OR current_uses ≤ max_uses)` on discounts; the usage claim is a guarded `UPDATE`.
- Unique index on `lower(users.email)`; role, status and type enums as `CHECK`s; foreign keys on.

Indexes (each backs a real query): subscriptions by customer, plan, `(status, next_billing_date)`; invoices by `(customer_id, id)`, `(status, due_date)`, `issue_date`; invoice lines by invoice; payments by invoice and date; audit by subscription / invoice. `tests/performance.test.ts` and `scripts/benchmark.ts` print the query plans.

## Billing flow

1. Load tax rules once and the lines of all due subscriptions in batched queries.
2. For each due Active subscription, open a `BEGIN IMMEDIATE` transaction, re-read its cursor.
3. While the next period starts on or before the "as of" date (and before expiry): skip it if an invoice exists, otherwise compute the invoice with `calculateInvoice`, claim a discount use if one applies, insert invoice + lines + discount record.
4. Advance the cursor once, commit. Any error rolls back that subscription only.
5. Auto-close plans whose term has ended; write one audit record for the run.

A *dry run* executes steps 1–5 inside an outer transaction and rolls it back.

## Frontend

React + Tailwind, no UI library. `services/api.ts` is the only place that calls the API; amounts are displayed with `lib/format.ts` and never calculated in the browser. Lists use server-side pagination and search (`components/Pager.tsx`), statuses use one `StatusBadge`, and errors/success use inline `Alert`s. Navigation is filtered by role for convenience; authorisation is on the server.

## Testing

`npm test` runs `backend/tests/*.test.ts` with Node's built-in test runner (73 tests): unit tests for money, dates and the password rule; billing and discount behaviour against a real in-memory database; API tests over HTTP for auth, RBAC, isolation, lifecycle, payments and dashboard; a four-process concurrency test on a file database; a performance test on 3,000 subscriptions; and an end-to-end demo-story test that follows the demo script.
