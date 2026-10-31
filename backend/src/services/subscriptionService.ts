import { queryAll, queryOne, execute, runTransaction, nextSequence } from '../db/database.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { addDays, addMonthsClamped, BillingInterval, PAYMENT_TERMS_RE, todayIso } from '../lib/dates.js';
import { fromCents, toCents } from '../lib/money.js';
import { audit } from './audit.js';

export interface LineInput {
  product_id: number;
  variant_id?: number | null;
  quantity: number;
  tax_id?: number | null;
}

export interface CreateSubscriptionInput {
  customerId: number;
  planId: number;
  startDate: string;
  expiryDate: string | null;
  paymentTerms: string;
  discountRuleId: number | null;
  templateId: number | null;
  notes: string | null;
  lines: LineInput[];
  actorUserId: number;
}

/**
 * Unit price of a line = product sales price + variant extra, in cents. It is computed once, when
 * the line is created, and stored on the line; later product price changes never touch it.
 */
export function snapshotUnitPriceCents(productId: number, variantId: number | null | undefined): number {
  const product = queryOne<{ sales_price: number; is_active: number }>('SELECT sales_price, is_active FROM products WHERE id = ?', [productId]);
  if (!product || !product.is_active) throw badRequest(`Product ${productId} does not exist or is inactive.`);

  const variantCount = queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM product_variants WHERE product_id = ?', [productId])!.n;
  let extra = 0;
  if (variantId) {
    const v = queryOne<{ price_extra: number }>('SELECT price_extra FROM product_variants WHERE id = ? AND product_id = ?', [variantId, productId]);
    if (!v) throw badRequest(`Variant ${variantId} does not belong to product ${productId}.`);
    extra = toCents(v.price_extra);
  } else if (variantCount > 0) {
    throw badRequest(`Product ${productId} has variants; choose one.`);
  }
  return toCents(product.sales_price) + extra;
}

