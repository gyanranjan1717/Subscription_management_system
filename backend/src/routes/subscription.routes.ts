import { Router, Request, Response } from 'express';
import { queryAll, queryOne, execute, runTransaction } from '../db/database.js';
import { authenticate } from '../middleware/auth.js';
import { transitionSubscription, SubscriptionStatus } from '../services/stateMachine.js';
import { computeNextDate } from '../services/billingEngine.js';
import { buildSubscriptionTimeline } from '../services/timelineService.js';

export const subscriptionRouter = Router();

// List Subscriptions (enforces customer isolation)
subscriptionRouter.get('/', authenticate, (req: Request, res: Response): void => {
  let sql = `
    SELECT 
      s.id, s.subscription_number, s.customer_id, s.plan_id, s.status,
      s.start_date, s.expiry_date, s.next_billing_date, s.payment_terms,
      s.discount_rule_id, s.notes, s.created_at, s.updated_at,
      u.full_name as customer_name, u.email as customer_email, u.company_name,
      p.name as plan_name, p.billing_interval, p.price as plan_price, p.can_pause, p.can_renew, p.auto_close,
      dr.code as discount_code, dr.value as discount_value, dr.discount_type
    FROM subscriptions s
    JOIN users u ON s.customer_id = u.id
    JOIN plans p ON s.plan_id = p.id
    LEFT JOIN discount_rules dr ON s.discount_rule_id = dr.id
  `;
  const params: any[] = [];

  // Strict customer isolation
  if (req.user!.role === 'customer') {
    sql += ' WHERE s.customer_id = ?';
    params.push(req.user!.id);
  } else {
    // Staff/Admin filters
    const conditions: string[] = [];
    if (req.query.status) {
      conditions.push('s.status = ?');
      params.push(req.query.status);
    }
    if (req.query.customer_id) {
      conditions.push('s.customer_id = ?');
      params.push(req.query.customer_id);
    }
    if (req.query.plan_id) {
      conditions.push('s.plan_id = ?');
      params.push(req.query.plan_id);
    }
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
  }

  sql += ' ORDER BY s.id DESC';

  const subscriptions = queryAll(sql, params);
  res.json({ success: true, subscriptions });
});

// Get Single Subscription Details with Lines
subscriptionRouter.get('/:id', authenticate, (req: Request, res: Response): void => {
  const subId = Number(req.params.id);
  const sub = queryOne(`
    SELECT 
      s.*,
      u.full_name as customer_name, u.email as customer_email, u.company_name, u.phone as customer_phone,
      p.name as plan_name, p.billing_interval, p.price as plan_price, p.can_pause, p.can_renew, p.auto_close,
      dr.code as discount_code, dr.value as discount_value, dr.discount_type
    FROM subscriptions s
    JOIN users u ON s.customer_id = u.id
    JOIN plans p ON s.plan_id = p.id
    LEFT JOIN discount_rules dr ON s.discount_rule_id = dr.id
    WHERE s.id = ?
  `, [subId]);

  if (!sub) {
    res.status(404).json({ success: false, error: 'Subscription not found' });
    return;
  }

  // Customer isolation check
  if (req.user!.role === 'customer' && sub.customer_id !== req.user!.id) {
    res.status(403).json({ success: false, error: 'Access denied. You do not own this subscription.' });
    return;
  }

  const lines = queryAll(`
    SELECT 
      sl.*,
      p.name as product_name, p.sales_price,
      pv.attribute_name, pv.option_name, pv.price_extra,
      tr.name as tax_name, tr.rate_percentage as tax_rate
    FROM subscription_lines sl
    JOIN products p ON sl.product_id = p.id
    LEFT JOIN product_variants pv ON sl.variant_id = pv.id
    LEFT JOIN tax_rules tr ON sl.tax_id = tr.id
    WHERE sl.subscription_id = ?
  `, [subId]);

  const invoices = queryAll(`
    SELECT id, invoice_number, period_start, period_end, total_amount, amount_paid, status, issue_date, due_date
    FROM invoices
    WHERE subscription_id = ?
    ORDER BY id DESC
  `, [subId]);

  res.json({
    success: true,
    subscription: {
      ...sub,
      lines,
      invoices
    }
  });
});

