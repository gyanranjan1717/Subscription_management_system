-- ============================================================================
-- Brightloop Software - Relational Schema (SQLite, WAL, foreign keys ON)
-- Money columns hold exact 2-decimal values (CHECK ROUND(x,2)=x). All arithmetic is done in
-- integer cents in the application layer (see src/lib/money.ts) and only the result is stored.
-- ============================================================================

-- Users & authentication (admin, staff, customer)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL CHECK(length(email) <= 254),
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'staff', 'customer')),
    phone TEXT,
    company_name TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- Case-insensitive uniqueness is enforced by the database, not only by application code.
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email_lower ON users(lower(email));
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Password resets: only the SHA-256 hash of the token is stored; single use; short expiry.
CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    used INTEGER NOT NULL DEFAULT 0 CHECK(used IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

-- Every outgoing email (reset links, invoices) is stored here; this is the dev mailbox.
CREATE TABLE IF NOT EXISTS email_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('RESET', 'INVOICE', 'REMINDER', 'OTP')),
    related_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Gap-free named counters (invoice numbers, subscription numbers)
-- Registration and verification one-time passwords (OTP)
CREATE TABLE IF NOT EXISTS email_otps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    otp_code TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    used INTEGER NOT NULL DEFAULT 0 CHECK(used IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_email_otps_lookup ON email_otps(lower(email), otp_code, used);

CREATE TABLE IF NOT EXISTS sequences (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL
);

-- Tax rules master
CREATE TABLE IF NOT EXISTS tax_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    rate_percentage REAL NOT NULL CHECK(rate_percentage >= 0 AND rate_percentage <= 100),
    is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Products master
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('service', 'software', 'addon', 'consumable')),
    sales_price REAL NOT NULL CHECK(sales_price >= 0 AND ROUND(sales_price, 2) = sales_price),
    cost_price REAL NOT NULL CHECK(cost_price >= 0 AND ROUND(cost_price, 2) = cost_price),
    notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Product variants (e.g. Brand: Odoo +560)
CREATE TABLE IF NOT EXISTS product_variants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    attribute_name TEXT NOT NULL,
    option_name TEXT NOT NULL,
    price_extra REAL NOT NULL DEFAULT 0 CHECK(price_extra >= 0 AND ROUND(price_extra, 2) = price_extra),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(product_id, attribute_name, option_name)
);

-- Subscription plans master
CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    billing_interval TEXT NOT NULL CHECK(billing_interval IN ('daily', 'weekly', 'monthly', 'yearly')),
    price REAL NOT NULL CHECK(price >= 0 AND ROUND(price, 2) = price),
    min_quantity INTEGER NOT NULL DEFAULT 1 CHECK(min_quantity >= 1),
    start_date DATE,
    end_date DATE,
    auto_close INTEGER NOT NULL DEFAULT 0 CHECK(auto_close IN (0, 1)),
    can_close_early INTEGER NOT NULL DEFAULT 1 CHECK(can_close_early IN (0, 1)),
    can_pause INTEGER NOT NULL DEFAULT 1 CHECK(can_pause IN (0, 1)),
    can_renew INTEGER NOT NULL DEFAULT 1 CHECK(can_renew IN (0, 1)),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK(start_date IS NULL OR end_date IS NULL OR end_date >= start_date)
);

-- Quotation templates
CREATE TABLE IF NOT EXISTS quotation_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
    validity_days INTEGER NOT NULL DEFAULT 30 CHECK(validity_days >= 1),
    notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_qt_plan ON quotation_templates(plan_id);

CREATE TABLE IF NOT EXISTS quotation_template_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL REFERENCES quotation_templates(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id INTEGER REFERENCES product_variants(id) ON DELETE SET NULL,
    default_quantity INTEGER NOT NULL DEFAULT 1 CHECK(default_quantity >= 1)
);
CREATE INDEX IF NOT EXISTS idx_qtl_template ON quotation_template_lines(template_id);

-- Discount rules (admin-created)
CREATE TABLE IF NOT EXISTS discount_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    discount_type TEXT NOT NULL CHECK(discount_type IN ('fixed', 'percentage')),
    value REAL NOT NULL CHECK(value > 0 AND ROUND(value, 2) = value),
    min_amount REAL NOT NULL DEFAULT 0 CHECK(min_amount >= 0),
    min_quantity INTEGER NOT NULL DEFAULT 0 CHECK(min_quantity >= 0),
    start_date DATE,
    end_date DATE,
    max_uses INTEGER NOT NULL DEFAULT 0 CHECK(max_uses >= 0),
    current_uses INTEGER NOT NULL DEFAULT 0 CHECK(current_uses >= 0),
    applies_to TEXT NOT NULL CHECK(applies_to IN ('all', 'product', 'subscription')),
    target_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK(discount_type = 'fixed' OR value <= 100),
    CHECK(applies_to != 'product' OR target_product_id IS NOT NULL),
    CHECK(start_date IS NULL OR end_date IS NULL OR end_date >= start_date),
    -- The usage cap is enforced by the database: no race can push current_uses past max_uses.
    CHECK(max_uses = 0 OR current_uses <= max_uses)
);

-- Subscriptions. (next_period_index, next_billing_date) is the billing cursor.
CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_number TEXT NOT NULL UNIQUE,
    customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK(status IN ('Draft', 'Quotation', 'Confirmed', 'Active', 'Paused', 'Closed')),
    start_date DATE NOT NULL,
    expiry_date DATE,
    next_period_index INTEGER NOT NULL DEFAULT 0 CHECK(next_period_index >= 0),
    next_billing_date DATE NOT NULL,
    payment_terms TEXT NOT NULL DEFAULT 'Immediate Payment',
    discount_rule_id INTEGER REFERENCES discount_rules(id) ON DELETE SET NULL,
    template_id INTEGER REFERENCES quotation_templates(id) ON DELETE SET NULL,
    quotation_sent_on DATE,
    quotation_valid_until DATE,
    closed_on DATE,
    close_reason TEXT CHECK(close_reason IS NULL OR close_reason IN ('EARLY', 'EXPIRED', 'DISCARDED')),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CHECK(expiry_date IS NULL OR expiry_date >= start_date)
);