export function createSubscription(input: CreateSubscriptionInput): { id: number; subscription_number: string; expiry_date: string | null } {
  if (!PAYMENT_TERMS_RE.test(input.paymentTerms)) {
    throw badRequest("payment_terms must be 'Immediate Payment' or 'N Days Net' (e.g. '30 Days Net').");
  }
  if (input.expiryDate && input.expiryDate < input.startDate) throw badRequest('expiry_date cannot be before start_date.');
  if (input.lines.length === 0) throw badRequest('At least one subscription line is required.');

  const customer = queryOne<{ id: number }>("SELECT id FROM users WHERE id = ? AND role = 'customer' AND active = 1", [input.customerId]);
  if (!customer) throw badRequest('customer_id must refer to an existing customer.');

  const plan = queryOne<{ id: number; name: string; min_quantity: number; start_date: string | null; end_date: string | null; is_active: number }>(
    'SELECT id, name, min_quantity, start_date, end_date, is_active FROM plans WHERE id = ?', [input.planId]
  );
  if (!plan || !plan.is_active) throw badRequest('Specified plan does not exist or is inactive.');
  if (plan.start_date && input.startDate < plan.start_date) throw badRequest(`Plan '${plan.name}' is only available from ${plan.start_date}.`);
  if (plan.end_date && input.startDate > plan.end_date) throw badRequest(`Plan '${plan.name}' was only available until ${plan.end_date}.`);

  if (input.discountRuleId) {
    const d = queryOne('SELECT id FROM discount_rules WHERE id = ? AND is_active = 1', [input.discountRuleId]);
    if (!d) throw badRequest('discount_rule_id does not refer to an active discount rule.');
  }

  for (const l of input.lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1) throw badRequest('Line quantity must be a whole number of at least 1.');
    if (l.quantity < plan.min_quantity) {
      throw badRequest(`Plan '${plan.name}' requires a minimum quantity of ${plan.min_quantity} per line.`);
    }
    if (l.tax_id) {
      const t = queryOne('SELECT id FROM tax_rules WHERE id = ? AND is_active = 1', [l.tax_id]);
      if (!t) throw badRequest(`Tax rule ${l.tax_id} does not exist or is inactive.`);
    }
  }

  return runTransaction(() => {
    const number = `SUB-${input.startDate.slice(0, 4)}-${String(nextSequence('subscription')).padStart(6, '0')}`;
    const ins = execute(
      `INSERT INTO subscriptions (
         subscription_number, customer_id, plan_id, status, start_date, expiry_date,
         next_period_index, next_billing_date, payment_terms, discount_rule_id, template_id, notes
       ) VALUES (?, ?, ?, 'Draft', ?, ?, 0, ?, ?, ?, ?, ?)`,
      [number, input.customerId, input.planId, input.startDate, input.expiryDate, input.startDate,
       input.paymentTerms, input.discountRuleId, input.templateId, input.notes]
    );
    const subId = Number(ins.lastInsertRowid);

    for (const l of input.lines) {
      const unit = snapshotUnitPriceCents(l.product_id, l.variant_id);
      execute(
        `INSERT INTO subscription_lines (subscription_id, product_id, variant_id, quantity, unit_price, tax_id, line_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [subId, l.product_id, l.variant_id ?? null, l.quantity, fromCents(unit), l.tax_id ?? null, fromCents(unit * l.quantity)]
      );
    }
    audit('SUBSCRIPTION_CREATED', `Subscription ${number} created`, input.actorUserId, { subscriptionId: subId }, { subscriptionId: subId });
    return { id: subId, subscription_number: number, expiry_date: input.expiryDate };
  });
}

/** Template defaults: plan, lines and an expiry derived from the template's validity. */
export function loadTemplate(templateId: number) {
  const t = queryOne<{ id: number; plan_id: number; validity_days: number }>(
    'SELECT id, plan_id, validity_days FROM quotation_templates WHERE id = ? AND is_active = 1', [templateId]
  );
  if (!t) throw badRequest('Quotation template not found.');
  const lines = queryAll<{ product_id: number; variant_id: number | null; default_quantity: number }>(
    'SELECT product_id, variant_id, default_quantity FROM quotation_template_lines WHERE template_id = ?', [templateId]
  );
  return { ...t, lines };
}

/** Extends the expiry by one billing period of the plan (A9). Only live subscriptions can be renewed. */
export function renewSubscription(subscriptionId: number, actorUserId: number, today: string = todayIso()) {
  return runTransaction(() => {
    const sub = queryOne<{
      id: number; subscription_number: string; status: string; expiry_date: string | null;
      can_renew: number; billing_interval: BillingInterval;
    }>(
      `SELECT s.id, s.subscription_number, s.status, s.expiry_date, p.can_renew, p.billing_interval
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.id = ?`,
      [subscriptionId]
    );
    if (!sub) throw notFound('Subscription not found.');
    if (!sub.can_renew) throw conflict('This plan does not allow renewing.');
    if (sub.status !== 'Active' && sub.status !== 'Paused') {
      throw conflict(`A ${sub.status} subscription cannot be renewed.`);
    }
    const base = sub.expiry_date && sub.expiry_date > today ? sub.expiry_date : sub.expiry_date ?? today;
    const newExpiry =
      sub.billing_interval === 'daily' ? addDays(base, 1)
      : sub.billing_interval === 'weekly' ? addDays(base, 7)
      : sub.billing_interval === 'monthly' ? addMonthsClamped(base, 1)
      : addMonthsClamped(base, 12);

    execute('UPDATE subscriptions SET expiry_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newExpiry, sub.id]);
    audit(
      'SUBSCRIPTION_RENEWED',
      `Subscription ${sub.subscription_number} renewed until ${newExpiry}`,
      actorUserId,
      { subscriptionId: sub.id, previousExpiry: sub.expiry_date, newExpiry },
      { subscriptionId: sub.id }
    );
    return { subscriptionNumber: sub.subscription_number, newExpiry };
  });
}
