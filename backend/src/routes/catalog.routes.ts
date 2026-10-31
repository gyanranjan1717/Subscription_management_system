import { Router } from 'express';
import { queryAll, queryOne, execute, runTransaction } from '../db/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { badRequest, handle, isUniqueViolation, conflict, notFound } from '../lib/errors.js';
import { fromCents } from '../lib/money.js';
import { Body, asBody, bool, date, idParam, int, money, oneOf, percent, reqStr, str } from '../lib/validation.js';

export const catalogRouter = Router();
catalogRouter.use(authenticate);

// Catalog data is internal: customers never read it (and never see cost prices).
const staffRead = requireRole('admin', 'staff');
const adminWrite = requireRole('admin');

const PRODUCT_TYPES = ['service', 'software', 'addon', 'consumable'] as const;
const INTERVALS = ['daily', 'weekly', 'monthly', 'yearly'] as const;
const DISCOUNT_TYPES = ['fixed', 'percentage'] as const;
const DISCOUNT_SCOPES = ['all', 'product', 'subscription'] as const;

// ---- Products & variants ----------------------------------------------------------------------

catalogRouter.get('/products', staffRead, handle((req, res) => {
  const isAdmin = req.user!.role === 'admin';
  const products = queryAll<Record<string, any>>('SELECT * FROM products WHERE is_active = 1 ORDER BY name');
  const variants = queryAll<Record<string, any>>(
    'SELECT * FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE is_active = 1) ORDER BY id'
  );
  const byProduct = new Map<number, Record<string, any>[]>();
  for (const v of variants) {
    const list = byProduct.get(v.product_id) ?? [];
    list.push(v);
    byProduct.set(v.product_id, list);
  }
  res.json({
    success: true,
    products: products.map(({ cost_price, ...p }) => ({ ...p, ...(isAdmin ? { cost_price } : {}), variants: byProduct.get(p.id) ?? [] }))
  });
}));