CREATE TABLE IF NOT EXISTS subscription_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id INTEGER REFERENCES product_variants(id) ON DELETE SET NULL,
    quantity INTEGER NOT NULL CHECK(quantity >= 1),
    -- Copied from product price + variant extra when the line is created; never recomputed.
    unit_price REAL NOT NULL CHECK(unit_price >= 0 AND ROUND(unit_price, 2) = unit_price),
    tax_id INTEGER REFERENCES tax_rules(id) ON DELETE RESTRICT,
    line_amount REAL NOT NULL CHECK(line_amount >= 0 AND ROUND(line_amount, 2) = line_amount)
);

-- Pause windows and the periods that were deliberately not billed because of them.
CREATE TABLE IF NOT EXISTS subscription_pauses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    paused_on DATE NOT NULL,
    resumed_on DATE
);
CREATE INDEX IF NOT EXISTS idx_pauses_sub ON subscription_pauses(subscription_id);

CREATE TABLE IF NOT EXISTS subscription_period_skips (
    subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    period_index INTEGER NOT NULL,
    reason TEXT NOT NULL,
    PRIMARY KEY (subscription_id, period_index)
);

-- Invoices
CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT NOT NULL UNIQUE,
    subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    period_index INTEGER NOT NULL CHECK(period_index >= 0),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    subtotal REAL NOT NULL DEFAULT 0 CHECK(ROUND(subtotal, 2) = subtotal),
    tax_amount REAL NOT NULL DEFAULT 0 CHECK(ROUND(tax_amount, 2) = tax_amount),
    discount_amount REAL NOT NULL DEFAULT 0 CHECK(discount_amount >= 0 AND ROUND(discount_amount, 2) = discount_amount),
    total_amount REAL NOT NULL DEFAULT 0 CHECK(total_amount >= 0 AND ROUND(total_amount, 2) = total_amount),
    amount_paid REAL NOT NULL DEFAULT 0 CHECK(amount_paid >= 0 AND ROUND(amount_paid, 2) = amount_paid),
    status TEXT NOT NULL CHECK(status IN ('Draft', 'Confirmed', 'Paid', 'Cancelled')),
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- "Never bill twice" is a database guarantee, not just an application check.
    UNIQUE(subscription_id, period_start),
    UNIQUE(subscription_id, period_index),
    CHECK(period_end > period_start),
    CHECK(due_date >= issue_date),
    CHECK(amount_paid <= total_amount),
    -- Footing: total = subtotal - discount + tax (to the cent)
    CHECK(ABS(total_amount - (subtotal - discount_amount + tax_amount)) < 0.005)
);

CREATE TABLE IF NOT EXISTS invoice_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'PRODUCT' CHECK(kind IN ('PLAN_FEE', 'PRODUCT')),
    product_id INTEGER REFERENCES products(id),
    variant_id INTEGER REFERENCES product_variants(id),
    description TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity >= 1),
    unit_price REAL NOT NULL CHECK(unit_price >= 0),
    gross_amount REAL NOT NULL DEFAULT 0,
    discount_amount REAL NOT NULL DEFAULT 0 CHECK(discount_amount >= 0),
    net_amount REAL NOT NULL DEFAULT 0,
    tax_name TEXT,
    tax_rate REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    line_total REAL NOT NULL CHECK(line_total >= 0)
);

-- Which discount rule produced which discount on which invoice (usage record / audit).
CREATE TABLE IF NOT EXISTS invoice_discounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    discount_rule_id INTEGER REFERENCES discount_rules(id) ON DELETE SET NULL,
    code TEXT NOT NULL,
    applies_to TEXT NOT NULL,
    amount REAL NOT NULL CHECK(amount >= 0),
    UNIQUE(invoice_id, discount_rule_id)
);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    amount REAL NOT NULL CHECK(amount > 0 AND ROUND(amount, 2) = amount),
    payment_method TEXT NOT NULL CHECK(payment_method IN ('Bank Transfer', 'Credit Card', 'UPI', 'Cash', 'Cheque')),
    payment_date DATE NOT NULL,
    reference TEXT,
    note TEXT,
    recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    description TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    subscription_id INTEGER,
    invoice_id INTEGER,
    metadata_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- Indexes: each one backs a filter, join or ORDER BY used by an endpoint.
-- ---------------------------------------------------------------------------
-- subscription lists (customer portal, staff filters), billing-run due lookup
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan ON subscriptions(plan_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status_billing ON subscriptions(status, next_billing_date);
CREATE INDEX IF NOT EXISTS idx_subscription_lines_sub ON subscription_lines(subscription_id);
-- invoice lists / dashboard / overdue chase
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id, id);
CREATE INDEX IF NOT EXISTS idx_invoices_status_due ON invoices(status, due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);
-- payments by invoice and by date (revenue-by-period filter)
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);
-- discount usage lookups
CREATE INDEX IF NOT EXISTS idx_invoice_discounts_rule ON invoice_discounts(discount_rule_id);
-- timeline / audit lookups
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_logs(event_type, id);
CREATE INDEX IF NOT EXISTS idx_audit_subscription ON audit_logs(subscription_id) WHERE subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_invoice ON audit_logs(invoice_id) WHERE invoice_id IS NOT NULL;