// Activity timeline: status changes, invoices and payments in chronological order
subscriptionRouter.get('/:id/timeline', authenticate, (req: Request, res: Response): void => {
  const subId = Number(req.params.id);
  const sub = queryOne<{ id: number; customer_id: number; subscription_number: string }>(
    'SELECT id, customer_id, subscription_number FROM subscriptions WHERE id = ?',
    [subId]
  );

  if (!sub) {
    res.status(404).json({ success: false, error: 'Subscription not found' });
    return;
  }

  // Customer isolation check
  if (req.user!.role === 'customer' && sub.customer_id !== req.user!.id) {
    res.status(403).json({ success: false, error: 'Access denied. You do not own this subscription.' });
    return;
  }

  res.json({
    success: true,
    subscription_number: sub.subscription_number,
    timeline: buildSubscriptionTimeline(subId)
  });
});

// Create Subscription (or convert from Quotation Template)
subscriptionRouter.post('/', authenticate, (req: Request, res: Response): void => {
  try {
    const {
      customer_id, plan_id, start_date, expiry_date, payment_terms,
      discount_rule_id, notes, template_id, lines, initial_status
    } = req.body;

    const targetCustomerId = req.user!.role === 'customer' ? req.user!.id : (customer_id || req.user!.id);
    const startDate = start_date || new Date().toISOString().split('T')[0];

    // Determine plan
    let effectivePlanId = plan_id;
    let templateLines: any[] = [];
    let calculatedExpiryDate = expiry_date || null;

    if (template_id) {
      const template = queryOne<{ id: number; plan_id: number; validity_days: number }>(
        'SELECT * FROM quotation_templates WHERE id = ?',
        [template_id]
      );
      if (!template) {
        res.status(400).json({ success: false, error: 'Quotation template not found' });
        return;
      }
      effectivePlanId = template.plan_id;
      templateLines = queryAll('SELECT * FROM quotation_template_lines WHERE template_id = ?', [template_id]);
      
      // Auto-compute expiry date based on template validity days
      if (!calculatedExpiryDate && template.validity_days) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + template.validity_days);
        calculatedExpiryDate = d.toISOString().split('T')[0];
      }
    }

    if (!effectivePlanId) {
      res.status(400).json({ success: false, error: 'Plan is required' });
      return;
    }

    const plan = queryOne<{ id: number; name: string; billing_interval: 'daily' | 'weekly' | 'monthly' | 'yearly'; min_quantity: number }>(
      'SELECT * FROM plans WHERE id = ?',
      [effectivePlanId]
    );

    if (!plan) {
      res.status(400).json({ success: false, error: 'Specified plan does not exist' });
      return;
    }

    // Process lines (custom lines or inherited from template)
    const inputLines = (Array.isArray(lines) && lines.length > 0) ? lines : templateLines;

    // Requirement R06: Enforce plan minimum quantity
    const totalOrderQty = inputLines.reduce((sum: number, item: any) => sum + (item.quantity || item.default_quantity || 1), 0);
    if (plan.min_quantity > 1 && totalOrderQty < plan.min_quantity) {
      res.status(400).json({
        success: false,
        error: `Plan '${plan.name}' requires a minimum quantity of ${plan.min_quantity} units. Your order has only ${totalOrderQty}.`
      });
      return;
    }

    const result = runTransaction(() => {
      // Generate subscription number: SUB-2026-XXXX
      const countRow = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM subscriptions');
      const subNumber = `SUB-${new Date().getFullYear()}-${String((countRow?.count || 0) + 1).padStart(5, '0')}`;
      const nextBillingDate = startDate;
      const status: SubscriptionStatus = initial_status || 'Draft';

      const ins = execute(`
        INSERT INTO subscriptions (
          subscription_number, customer_id, plan_id, status,
          start_date, expiry_date, next_billing_date, payment_terms,
          discount_rule_id, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        subNumber, targetCustomerId, effectivePlanId, status,
        startDate, calculatedExpiryDate, nextBillingDate, payment_terms || 'Immediate Payment',
        discount_rule_id || null, notes || null
      ]);

      const subId = Number(ins.lastInsertRowid);

      for (const item of inputLines) {
        const prod = queryOne<{ id: number; sales_price: number }>(
          'SELECT id, sales_price FROM products WHERE id = ?',
          [item.product_id]
        );
        if (!prod) continue;

        let unitPrice = prod.sales_price;
        if (item.variant_id) {
          const variant = queryOne<{ price_extra: number }>(
            'SELECT price_extra FROM product_variants WHERE id = ?',
            [item.variant_id]
          );
          if (variant) {
            unitPrice += variant.price_extra;
          }
        }

        const qty = item.quantity || item.default_quantity || 1;
        const lineAmount = unitPrice * qty;

        execute(`
          INSERT INTO subscription_lines (
            subscription_id, product_id, variant_id, quantity, unit_price, tax_id, line_amount
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          subId, item.product_id, item.variant_id || null, qty, unitPrice, item.tax_id || null, lineAmount
        ]);
      }

      return { id: subId, subscription_number: subNumber, expiry_date: calculatedExpiryDate };
    });

    res.status(201).json({
      success: true,
      subscription: result,
      message: 'Subscription created successfully'
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Self-Service Renew Subscription (Customer or Staff)
subscriptionRouter.post('/:id/renew', authenticate, (req: Request, res: Response): void => {
  const subId = Number(req.params.id);
  const sub = queryOne<{
    id: number;
    customer_id: number;
    plan_id: number;
    status: string;
    expiry_date: string | null;
    subscription_number: string;
    can_renew: number;
    billing_interval: 'daily' | 'weekly' | 'monthly' | 'yearly';
  }>(`
    SELECT s.id, s.customer_id, s.plan_id, s.status, s.expiry_date, s.subscription_number,
           p.can_renew, p.billing_interval
    FROM subscriptions s
    JOIN plans p ON s.plan_id = p.id
    WHERE s.id = ?
  `, [subId]);

  if (!sub) {
    res.status(404).json({ success: false, error: 'Subscription not found' });
    return;
  }

  if (req.user!.role === 'customer' && sub.customer_id !== req.user!.id) {
    res.status(403).json({ success: false, error: 'Access denied. You do not own this subscription.' });
    return;
  }

  if (sub.can_renew === 0) {
    res.status(400).json({ success: false, error: 'This plan policy does not permit renewals.' });
    return;
  }

  const baseDate = sub.expiry_date || new Date().toISOString().split('T')[0];
  const newExpiry = computeNextDate(baseDate, sub.billing_interval);

  execute(
    `UPDATE subscriptions SET expiry_date = ?, status = 'Active', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [newExpiry, subId]
  );

  execute(
    'INSERT INTO audit_logs (event_type, description, user_id, metadata_json) VALUES (?, ?, ?, ?)',
    [
      'SUBSCRIPTION_RENEWED',
      `Subscription ${sub.subscription_number} renewed until ${newExpiry}`,
      req.user!.id,
      JSON.stringify({ subscriptionId: subId, previousExpiry: sub.expiry_date, newExpiry })
    ]
  );

  res.json({
    success: true,
    message: `Subscription ${sub.subscription_number} renewed successfully until ${newExpiry}`,
    newExpiry
  });
});

// Update Subscription Status (State Machine transition)
subscriptionRouter.patch('/:id/status', authenticate, (req: Request, res: Response): void => {
  const subId = Number(req.params.id);
  const { status } = req.body;

  if (!status) {
    res.status(400).json({ success: false, error: 'New status is required' });
    return;
  }

  const sub = queryOne<{ customer_id: number }>('SELECT customer_id FROM subscriptions WHERE id = ?', [subId]);
  if (!sub) {
    res.status(404).json({ success: false, error: 'Subscription not found' });
    return;
  }

  // Customer can only close/cancel or request pause if permitted, cannot confirm/activate unilaterally
  if (req.user!.role === 'customer') {
    if (sub.customer_id !== req.user!.id) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }
    if (!['Closed', 'Paused'].includes(status)) {
      res.status(403).json({ success: false, error: 'Customers can only pause or close their own subscriptions.' });
      return;
    }
  }

  const result = transitionSubscription(subId, status, req.user!.id);
  if (!result.success) {
    res.status(400).json({ success: false, error: result.message });
    return;
  }

  res.json({ success: true, message: result.message, previousStatus: result.previousStatus, newStatus: status });
});