function insertVariant(productId: number, v: Body): void {
  try {
    execute(
      'INSERT INTO product_variants (product_id, attribute_name, option_name, price_extra) VALUES (?, ?, ?, ?)',
      [productId, reqStr(v, 'attribute_name', 80), reqStr(v, 'option_name', 80), fromCents(money(v, 'price_extra'))]
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('This variant already exists for the product.');
    throw err;
  }
}

catalogRouter.post('/products', adminWrite, handle((req, res) => {
  const b = asBody(req.body);
  const name = reqStr(b, 'name', 160);
  const type = oneOf(b, 'type', PRODUCT_TYPES);
  const sales = money(b, 'sales_price', { required: true });
  const cost = money(b, 'cost_price', { required: true });
  const notes = str(b, 'notes', { max: 1000 });
  const variants = Array.isArray(b.variants) ? (b.variants as unknown[]).map(asBody) : [];

  const productId = runTransaction(() => {
    const ins = execute(
      'INSERT INTO products (name, type, sales_price, cost_price, notes) VALUES (?, ?, ?, ?, ?)',
      [name, type, fromCents(sales), fromCents(cost), notes]
    );
    const id = Number(ins.lastInsertRowid);
    for (const v of variants) insertVariant(id, v);
    return id;
  });
  res.status(201).json({ success: true, productId, message: 'Product created successfully' });
}));

catalogRouter.post('/products/:id/variants', adminWrite, handle((req, res) => {
  const productId = idParam(req.params.id);
  if (!queryOne('SELECT id FROM products WHERE id = ?', [productId])) throw notFound('Product not found.');
  insertVariant(productId, asBody(req.body));
  res.status(201).json({ success: true, message: 'Variant created successfully' });
}));

// ---- Plans ------------------------------------------------------------------------------------

catalogRouter.get('/plans', staffRead, handle((_req, res) => {
  res.json({ success: true, plans: queryAll('SELECT * FROM plans WHERE is_active = 1 ORDER BY name') });
}));

catalogRouter.post('/plans', adminWrite, handle((req, res) => {
  const b = asBody(req.body);
  const start = date(b, 'start_date');
  const end = date(b, 'end_date');
  if (start && end && end < start) throw badRequest('end_date cannot be before start_date.');

  const ins = execute(
    `INSERT INTO plans (name, billing_interval, price, min_quantity, start_date, end_date,
                        auto_close, can_close_early, can_pause, can_renew)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      reqStr(b, 'name', 160), oneOf(b, 'billing_interval', INTERVALS), fromCents(money(b, 'price', { required: true })),
      int(b, 'min_quantity', { min: 1, max: 100000, def: 1 }), start, end,
      bool(b, 'auto_close', false) ? 1 : 0, bool(b, 'can_close_early', true) ? 1 : 0,
      bool(b, 'can_pause', true) ? 1 : 0, bool(b, 'can_renew', true) ? 1 : 0
    ]
  );
  res.status(201).json({ success: true, planId: Number(ins.lastInsertRowid), message: 'Plan created successfully' });
}));

// ---- Tax rules --------------------------------------------------------------------------------

catalogRouter.get('/taxes', staffRead, handle((_req, res) => {
  res.json({ success: true, taxes: queryAll('SELECT * FROM tax_rules WHERE is_active = 1 ORDER BY id') });
}));

catalogRouter.post('/taxes', adminWrite, handle((req, res) => {
  const b = asBody(req.body);
  const name = reqStr(b, 'name', 120);
  const rate = percent(b, 'rate_percentage', { required: true });
  const isDefault = bool(b, 'is_default', false);
  runTransaction(() => {
    if (isDefault) execute('UPDATE tax_rules SET is_default = 0');
    execute('INSERT INTO tax_rules (name, rate_percentage, is_default) VALUES (?, ?, ?)', [name, rate, isDefault ? 1 : 0]);
  });
  res.status(201).json({ success: true, message: 'Tax rule created successfully' });
}));

// Editing a rate affects invoices created afterwards only: issued invoices keep the rate they were billed with.
catalogRouter.patch('/taxes/:id', adminWrite, handle((req, res) => {
  const id = idParam(req.params.id);
  const b = asBody(req.body);
  const current = queryOne<{ id: number }>('SELECT id FROM tax_rules WHERE id = ?', [id]);
  if (!current) throw notFound('Tax rule not found.');
  runTransaction(() => {
    if (b.name !== undefined) execute('UPDATE tax_rules SET name = ? WHERE id = ?', [reqStr(b, 'name', 120), id]);
    if (b.rate_percentage !== undefined) execute('UPDATE tax_rules SET rate_percentage = ? WHERE id = ?', [percent(b, 'rate_percentage', { required: true }), id]);
    if (b.is_active !== undefined) execute('UPDATE tax_rules SET is_active = ? WHERE id = ?', [bool(b, 'is_active', true) ? 1 : 0, id]);
    if (b.is_default !== undefined && bool(b, 'is_default', false)) {
      execute('UPDATE tax_rules SET is_default = 0');
      execute('UPDATE tax_rules SET is_default = 1 WHERE id = ?', [id]);
    }
    audit('TAX_RULE_UPDATED', `Tax rule ${id} updated`, req.user!.id, { taxId: id });
  });
  res.json({ success: true, message: 'Tax rule updated' });
}));

// ---- Discount rules (admin-only creation) -----------------------------------------------------

catalogRouter.get('/discounts', staffRead, handle((_req, res) => {
  const discounts = queryAll(
    `SELECT dr.*, p.name AS target_product_name
     FROM discount_rules dr LEFT JOIN products p ON p.id = dr.target_product_id
     WHERE dr.is_active = 1 ORDER BY dr.id DESC`
  );
  res.json({ success: true, discounts });
}));

catalogRouter.post('/discounts', adminWrite, handle((req, res) => {
  const b = asBody(req.body);
  const type = oneOf(b, 'discount_type', DISCOUNT_TYPES);
  const appliesTo = oneOf(b, 'applies_to', DISCOUNT_SCOPES, { def: 'all' });
  const valueCents = money(b, 'value', { required: true, positive: true });
  if (type === 'percentage' && valueCents > 10000) throw badRequest('A percentage discount cannot exceed 100.');
  const start = date(b, 'start_date');
  const end = date(b, 'end_date');
  if (start && end && end < start) throw badRequest('end_date cannot be before start_date.');
  const targetProductId = b.target_product_id ? int(b, 'target_product_id', { min: 1 }) : null;
  if (appliesTo === 'product') {
    if (!targetProductId) throw badRequest('target_product_id is required for product-scoped discounts.');
    if (!queryOne('SELECT id FROM products WHERE id = ?', [targetProductId])) throw badRequest('target_product_id does not exist.');
  }

  try {
    const ins = execute(
      `INSERT INTO discount_rules (code, description, discount_type, value, min_amount, min_quantity,
                                   start_date, end_date, max_uses, applies_to, target_product_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reqStr(b, 'code', 40).toUpperCase(), reqStr(b, 'description', 200), type, fromCents(valueCents),
        fromCents(money(b, 'min_amount')), int(b, 'min_quantity', { min: 0, def: 0 }), start, end,
        int(b, 'max_uses', { min: 0, def: 0 }), appliesTo, appliesTo === 'product' ? targetProductId : null, req.user!.id
      ]
    );
    audit('DISCOUNT_CREATED', 'Discount rule created', req.user!.id, { discountId: Number(ins.lastInsertRowid) });
    res.status(201).json({ success: true, discountId: Number(ins.lastInsertRowid), message: 'Discount rule created successfully' });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('A discount with this code already exists.');
    throw err;
  }
}));

