import { Router, Request, Response } from 'express';
import { queryAll, queryOne } from '../db/database.js';
import { authenticate, requireRole, assertCanAccessCustomerData } from '../middleware/auth.js';
import { transitionSubscription, SubscriptionStatus } from '../services/stateMachine.js';
import { createSubscription, loadTemplate, renewSubscription } from '../services/subscriptionService.js';
import { buildSubscriptionTimeline } from '../services/timelineService.js';
import { handle, notFound, forbidden, badRequest } from '../lib/errors.js';
import { asBody, date, idParam, int, oneOf, pagination, str } from '../lib/validation.js';
import { todayIso } from '../lib/dates.js';

export const subscriptionRouter = Router();
subscriptionRouter.use(authenticate);

const STATUSES = ['Draft', 'Quotation', 'Confirmed', 'Active', 'Paused', 'Closed'] as const;

const SUB_SELECT = `
  SELECT s.id, s.subscription_number, s.customer_id, s.plan_id, s.status,
         s.start_date, s.expiry_date, s.next_billing_date, s.payment_terms,
         s.discount_rule_id, s.notes, s.quotation_valid_until, s.created_at, s.updated_at,
         u.full_name AS customer_name, u.email AS customer_email, u.company_name,
         p.name AS plan_name, p.billing_interval, p.price AS plan_price, p.can_pause, p.can_renew, p.auto_close, p.can_close_early,
         dr.code AS discount_code, dr.value AS discount_value, dr.discount_type
  FROM subscriptions s
  JOIN users u ON u.id = s.customer_id
  JOIN plans p ON p.id = s.plan_id
  LEFT JOIN discount_rules dr ON dr.id = s.discount_rule_id`;

/** Loads a subscription the caller may see; any other customer's id is indistinguishable from a missing one (404). */
function loadVisible(req: Request): { id: number; customer_id: number; [k: string]: any } {
  const id = idParam(req.params.id);
  const sub = queryOne<{ id: number; customer_id: number; [k: string]: any }>(`${SUB_SELECT} WHERE s.id = ?`, [id]);
  if (!sub) throw notFound();
  assertCanAccessCustomerData(req.user!, sub.customer_id);
  return sub;
}

