# Specification (R01–R25) and how this repository meets it

Source: the problem statement and the team's SPEC.pdf. Status values: **Done** (implemented and covered by an automated test), **Partial** (works, with the stated gap). Test files are in `backend/tests`.

## Requirements

| ID | Requirement | Implementation | Status | Tests |
|---|---|---|---|---|
| R01 | Customer signs up with email and password; public sign-up creates a customer only | `POST /api/auth/register`; role never read from the request | Done | api |
| R02 | Each email belongs to one account, case-insensitive | Unique index on `lower(email)`; duplicate returns 409 | Done | api |
| R03 | Password more than 8 characters, with uppercase, lowercase and special character (digits not required, max 64) | `validatePassword`, same rule for sign-up, reset and staff creation | Done | money_dates, api |
| R04 | Reset link arrives at the registered email | Token hashed (SHA-256), 30 min, single use, older links invalidated; email stored in `email_outbox` | Partial: dev outbox, no SMTP | api |
| R05 | Admin, staff and customer roles; customers see only their own data | Server-side `requireRole` + 404 isolation | Done | api, demo_story |
| R06 | Only the admin adds staff | `POST /api/auth/staff` admin-only | Partial: admin sets the initial password (no invite email) | api |
| R07 | Products: name, type, sales price, cost price, notes | `POST /api/catalog/products`; cost price hidden from staff and customers | Done | catalog_lists, api |
| R08 | Variants add a price extra (Odoo +560 on 1000 gives 1560) | Unit price copied onto the line at creation | Done | billing, catalog_lists, demo_story |
| R09 | Plans: price, daily/weekly/monthly/yearly, minimum quantity, availability dates | `POST /api/catalog/plans`; window enforced on create and confirm; minimum quantity per line | Partial: plan `price` is informational, invoices bill subscription lines | catalog_lists, api |
| R10 | Per plan: closes on its own, can be closed early, paused, renewed | `auto_close`, `can_close_early`, `can_pause`, `can_renew`; violations return 409 for every role | Done | api, billing |
| R11 | Quotation templates with plan, lines, validity days | Template lines copied; `valid_until = date sent + validity_days`; confirming after it returns 409 | Done | catalog_lists, api |
| R12 | Subscription number, customer, plan, dates, payment terms, lines | Number from a sequence; terms `Immediate Payment` / `N Days Net` | Done | api, billing |
| R13 | Draft → Quotation → Confirmed → Active → Closed, visible to the team | State machine (plus Paused); illegal transitions 409; Closed is terminal; timeline per subscription | Done | api |
| R14 | Invoices created from subscriptions with lines, taxes, totals | Billing engine creates Draft invoices | Done | billing, demo_story |
| R15 | Taxes calculated automatically from admin rules | Per line on the discounted amount, HALF_UP, rate stored on the line; `PATCH /api/catalog/taxes/:id` affects later invoices only | Done (no UI to edit a rate) | billing, catalog_lists, money_dates |
| R16 | Confirm, cancel, send, print invoices; Draft → Confirmed → Paid | Cancel blocked once paid; Paid only through payments; send writes to the outbox; print uses the browser | Done | api, catalog_lists |
| R17 | Nothing billed twice or skipped | Cursor + catch-up + unique constraints + per-subscription transactions + integrity report | Done | billing, concurrency, demo_story |
| R18 | Only admin creates discount rules (fixed/percentage, minimums, dates, usage limit) | `POST /api/catalog/discounts` admin-only, validated | Done | api, billing |
| R19 | Discount applies to products or whole subscriptions | Scope `product` or `all`/`subscription` | Done | billing |
| R20 | Discount appears on the next invoice by itself and stops at expiry or exhaustion | Evaluated per invoice; usage claimed atomically; detached when spent or expired | Done | billing, concurrency |
| R21 | Payments with method, amount, date, note against the right invoice | Partial allowed; overpayment and non-Confirmed invoices refused | Done | api, demo_story |
| R22 | See paid / outstanding / overdue to chase overdue | Overdue = Confirmed, balance > 0, due date before today; filters and dashboard list | Partial: no separate reminder email, "Send" re-sends the invoice | api |
| R23 | Finance view: active subscriptions, revenue, payments, overdue, with filters and summary | `GET /api/analytics/summary` (SQL aggregates, date range) | Done | api, catalog_lists |
| R24 | Pages respond in under 2 seconds with thousands of subscriptions | Indexes, pagination, SQL aggregation; `npm run benchmark` | Done (measured, see README) | performance |
| R25 | Customers manage their own subscriptions | Pause, resume, close, renew where the plan allows | Done | api |

## Assumptions made where the PDF is silent

- One currency (displayed as ₹); prices exclude tax.
- Billing is in advance. Period *k* starts at `start_date + k × interval` (month-end clamped, computed from the start date). `due_date = invoice date + payment-term days`.
- A period starting on or after the expiry date is not billed. With auto-close off, an expired subscription stays Active for follow-up.
- Periods that start while a subscription is paused are not billed; they are recorded as intentional skips.
- A discount is judged at each period's start date, so a catch-up run gives the same result as on-time billing.
- Plan minimum quantity applies to every product line.
- A line's unit price is not editable after creation.
- Invoices are created as Draft by default (optionally Confirmed); payments are accepted only on Confirmed invoices.

## API summary

`/api/auth` (register, login, forgot-password, reset-password, me, staff, customers, outbox) · `/api/catalog` (products, variants, plans, taxes, discounts, quotation-templates) · `/api/subscriptions` (list, detail, timeline, create, renew, status) · `/api/billing` (run, history, integrity, invoices, confirm-drafts, invoice status, send) · `/api/payments` · `/api/analytics` (summary, benchmark, CSV exports). Every list is paginated (`page`, `page_size`) and returns `pagination`.
