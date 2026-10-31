# Brightloop: Subscription Management and Recurring Billing

> **Odoo × Make-A-Ton 9.0 (Kochi) — Round 1 Submission**  
> Complete enterprise subscription lifecycle, idempotent recurring billing engine, strict tenant isolation, role-based access control, live Gmail SMTP delivery, and Razorpay online payments.

---

## 🌐 Live Production Deployment

**Live Web Application:** [https://subscription-management-system-ikd3.onrender.com/](https://subscription-management-system-ikd3.onrender.com/)  
**API Health Check:** [https://subscription-management-system-ikd3.onrender.com/api/health](https://subscription-management-system-ikd3.onrender.com/api/health)  

> [!NOTE]
> The single Render Web Service hosts both the Node.js Express backend and the compiled React production frontend distribution on one unified origin.

---

## 🔑 Evaluator & Judge Credentials

All accounts are pre-seeded in the deployment with 100% compliant passwords (> 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special character).

### 1. Administrator Accounts (Full System Control)
* **Master Password:** `Admin@Brightloop2026!`
* **Admin Master Registration Key:** `BrightloopAdminKey#2026` *(used if signing up as a new Admin)*

| Name | Role | Email | Capabilities |
|---|---|---|---|
| **Gyan Ranjan** | Lead Admin | `ranjangyan153@gmail.com` | Full platform control, staff creation, catalog/tax pricing, billing runs, analytics |
| **Alex Mercer** | Security Admin | `admin@brightloop.io` | Full platform control, audit logs, catalog & billing |

---

### 2. Staff Accounts (Day-to-day Operations & RBAC)
* **Master Password:** `Staff@Brightloop2026!`

| Name | Department | Email |
|---|---|---|
| **Sarah Jenkins** | Billing Ops Lead | `staff1@brightloop.io` |
| **David Kumar** | Sales & Quotations | `staff2@brightloop.io` |
| **Priya Nair** | Accounts Receivable | `staff3@brightloop.io` |
| **Michael Chen** | Customer Success | `staff4@brightloop.io` |
| **Elena Rostova** | Compliance & Audit | `staff5@brightloop.io` |

*Role-Based Access Control (RBAC): Staff can create quotations, activate subscriptions, run billing runs, record payments, and chase overdue invoices with email reminders. They CANNOT edit catalog pricing, view cost prices, or create/delete staff members.*

---

### 3. Customer Accounts (Strict Tenant-Isolated Portals)
* **Master Password:** `Customer@Brightloop2026!`

| Customer Name | Company | Email | Test Scenario Ready |
|---|---|---|---|
| **Gyan Ranjan** | Brightloop Technologies | `rgyan931@gmail.com` | **Active Sub + Ready-to-pay Invoice (`INV-2026-000001` - ₹2,666.80) with "Pay online" & "View/Print"** |
| **Robert Downey** | Acme Industrial Corp | `customer1@acme.com` | **Active Sub + Fully Settled Invoice (`INV-2026-000002` - Paid via Bank Transfer)** |
| **Emma Watson** | Apex Global Logistics | `customer2@apex.com` | **Confirmed Overdue Invoice (Test Staff 24h Payment Reminders)** |
| **Ananya Sharma** | CloudByte Systems | `customer3@cloudbyte.com` | **Paused Subscription (Test Customer Self-Service Resume)** |
| **Liam Neeson** | FinTech Prime Capital | `customer4@fintech.io` | **Weekly Agile Sprint Subscription** |
| **Dr. Aris Thorne** | HealthPlus Diagnostics | `customer5@healthplus.com` | Clean customer account for new proposals |
| **Sophia Loren** | Hyperion Aerospace | `customer6@hyperion.com` | Clean customer account for new proposals |
| **Marcus Vance** | Matrix Automation Labs | `customer7@matrixlab.com` | Clean customer account for new proposals |
| **Zoya Khan** | Quantum AI Systems | `customer8@quantum.io` | Clean customer account for new proposals |
| **Neil Armstrong** | Summit Media Networks | `customer9@summitcorp.com` | Clean customer account for new proposals |

---

## ⚡ 3-Minute Judge Evaluation Walkthrough

1. **Test Online Customer Payment & Receipt Print (1 min):**
   - Sign in as Customer: `rgyan931@gmail.com` / `Customer@Brightloop2026!`
   - On **"My account"**, look under **"My invoices"**: invoice `INV-2026-000001` is ready with an unpaid balance of **₹2,666.80**.
   - Click the green **"💳 Pay online"** button → opens the Razorpay checkout modal (supports full payment or custom partial amount).
   - Click **"View / Print"** → opens the official printable tax invoice receipt (`window.print()`).
   - Notice **Strict Tenant Isolation**: Customer cannot access any other customer's subscription or invoice (returns 404).

2. **Test Idempotent Billing Engine & Catch-up Run (1 min):**
   - Sign out and sign in as Admin (`ranjangyan153@gmail.com` / `Admin@Brightloop2026!`) or Staff (`staff1@brightloop.io` / `Staff@Brightloop2026!`).
   - Go to **Billing Run**:
     - Click **"Preview"** → shows due subscriptions and calculates exact totals without persisting anything (dry run).
     - Click **"Run billing"** → catches up every missed period, creates invoices, computes exact taxes and discounts.
     - Click **"Run billing" again** → creates **exactly 0 new invoices** (idempotency verified).
     - Check the **Integrity panel** → reports 0 duplicate periods and 0 missing periods.

3. **Test Lifecycle & Staff Overdue Reminders (1 min):**
   - In **Invoices**: notice overdue invoice `INV-2026-000003` for *Emma Watson*. Click **"Send Reminder"** → dispatches a reminder email via live SMTP with a 24-hour rate-limit lock.
   - In **Subscriptions**: view `SUB-2026-000002` (Quotation) → click **"Confirm"** → stepper moves to *Confirmed* → click **"Activate"** → moves to *Active*.
   - In **Catalog**: notice only Admins can edit prices and variants; staff cannot.

---

## 🛠️ Stack & Architecture

* **Backend:** Node.js 24 + TypeScript + Express (ESM & CJS compatibility).
* **Database:** SQLite with Write-Ahead Logging (`PRAGMA journal_mode = WAL`) using Node's native synchronous `node:sqlite` (`DatabaseSync`).
* **Security & Auth:** JWT (HS256) session verification, bcrypt password hashing, 2-step OTP email verification, single-use SHA-256 password reset tokens, and server-side RBAC guards.
* **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS design system with role-based navigation and responsive mobile support.
* **Integrations:**
  - **Razorpay:** Server-signed order generation, HMAC verification, gateway sync, and payment webhook receiver.
  - **Nodemailer SMTP:** Live Gmail inbox delivery with space-stripping and fallback audit simulation outbox.

---

## 🧪 Automated Test Suite (97 Tests Passing)

Run the backend test runner (Node 24 native test suite):

```bash
npm test
```

```
ℹ tests 97
ℹ suites 0
ℹ pass 97
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 4457.6
```

Coverage spans:
* **Billing Engine:** catch-up runs, idempotency, date-boundary clamping (Jan 31 → Feb 28), auto-close, leap years, period skips during pauses.
* **Money Maths:** exact integer cents parsing, HALF_UP rounding, float traps (3 × 33.33 @ 18%), zero-loss cent allocations.
* **Tenant Isolation:** customer reading own subscription (200) vs foreign subscription/invoice/action (404).
* **RBAC:** admin-only catalog writes, staff forbidden from modifying plans/discounts, customers restricted to portal.
* **Authentication:** 2-step registration with OTP, 5-guess lockout, Admin Master Key enforcement, single-use token resets.
* **Razorpay Gateway:** signature verification, amount tampering refusal, replay defense, idempotent settlements.
* **Performance Benchmark:** billing 3,000 subscriptions (9,000 invoices) in under 500 ms; list endpoints under 25 ms.

---

## 🚀 Local Development Setup

```bash
# 1. Install root, backend, and frontend dependencies
npm --prefix backend install
npm --prefix frontend install

# 2. Seed the comprehensive test dataset
node backend/scripts/populateSample.js

# 3. Start development servers (Backend :5000, Frontend :3000)
node run-dev.js
```

---

## 📊 Requirement Traceability Matrix (R01–R25)

| ID | Requirement | Implementation Details | Test File |
|---|---|---|---|
| **R01** | Customer Sign-up | 2-step registration with OTP verification & strength meter | `otp_registration.test.ts` |
| **R02** | Case-insensitive Email | Unique index `lower(email)` at database level (returns 409) | `api.test.ts` |
| **R03** | Password Complexity | > 8 chars, 1 uppercase, 1 lowercase, 1 special char | `api.test.ts` |
| **R04** | Password Reset Link | Single-use SHA-256 token, 30m expiry, live SMTP delivery | `api.test.ts` |
| **R05** | Three Roles & Portals | Admin, Staff, Customer with strict server-side RBAC | `api.test.ts` |
| **R06** | Admin-only Staff Mgmt | Only admins can add staff; initial password configured | `api.test.ts` |
| **R07** | Product Catalog & Notes | Sales price, cost price, service/software/addon types | `catalog_lists.test.ts` |
| **R08** | Product Variants | Price extra snapshotting (e.g. Odoo edition +₹560) | `catalog_lists.test.ts` |
| **R09** | Plan Cadence & Rules | Daily, Weekly, Monthly, Yearly intervals with min quantity | `catalog_lists.test.ts` |
| **R10** | Plan Lifecycle Flags | Can pause, can close early, can renew, auto-close rules | `api.test.ts` |
| **R11** | Quotation Templates | Template copy of plans, lines, and validity windows | `catalog_lists.test.ts` |
| **R12** | Subscription Sequence | Gap-free formatted numbers (`SUB-YYYY-XXXXXX`) | `api.test.ts` |
| **R13** | Subscription Stepper | Draft → Quotation → Confirmed → Active → Closed | `api.test.ts` |
| **R14** | Recurring Invoices | Automated invoice generation from active subscriptions | `billing.test.ts` |
| **R15** | Automated Tax Rules | Per-line tax snapshotting (default 18% GST, reduced 5%) | `billing.test.ts` |
| **R16** | Invoice Lifecycle | Draft → Confirmed → Paid; PDF/Print view & Send action | `catalog_lists.test.ts` |
| **R17** | Idempotent Billing | Unique period constraints; second run creates 0 invoices | `billing.test.ts` |
| **R18** | Discount Rules | Admin-created discount rules with validity windows | `api.test.ts` |
| **R19** | Discount Scoping | Scope to all products or target specific product line | `billing.test.ts` |
| **R20** | Usage-capped Discounts | Database-enforced `current_uses <= max_uses` | `billing.test.ts` |
| **R21** | Multi-method Payments | Bank Transfer, Cheque, Cash, UPI, Credit Card with exact balance | `api.test.ts` |
| **R22** | Overdue Chasing & Audit | Overdue invoice filter, 24h reminder cooldown, audit log | `admin_edit_reminders.test.ts` |
| **R23** | Finance Dashboard | Six-month invoiced vs collected trend, MRR, overdue metric | `catalog_lists.test.ts` |
| **R24** | Sub-2s Performance | Benchmark times < 70 ms for all critical queries | `performance.test.ts` |
| **R25** | Customer Self-Service | Pause, resume, renew, and online Razorpay payment checkout | `api.test.ts`, `razorpay.test.ts` |
