# Technical Specification: Brightloop Subscription Management System

## 1. Executive Summary & Challenge Overview
Brightloop Software sells cloud software, add-ons, and variants on recurring billing models (daily, weekly, monthly, yearly).
This system provides an end-to-end, multi-role subscription management platform covering:
- Master Catalog: Products, Variants (e.g. Odoo brand +$560), Plans, Tax rules, Discount rules.
- Quotation Engine: Pre-configured quotation templates valid for $N$ days, converting to Subscriptions.
- Subscription Lifecycle: State machine transitions (`Draft` -> `Quotation` -> `Confirmed` -> `Active` -> `Closed` / `Paused`).
- Recurring Billing Engine: Automated batch & manual billing day execution, strictly idempotent (never bills twice, never skips).
- Invoicing & Payments: Invoices (`Draft` -> `Confirmed` -> `Paid`), multiple payment methods, partial payments, overdue tracking.
- Role-Based Access Control (RBAC): Admin (full master setup & staff provisioning), Staff (operations & invoicing), Customer (strict isolated portal view).
- Finance Dashboard: Real-time MRR, ARR, revenue collected vs owed, overdue invoices, with sub-2s query latency on thousands of records.

---

## 2. Requirements Matrix & Edge Case Trap Checklist

| Ref | Requirement | Implementation Strategy | Verification Test |
|---|---|---|---|
| R01 | User signup with unique email | Unique constraint on `users.email` | Rejects duplicate registration |
| R02 | Password validation: **more than 8 characters** with uppercase, lowercase, special char | Regex `^(?=.*[a-z])(?=.*[A-Z])(?=.*[^a-zA-Z0-9]).{9,}$` | Accepts 9+ valid, rejects 8 chars or missing char class |
| R03 | Password reset link to email | Token generated with expiration, logged to audit email log | Reset token generation & validation test |
| R04 | Role segregation (Admin, Staff, Customer) | Middleware RBAC; only Admin creates staff; Customer sees only their data | Forbidden 403 on staff creation by non-admin; customer isolation test |
| R05 | Products with variants | `products` table and `product_variants` with price adjusters (e.g., Odoo Brand adds 560) | Unit price = product base price + variant delta |
| R06 | Plans with frequencies & rules | Interval: `daily`, `weekly`, `monthly`, `yearly`; min quantity; date bounds; auto-close vs renewable/pausable policy | Validates interval calculation & plan date bounds |
| R07 | Quotation Templates | Templates with predefined product lines, plan, validity in days | Converts template to Draft subscription |
| R08 | Subscription state machine | Legal transitions only: `Draft` -> `Quotation` -> `Confirmed` -> `Active` -> `Closed` (or `Paused`) | Rejects illegal transition (e.g., `Draft` -> `Active`) |
| R09 | Automated Billing Engine | Queries active subscriptions where `next_billing_date <= as_of_date` | Generates invoices with line items, tax, discounts |
| R10 | **Trap: Zero double-billing & no skipped periods** | Unique composite constraint `UNIQUE(subscription_id, period_start)`, transactional execution | Second run generates 0 new invoices for identical period |
| R11 | Automatic Tax Rules | `tax_rules` applied to taxable items dynamically | Tax computation verification on invoice lines |
| R12 | Discount Rules Engine | Fixed or percentage; min order/qty; date range; max usage count; auto-applies to invoice and decrements usage | Decrements usage, auto-expires when limit or end-date reached |
| R13 | Invoice Lifecycle & Actions | `Draft` -> `Confirmed` -> `Paid`; cancel, send, print (HTML/PDF printable format) | Status checks and print view |
| R14 | Multi-method payment recording | Bank Transfer, Card, UPI, Cash, Cheque with reference, note, date | Partial payments update balance; completes when fully paid |
| R15 | Overdue Invoice Management | Flags unpaid invoices past due date for chasing | Filter & highlight overdue invoices |
| R16 | Finance Executive Dashboard | Active count, MRR, ARR, cash collected, accounts receivable, overdue list | Summary calculations verified |
| R17 | Sub-2-Second Performance (<50ms target) | Indexed keys on `(customer_id)`, `(status)`, `(next_billing_date)`, `(subscription_id, period_start)` | Tested against 1,000+ seeded records |

---

## 3. Database Schema Design (Relational & Normalized)

### 3.1 Tables Overview
1. `users` (id, email, password_hash, full_name, role, created_at)
2. `password_resets` (id, user_id, token, expires_at, used)
3. `products` (id, name, type, sales_price, cost_price, notes, is_active, created_at)
4. `product_variants` (id, product_id, attribute_name, option_name, price_extra)
5. `plans` (id, name, billing_interval, min_quantity, price, start_date, end_date, auto_close, can_pause, can_renew)
6. `quotation_templates` (id, name, plan_id, validity_days, notes)
7. `quotation_template_lines` (id, template_id, product_id, variant_id, default_quantity)
8. `subscriptions` (id, subscription_number, customer_id, plan_id, status, start_date, expiry_date, next_billing_date, payment_terms, discount_rule_id, created_at, updated_at)
9. `subscription_lines` (id, subscription_id, product_id, variant_id, quantity, unit_price, tax_id)
10. `tax_rules` (id, name, rate_percentage, is_default, is_active)
11. `discount_rules` (id, code, description, discount_type, value, min_amount, min_quantity, start_date, end_date, max_uses, current_uses, applies_to, target_product_id, is_active)
12. `invoices` (id, invoice_number, subscription_id, customer_id, period_start, period_end, subtotal, tax_amount, discount_amount, total_amount, amount_paid, status, issue_date, due_date, created_at)
13. `invoice_lines` (id, invoice_id, product_id, variant_id, description, quantity, unit_price, tax_amount, line_total)
14. `payments` (id, invoice_id, amount, payment_method, payment_date, reference, note, created_at)
15. `audit_logs` (id, event_type, description, user_id, metadata_json, created_at)

---

## 4. API Endpoints Contract
- **Auth**: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`, `GET /api/auth/me`
- **Users**: `GET /api/users/staff`, `POST /api/users/staff` (Admin only)
- **Products & Variants**: `GET /api/products`, `POST /api/products`, `POST /api/products/:id/variants`
- **Plans**: `GET /api/plans`, `POST /api/plans`, `PUT /api/plans/:id`
- **Taxes**: `GET /api/taxes`, `POST /api/taxes`
- **Discounts**: `GET /api/discounts`, `POST /api/discounts`, `POST /api/discounts/validate`
- **Templates**: `GET /api/templates`, `POST /api/templates`, `POST /api/templates/:id/convert-to-subscription`
- **Subscriptions**: `GET /api/subscriptions`, `POST /api/subscriptions`, `GET /api/subscriptions/:id`, `PATCH /api/subscriptions/:id/status`
- **Billing**: `POST /api/billing/run` (executes idempotent engine), `GET /api/billing/history`
- **Invoices**: `GET /api/invoices`, `GET /api/invoices/:id`, `PATCH /api/invoices/:id/status`, `POST /api/invoices/:id/send`, `GET /api/invoices/:id/print`
- **Payments**: `GET /api/payments`, `POST /api/payments`
- **Dashboard / Analytics**: `GET /api/analytics/summary`, `GET /api/analytics/overdue`, `GET /api/analytics/benchmark`
