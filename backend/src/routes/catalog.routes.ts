import { Router, Request, Response } from 'express';
import { queryAll, queryOne, execute, runTransaction } from '../db/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';

export const catalogRouter = Router();

// ============================================================================
// PRODUCTS & VARIANTS
// ============================================================================

catalogRouter.get('/products', authenticate, (req: Request, res: Response): void => {
  const products = queryAll(`
    SELECT * FROM products WHERE is_active = 1 ORDER BY name ASC
  `);

  const variants = queryAll(`
    SELECT * FROM product_variants ORDER BY id ASC
  `);

  const productsWithVariants = products.map(p => ({
    ...p,
    variants: variants.filter(v => v.product_id === p.id)
  }));

  res.json({ success: true, products: productsWithVariants });
});

catalogRouter.post('/products', authenticate, requireRole('admin'), (req: Request, res: Response): void => {
  try {
    const { name, type, sales_price, cost_price, notes, variants } = req.body;
    if (!name || !type || sales_price === undefined || cost_price === undefined) {
      res.status(400).json({ success: false, error: 'Name, type, sales_price, and cost_price are required.' });
      return;
    }

    const result = runTransaction(() => {
      const ins = execute(`
        INSERT INTO products (name, type, sales_price, cost_price, notes)
        VALUES (?, ?, ?, ?, ?)
      `, [name, type, sales_price, cost_price, notes || null]);

      const productId = Number(ins.lastInsertRowid);

      if (Array.isArray(variants)) {
        for (const v of variants) {
          if (v.attribute_name && v.option_name) {
            execute(`
              INSERT INTO product_variants (product_id, attribute_name, option_name, price_extra)
              VALUES (?, ?, ?, ?)
            `, [productId, v.attribute_name, v.option_name, v.price_extra || 0]);
          }
        }
      }
      return productId;
    });

    res.status(201).json({ success: true, productId: result, message: 'Product created successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// PLANS
// ============================================================================

catalogRouter.get('/plans', authenticate, (req: Request, res: Response): void => {
  const plans = queryAll('SELECT * FROM plans WHERE is_active = 1 ORDER BY name ASC');
  res.json({ success: true, plans });
});

catalogRouter.post('/plans', authenticate, requireRole('admin'), (req: Request, res: Response): void => {
  try {
    const { name, billing_interval, price, min_quantity, start_date, end_date, auto_close, can_pause, can_renew } = req.body;
    if (!name || !billing_interval || price === undefined) {
      res.status(400).json({ success: false, error: 'Name, billing_interval, and price are required.' });
      return;
    }

    const ins = execute(`
      INSERT INTO plans (
        name, billing_interval, price, min_quantity, start_date, end_date,
        auto_close, can_pause, can_renew
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      name, billing_interval, price, min_quantity || 1, start_date || null, end_date || null,
      auto_close ? 1 : 0, can_pause !== undefined ? (can_pause ? 1 : 0) : 1, can_renew !== undefined ? (can_renew ? 1 : 0) : 1
    ]);

    res.status(201).json({ success: true, planId: Number(ins.lastInsertRowid), message: 'Plan created successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// TAX RULES
// ============================================================================

catalogRouter.get('/taxes', authenticate, (req: Request, res: Response): void => {
  const taxes = queryAll('SELECT * FROM tax_rules WHERE is_active = 1 ORDER BY id ASC');
  res.json({ success: true, taxes });
});

catalogRouter.post('/taxes', authenticate, requireRole('admin'), (req: Request, res: Response): void => {
  try {
    const { name, rate_percentage, is_default } = req.body;
    if (!name || rate_percentage === undefined) {
      res.status(400).json({ success: false, error: 'Name and rate_percentage are required.' });
      return;
    }

    runTransaction(() => {
      if (is_default) {
        execute('UPDATE tax_rules SET is_default = 0');
      }
      execute(`
        INSERT INTO tax_rules (name, rate_percentage, is_default)
        VALUES (?, ?, ?)
      `, [name, rate_percentage, is_default ? 1 : 0]);
    });

    res.status(201).json({ success: true, message: 'Tax rule created successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// DISCOUNT RULES (Admin-only creation)
// ============================================================================

catalogRouter.get('/discounts', authenticate, (req: Request, res: Response): void => {
  const discounts = queryAll(`
    SELECT dr.*, p.name as target_product_name
    FROM discount_rules dr
    LEFT JOIN products p ON dr.target_product_id = p.id
    WHERE dr.is_active = 1
    ORDER BY dr.id DESC
  `);
  res.json({ success: true, discounts });
});

catalogRouter.post('/discounts', authenticate, requireRole('admin'), (req: Request, res: Response): void => {
  try {
    const {
      code, description, discount_type, value, min_amount, min_quantity,
      start_date, end_date, max_uses, applies_to, target_product_id
    } = req.body;

    if (!code || !description || !discount_type || value === undefined) {
      res.status(400).json({ success: false, error: 'Code, description, discount_type, and value are required.' });
      return;
    }

    const ins = execute(`
      INSERT INTO discount_rules (
        code, description, discount_type, value, min_amount, min_quantity,
        start_date, end_date, max_uses, current_uses, applies_to, target_product_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `, [
      code.toUpperCase().trim(), description, discount_type, value,
      min_amount || 0, min_quantity || 0, start_date || null, end_date || null,
      max_uses || 0, applies_to || 'all', target_product_id || null
    ]);

    res.status(201).json({
      success: true,
      discountId: Number(ins.lastInsertRowid),
      message: 'Discount rule created successfully'
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// QUOTATION TEMPLATES
// ============================================================================

catalogRouter.get('/quotation-templates', authenticate, (req: Request, res: Response): void => {
  const templates = queryAll(`
    SELECT qt.*, p.name as plan_name, p.billing_interval, p.price as plan_price
    FROM quotation_templates qt
    JOIN plans p ON qt.plan_id = p.id
    WHERE qt.is_active = 1
    ORDER BY qt.id DESC
  `);

  const lines = queryAll(`
    SELECT 
      qtl.*, p.name as product_name, p.sales_price,
      pv.attribute_name, pv.option_name, pv.price_extra
    FROM quotation_template_lines qtl
    JOIN products p ON qtl.product_id = p.id
    LEFT JOIN product_variants pv ON qtl.variant_id = pv.id
  `);

  const enriched = templates.map(t => ({
    ...t,
    lines: lines.filter(l => l.template_id === t.id)
  }));

  res.json({ success: true, templates: enriched });
});

catalogRouter.post('/quotation-templates', authenticate, requireRole('admin', 'staff'), (req: Request, res: Response): void => {
  try {
    const { name, plan_id, validity_days, notes, lines } = req.body;
    if (!name || !plan_id) {
      res.status(400).json({ success: false, error: 'Template name and plan_id are required.' });
      return;
    }

    const templateId = runTransaction(() => {
      const ins = execute(`
        INSERT INTO quotation_templates (name, plan_id, validity_days, notes)
        VALUES (?, ?, ?, ?)
      `, [name, plan_id, validity_days || 30, notes || null]);

      const tId = Number(ins.lastInsertRowid);

      if (Array.isArray(lines)) {
        for (const line of lines) {
          execute(`
            INSERT INTO quotation_template_lines (template_id, product_id, variant_id, default_quantity)
            VALUES (?, ?, ?, ?)
          `, [tId, line.product_id, line.variant_id || null, line.default_quantity || 1]);
        }
      }
      return tId;
    });

    res.status(201).json({ success: true, templateId, message: 'Quotation template created successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