// ---- Quotation templates ----------------------------------------------------------------------

catalogRouter.get('/quotation-templates', staffRead, handle((_req, res) => {
  const templates = queryAll<Record<string, any>>(
    `SELECT qt.*, p.name AS plan_name, p.billing_interval, p.price AS plan_price
     FROM quotation_templates qt JOIN plans p ON p.id = qt.plan_id
     WHERE qt.is_active = 1 ORDER BY qt.id DESC`
  );
  const lines = queryAll<Record<string, any>>(
    `SELECT qtl.*, p.name AS product_name, p.sales_price, pv.attribute_name, pv.option_name, pv.price_extra
     FROM quotation_template_lines qtl
     JOIN products p ON p.id = qtl.product_id
     LEFT JOIN product_variants pv ON pv.id = qtl.variant_id
     WHERE qtl.template_id IN (SELECT id FROM quotation_templates WHERE is_active = 1)`
  );
  const byTemplate = new Map<number, Record<string, any>[]>();
  for (const l of lines) {
    const list = byTemplate.get(l.template_id) ?? [];
    list.push(l);
    byTemplate.set(l.template_id, list);
  }
  res.json({ success: true, templates: templates.map(t => ({ ...t, lines: byTemplate.get(t.id) ?? [] })) });
}));

catalogRouter.post('/quotation-templates', adminWrite, handle((req, res) => {
  const b = asBody(req.body);
  const planId = int(b, 'plan_id', { required: true, min: 1 });
  if (!queryOne('SELECT id FROM plans WHERE id = ? AND is_active = 1', [planId])) throw badRequest('plan_id does not exist.');
  const lines = Array.isArray(b.lines) ? (b.lines as unknown[]).map(asBody) : [];

  const templateId = runTransaction(() => {
    const ins = execute(
      'INSERT INTO quotation_templates (name, plan_id, validity_days, notes) VALUES (?, ?, ?, ?)',
      [reqStr(b, 'name', 160), planId, int(b, 'validity_days', { min: 1, max: 3650, def: 30 }), str(b, 'notes', { max: 1000 })]
    );
    const id = Number(ins.lastInsertRowid);
    for (const l of lines) {
      const productId = int(l, 'product_id', { required: true, min: 1 });
      const variantId = l.variant_id ? int(l, 'variant_id', { min: 1 }) : null;
      if (!queryOne('SELECT id FROM products WHERE id = ? AND is_active = 1', [productId])) throw badRequest(`Product ${productId} does not exist.`);
      if (variantId && !queryOne('SELECT id FROM product_variants WHERE id = ? AND product_id = ?', [variantId, productId])) {
        throw badRequest(`Variant ${variantId} does not belong to product ${productId}.`);
      }
      execute(
        'INSERT INTO quotation_template_lines (template_id, product_id, variant_id, default_quantity) VALUES (?, ?, ?, ?)',
        [id, productId, variantId, int(l, 'default_quantity', { min: 1, def: 1 })]
      );
    }
    return id;
  });
  res.status(201).json({ success: true, templateId, message: 'Quotation template created successfully' });
}));
