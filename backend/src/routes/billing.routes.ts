import { Router, Request, Response } from 'express';
import { queryAll, queryOne, execute } from '../db/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { runBillingCycle } from '../services/billingEngine.js';
import { transitionInvoice, InvoiceStatus } from '../services/stateMachine.js';

export const billingRouter = Router();

// ============================================================================
// BILLING ENGINE EXECUTION
// ============================================================================

// Trigger billing cycle run (Admin & Staff)
billingRouter.post('/run', authenticate, requireRole('admin', 'staff'), (req: Request, res: Response): void => {
  try {
    const asOfDate = req.body.as_of_date || new Date().toISOString().split('T')[0];
    const result = runBillingCycle(asOfDate, req.user!.id);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// View billing run history from audit logs
billingRouter.get('/history', authenticate, requireRole('admin', 'staff'), (req: Request, res: Response): void => {
  const history = queryAll(`
    SELECT al.*, u.full_name as operator_name
    FROM audit_logs al
    LEFT JOIN users u ON al.user_id = u.id
    WHERE al.event_type = 'BILLING_RUN'
    ORDER BY al.id DESC
    LIMIT 50
  `);
  res.json({ success: true, history });
});

// ============================================================================
// INVOICES API
// ============================================================================

// List Invoices (with Customer Isolation & Filters)
billingRouter.get('/invoices', authenticate, (req: Request, res: Response): void => {
  let sql = `
    SELECT 
      i.id, i.invoice_number, i.subscription_id, i.customer_id,
      i.period_start, i.period_end, i.subtotal, i.tax_amount, i.discount_amount,
      i.total_amount, i.amount_paid, i.status, i.issue_date, i.due_date, i.created_at,
      u.full_name as customer_name, u.email as customer_email, u.company_name,
      s.subscription_number,
      CASE WHEN i.amount_paid < i.total_amount AND i.due_date < date('now') THEN 1 ELSE 0 END as is_overdue
    FROM invoices i
    JOIN users u ON i.customer_id = u.id
    JOIN subscriptions s ON i.subscription_id = s.id
  `;
  const params: any[] = [];

  if (req.user!.role === 'customer') {
    sql += ' WHERE i.customer_id = ?';
    params.push(req.user!.id);
  } else {
    const conditions: string[] = [];
    if (req.query.status) {
      conditions.push('i.status = ?');
      params.push(req.query.status);
    }
    if (req.query.customer_id) {
      conditions.push('i.customer_id = ?');
      params.push(req.query.customer_id);
    }
    if (req.query.overdue === 'true') {
      conditions.push("i.amount_paid < i.total_amount AND i.due_date < date('now') AND i.status != 'Cancelled'");
    }
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
  }

  sql += ' ORDER BY i.id DESC';

  const invoices = queryAll(sql, params);
  res.json({ success: true, invoices });
});

// Single Invoice Details
billingRouter.get('/invoices/:id', authenticate, (req: Request, res: Response): void => {
  const invId = Number(req.params.id);
  const invoice = queryOne(`
    SELECT 
      i.*,
      u.full_name as customer_name, u.email as customer_email, u.company_name, u.phone as customer_phone,
      s.subscription_number, s.payment_terms
    FROM invoices i
    JOIN users u ON i.customer_id = u.id
    JOIN subscriptions s ON i.subscription_id = s.id
    WHERE i.id = ?
  `, [invId]);

  if (!invoice) {
    res.status(404).json({ success: false, error: 'Invoice not found' });
    return;
  }

  if (req.user!.role === 'customer' && invoice.customer_id !== req.user!.id) {
    res.status(403).json({ success: false, error: 'Access denied. You do not own this invoice.' });
    return;
  }

  const lines = queryAll('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id ASC', [invId]);
  const payments = queryAll('SELECT * FROM payments WHERE invoice_id = ? ORDER BY id DESC', [invId]);

  res.json({
    success: true,
    invoice: {
      ...invoice,
      lines,
      payments
    }
  });
});

// Update Invoice Status (Confirm, Cancel)
billingRouter.patch('/invoices/:id/status', authenticate, requireRole('admin', 'staff'), (req: Request, res: Response): void => {
  const invId = Number(req.params.id);
  const { status } = req.body;

  if (!status) {
    res.status(400).json({ success: false, error: 'Status is required' });
    return;
  }

  const result = transitionInvoice(invId, status as InvoiceStatus, req.user!.id);
  if (!result.success) {
    res.status(400).json({ success: false, error: result.message });
    return;
  }

  res.json({ success: true, message: result.message });
});

// Send Invoice to Customer (Email dispatch simulation)
billingRouter.post('/invoices/:id/send', authenticate, requireRole('admin', 'staff'), (req: Request, res: Response): void => {
  const invId = Number(req.params.id);
  const invoice = queryOne<{ id: number; invoice_number: string; customer_id: number }>(
    'SELECT id, invoice_number, customer_id FROM invoices WHERE id = ?',
    [invId]
  );

  if (!invoice) {
    res.status(404).json({ success: false, error: 'Invoice not found' });
    return;
  }

  const customer = queryOne<{ email: string; full_name: string }>('SELECT email, full_name FROM users WHERE id = ?', [invoice.customer_id]);

  execute(
    'INSERT INTO audit_logs (event_type, description, user_id, metadata_json) VALUES (?, ?, ?, ?)',
    [
      'INVOICE_SENT',
      `Invoice #${invoice.invoice_number} dispatched to ${customer?.email}`,
      req.user!.id,
      JSON.stringify({ invoiceId: invId, invoiceNumber: invoice.invoice_number, recipient: customer?.email })
    ]
  );

  res.json({
    success: true,
    message: `Invoice #${invoice.invoice_number} successfully sent to ${customer?.email}`
  });
});