subscriptionRouter.get('/', handle((req, res) => {
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (req.user!.role === 'customer') {
    // The customer filter is forced from the token; query parameters cannot widen it.
    where.push('s.customer_id = ?');
    params.push(req.user!.id);
  } else {
    if (req.query.customer_id) { where.push('s.customer_id = ?'); params.push(int({ v: req.query.customer_id }, 'v', { min: 1 })); }
    if (req.query.plan_id) { where.push('s.plan_id = ?'); params.push(int({ v: req.query.plan_id }, 'v', { min: 1 })); }
  }
  if (req.query.status) { where.push('s.status = ?'); params.push(oneOf({ status: req.query.status }, 'status', STATUSES)); }

  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const paged = req.query.page !== undefined || req.query.page_size !== undefined;
  let sql = `${SUB_SELECT}${clause} ORDER BY s.id DESC`;
  const extra: Record<string, unknown> = {};
  if (paged) {
    const { page, pageSize, offset } = pagination(req.query);
    sql += ' LIMIT ? OFFSET ?';
    const total = queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM subscriptions s${clause}`, params)!.n;
    extra.pagination = { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
    res.json({ success: true, subscriptions: queryAll(sql, [...params, pageSize, offset]), ...extra });
    return;
  }
  res.json({ success: true, subscriptions: queryAll(sql, params) });
}));

subscriptionRouter.get('/:id', handle((req, res) => {
  const sub = loadVisible(req);
  const lines = queryAll(
    `SELECT sl.*, p.name AS product_name, p.sales_price, pv.attribute_name, pv.option_name, pv.price_extra,
            tr.name AS tax_name, tr.rate_percentage AS tax_rate
     FROM subscription_lines sl
     JOIN products p ON p.id = sl.product_id
     LEFT JOIN product_variants pv ON pv.id = sl.variant_id
     LEFT JOIN tax_rules tr ON tr.id = sl.tax_id
     WHERE sl.subscription_id = ? ORDER BY sl.id`,
    [sub.id]
  );
  const invoices = queryAll(
    `SELECT id, invoice_number, period_start, period_end, total_amount, amount_paid, status, issue_date, due_date
     FROM invoices WHERE subscription_id = ? ORDER BY id DESC LIMIT 100`,
    [sub.id]
  );
  res.json({ success: true, subscription: { ...sub, lines, invoices } });
}));

subscriptionRouter.get('/:id/timeline', handle((req, res) => {
  const sub = loadVisible(req);
  res.json({ success: true, subscription_number: sub.subscription_number, timeline: buildSubscriptionTimeline(sub.id) });
}));

// Staff and admin create subscriptions. Always Draft; status only changes through the state machine.
subscriptionRouter.post('/', requireRole('admin', 'staff'), handle((req, res) => {
  const b = asBody(req.body);
  const templateId = b.template_id ? int(b, 'template_id', { min: 1 }) : null;
  const template = templateId ? loadTemplate(templateId) : null;

  const planId = template ? template.plan_id : int(b, 'plan_id', { required: true, min: 1 });
  const startDate = date(b, 'start_date') ?? todayIso();
  const customerId = int(b, 'customer_id', { required: true, min: 1 });

  const rawLines = Array.isArray(b.lines) && b.lines.length > 0
    ? (b.lines as Record<string, unknown>[]).map(l => {
        const lb = asBody(l);
        return {
          product_id: int(lb, 'product_id', { required: true, min: 1 }),
          variant_id: lb.variant_id ? int(lb, 'variant_id', { min: 1 }) : null,
          quantity: int(lb, 'quantity', { required: true, min: 1 }),
          tax_id: lb.tax_id ? int(lb, 'tax_id', { min: 1 }) : null
        };
      })
    : (template?.lines ?? []).map(l => ({ product_id: l.product_id, variant_id: l.variant_id, quantity: l.default_quantity, tax_id: null }));

  const created = createSubscription({
    customerId,
    planId,
    startDate,
    expiryDate: date(b, 'expiry_date'),
    paymentTerms: str(b, 'payment_terms', { max: 40 }) ?? 'Immediate Payment',
    discountRuleId: b.discount_rule_id ? int(b, 'discount_rule_id', { min: 1 }) : null,
    templateId,
    notes: str(b, 'notes', { max: 1000 }),
    lines: rawLines,
    actorUserId: req.user!.id
  });
  res.status(201).json({ success: true, subscription: created, message: 'Subscription created successfully' });
}));

// Customers may renew their own subscription where the plan allows it.
subscriptionRouter.post('/:id/renew', handle((req, res) => {
  const sub = loadVisible(req);
  const r = renewSubscription(sub.id, req.user!.id);
  res.json({ success: true, message: `Subscription ${r.subscriptionNumber} renewed successfully until ${r.newExpiry}`, newExpiry: r.newExpiry });
}));

subscriptionRouter.patch('/:id/status', handle((req, res) => {
  const sub = loadVisible(req);
  const status = oneOf(asBody(req.body), 'status', STATUSES) as SubscriptionStatus;

  if (req.user!.role === 'customer') {
    // Portal self-service: pause, resume (only from Paused) or close their own subscription.
    const allowed = status === 'Paused' || status === 'Closed' || (status === 'Active' && sub.status === 'Paused');
    if (!allowed) throw forbidden('Customers can only pause, resume or close their own subscriptions.');
  }

  const r = transitionSubscription(sub.id, status, req.user!.id);
  res.json({ success: true, message: r.message, previousStatus: r.previousStatus, newStatus: r.newStatus });
}));
