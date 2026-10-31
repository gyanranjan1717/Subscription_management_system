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

/** Admins can ask for archived rows too (`?include_inactive=true`) so they can be reactivated. */
const includeInactive = (req: { user?: { role: string }; query: Record<string, unknown> }) =>
  req.user?.role === 'admin' && req.query.include_inactive === 'true';

catalogRouter.get('/products', staffRead, handle((req, res) => {
  const isAdmin = req.user!.role === 'admin';
  const all = includeInactive(req);
  const products = queryAll<Record<string, any>>(`SELECT * FROM products ${all ? '' : 'WHERE is_active = 1'} ORDER BY name`);
  const variants = queryAll<Record<string, any>>(
    `SELECT * FROM product_variants ${all ? '' : 'WHERE product_id IN (SELECT id FROM products WHERE is_active = 1)'} ORDER BY id`
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

catalogRouter.get('/plans', staffRead, handle((req, res) => {
  res.json({ success: true, plans: queryAll(`SELECT * FROM plans ${includeInactive(req) ? '' : 'WHERE is_active = 1'} ORDER BY name`) });
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

catalogRouter.get('/discounts', staffRead, handle((req, res) => {
  const discounts = queryAll(
    `SELECT dr.*, p.name AS target_product_name
     FROM discount_rules dr LEFT JOIN products p ON p.id = dr.target_product_id
     ${includeInactive(req) ? '' : 'WHERE dr.is_active = 1'} ORDER BY dr.id DESC`
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

catalogRouter.get('/quotation-templates', staffRead, handle((req, res) => {
  const all = includeInactive(req);
  const templates = queryAll<Record<string, any>>(
    `SELECT qt.*, p.name AS plan_name, p.billing_interval, p.price AS plan_price
     FROM quotation_templates qt JOIN plans p ON p.id = qt.plan_id
     ${all ? '' : 'WHERE qt.is_active = 1'} ORDER BY qt.id DESC`
  );
  const lines = queryAll<Record<string, any>>(
    `SELECT qtl.*, p.name AS product_name, p.sales_price, pv.attribute_name, pv.option_name, pv.price_extra
     FROM quotation_template_lines qtl
     JOIN products p ON p.id = qtl.product_id
     LEFT JOIN product_variants pv ON pv.id = qtl.variant_id
     ${all ? '' : 'WHERE qtl.template_id IN (SELECT id FROM quotation_templates WHERE is_active = 1)'}`
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

// ---- Editing the catalog (admin) --------------------------------------------------------------
// Edits never rewrite history: a subscription line keeps the unit price it was created with, and an
// issued invoice keeps its amounts, so a price change only affects what is sold from now on.

type Sets = { sql: string[]; params: (string | number | null)[] };
const newSets = (): Sets => ({ sql: [], params: [] });
const setCol = (x: Sets, col: string, value: string | number | null) => { x.sql.push(`${col} = ?`); x.params.push(value); };
function applySets(table: string, id: number, x: Sets): void {
  if (x.sql.length === 0) throw badRequest('Nothing to update.');
  execute(`UPDATE ${table} SET ${x.sql.join(', ')} WHERE id = ?`, [...x.params, id]);
}

catalogRouter.patch('/products/:id', adminWrite, handle((req, res) => {
  const id = idParam(req.params.id);
  const b = asBody(req.body);
  if (!queryOne('SELECT id FROM products WHERE id = ?', [id])) throw notFound('Product not found.');
  const x = newSets();
  if (b.name !== undefined) setCol(x, 'name', reqStr(b, 'name', 160));
  if (b.type !== undefined) setCol(x, 'type', oneOf(b, 'type', PRODUCT_TYPES));
  if (b.sales_price !== undefined) setCol(x, 'sales_price', fromCents(money(b, 'sales_price', { required: true })));
  if (b.cost_price !== undefined) setCol(x, 'cost_price', fromCents(money(b, 'cost_price', { required: true })));
  if (b.notes !== undefined) setCol(x, 'notes', str(b, 'notes', { max: 1000 }));
  if (b.is_active !== undefined) setCol(x, 'is_active', bool(b, 'is_active', true) ? 1 : 0);
  runTransaction(() => {
    applySets('products', id, x);
    audit('PRODUCT_UPDATED', `Product ${id} updated`, req.user!.id, { productId: id, fields: Object.keys(b) });
  });
  res.json({ success: true, message: 'Product updated. Existing subscriptions and invoices keep their original prices.' });
}));

catalogRouter.patch('/variants/:id', adminWrite, handle((req, res) => {
  const id = idParam(req.params.id);
  const b = asBody(req.body);
  if (!queryOne('SELECT id FROM product_variants WHERE id = ?', [id])) throw notFound('Variant not found.');
  const x = newSets();
  if (b.attribute_name !== undefined) setCol(x, 'attribute_name', reqStr(b, 'attribute_name', 80));
  if (b.option_name !== undefined) setCol(x, 'option_name', reqStr(b, 'option_name', 80));
  if (b.price_extra !== undefined) setCol(x, 'price_extra', fromCents(money(b, 'price_extra')));
  try {
    runTransaction(() => {
      applySets('product_variants', id, x);
      audit('VARIANT_UPDATED', `Variant ${id} updated`, req.user!.id, { variantId: id, fields: Object.keys(b) });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('This variant already exists for the product.');
    throw err;
  }
  res.json({ success: true, message: 'Variant updated' });
}));

catalogRouter.patch('/plans/:id', adminWrite, handle((req, res) => {
  const id = idParam(req.params.id);
  const b = asBody(req.body);
  const current = queryOne<{ start_date: string | null; end_date: string | null }>('SELECT start_date, end_date FROM plans WHERE id = ?', [id]);
  if (!current) throw notFound('Plan not found.');
  if (b.billing_interval !== undefined) {
    throw badRequest('The billing interval cannot be changed. Create a new plan instead, so existing billing cycles stay intact.');
  }
  const x = newSets();
  if (b.name !== undefined) setCol(x, 'name', reqStr(b, 'name', 160));
  if (b.price !== undefined) setCol(x, 'price', fromCents(money(b, 'price', { required: true })));
  if (b.min_quantity !== undefined) setCol(x, 'min_quantity', int(b, 'min_quantity', { min: 1, max: 100000, required: true }));
  const start = b.start_date !== undefined ? date(b, 'start_date') : current.start_date;
  const end = b.end_date !== undefined ? date(b, 'end_date') : current.end_date;
  if (start && end && end < start) throw badRequest('end_date cannot be before start_date.');
  if (b.start_date !== undefined) setCol(x, 'start_date', start);
  if (b.end_date !== undefined) setCol(x, 'end_date', end);
  for (const flag of ['auto_close', 'can_close_early', 'can_pause', 'can_renew', 'is_active'] as const) {
    if (b[flag] !== undefined) setCol(x, flag, bool(b, flag, true) ? 1 : 0);
  }
  runTransaction(() => {
    applySets('plans', id, x);
    audit('PLAN_UPDATED', `Plan ${id} updated`, req.user!.id, { planId: id, fields: Object.keys(b) });
  });
  res.json({ success: true, message: 'Plan updated' });
}));

catalogRouter.patch('/discounts/:id', adminWrite, handle((req, res) => {
  const id = idParam(req.params.id);
  const b = asBody(req.body);
  const current = queryOne<{ discount_type: string; current_uses: number; start_date: string | null; end_date: string | null }>(
    'SELECT discount_type, current_uses, start_date, end_date FROM discount_rules WHERE id = ?', [id]
  );
  if (!current) throw notFound('Discount rule not found.');
  const x = newSets();
  if (b.description !== undefined) setCol(x, 'description', reqStr(b, 'description', 200));
  if (b.value !== undefined) {
    const v = money(b, 'value', { required: true, positive: true });
    if (current.discount_type === 'percentage' && v > 10000) throw badRequest('A percentage discount cannot exceed 100.');
    setCol(x, 'value', fromCents(v));
  }
  if (b.min_amount !== undefined) setCol(x, 'min_amount', fromCents(money(b, 'min_amount')));
  if (b.min_quantity !== undefined) setCol(x, 'min_quantity', int(b, 'min_quantity', { min: 0, required: true }));
  const start = b.start_date !== undefined ? date(b, 'start_date') : current.start_date;
  const end = b.end_date !== undefined ? date(b, 'end_date') : current.end_date;
  if (start && end && end < start) throw badRequest('end_date cannot be before start_date.');
  if (b.start_date !== undefined) setCol(x, 'start_date', start);
  if (b.end_date !== undefined) setCol(x, 'end_date', end);
  if (b.max_uses !== undefined) {
    const m = int(b, 'max_uses', { min: 0, required: true });
    if (m > 0 && m < current.current_uses) throw badRequest(`max_uses cannot be below the ${current.current_uses} uses already consumed.`);
    setCol(x, 'max_uses', m);
  }
  if (b.is_active !== undefined) setCol(x, 'is_active', bool(b, 'is_active', true) ? 1 : 0);
  runTransaction(() => {
    applySets('discount_rules', id, x);
    audit('DISCOUNT_UPDATED', `Discount rule ${id} updated`, req.user!.id, { discountId: id, fields: Object.keys(b) });
  });
  res.json({ success: true, message: 'Discount rule updated. Invoices already issued are unchanged.' });
}));

catalogRouter.patch('/quotation-templates/:id', adminWrite, handle((req, res) => {
  const id = idParam(req.params.id);
  const b = asBody(req.body);
  if (!queryOne('SELECT id FROM quotation_templates WHERE id = ?', [id])) throw notFound('Quotation template not found.');
  const x = newSets();
  if (b.name !== undefined) setCol(x, 'name', reqStr(b, 'name', 160));
  if (b.validity_days !== undefined) setCol(x, 'validity_days', int(b, 'validity_days', { min: 1, max: 3650, required: true }));
  if (b.notes !== undefined) setCol(x, 'notes', str(b, 'notes', { max: 1000 }));
  if (b.is_active !== undefined) setCol(x, 'is_active', bool(b, 'is_active', true) ? 1 : 0);
  runTransaction(() => {
    applySets('quotation_templates', id, x);
    audit('TEMPLATE_UPDATED', `Quotation template ${id} updated`, req.user!.id, { templateId: id, fields: Object.keys(b) });
  });
  res.json({ success: true, message: 'Quotation template updated' });
}));
