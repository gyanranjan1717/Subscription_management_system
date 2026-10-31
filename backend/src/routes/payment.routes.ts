import { Router, Request, Response } from 'express';
import { queryAll, queryOne, execute, runTransaction } from '../db/database.js';
import { authenticate, requireRole } from '../middleware/auth.js';

export const paymentRouter = Router();

// Record Payment against an invoice (Staff & Admin)
paymentRouter.post('/', authenticate, requireRole('admin', 'staff'), (req: Request, res: Response): void => {
  try {
    const { invoice_id, amount, payment_method, payment_date, reference, note } = req.body;

    if (!invoice_id || !amount || !payment_method) {
      res.status(400).json({ success: false, error: 'Invoice ID, amount, and payment method are required.' });
      return;
    }

    const payAmount = Number(amount);
    if (isNaN(payAmount) || payAmount <= 0) {
      res.status(400).json({ success: false, error: 'Payment amount must be greater than zero.' });
      return;
    }

    const invoice = queryOne<{ id: number; invoice_number: string; total_amount: number; amount_paid: number; status: string }>(
      'SELECT id, invoice_number, total_amount, amount_paid, status FROM invoices WHERE id = ?',
      [invoice_id]
    );

    if (!invoice) {
      res.status(404).json({ success: false, error: 'Invoice not found.' });
      return;
    }

    if (invoice.status === 'Cancelled') {
      res.status(400).json({ success: false, error: 'Cannot record payment on a cancelled invoice.' });
      return;
    }

    const paymentDate = payment_date || new Date().toISOString().split('T')[0];

    const result = runTransaction(() => {
      const ins = execute(`
        INSERT INTO payments (invoice_id, amount, payment_method, payment_date, reference, note)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [invoice_id, payAmount, payment_method, paymentDate, reference || null, note || null]);

      const newAmountPaid = Number((invoice.amount_paid + payAmount).toFixed(2));
      const isFullyPaid = newAmountPaid >= invoice.total_amount;
      const newStatus = isFullyPaid ? 'Paid' : invoice.status;

      execute(
        'UPDATE invoices SET amount_paid = ?, status = ? WHERE id = ?',
        [newAmountPaid, newStatus, invoice_id]
      );

      execute(
        'INSERT INTO audit_logs (event_type, description, user_id, metadata_json) VALUES (?, ?, ?, ?)',
        [
          'PAYMENT_RECORDED',
          `Payment of $${payAmount} via ${payment_method} recorded on invoice #${invoice.invoice_number}`,
          req.user!.id,
          JSON.stringify({ invoiceId: invoice_id, amount: payAmount, paymentMethod: payment_method, newStatus })
        ]
      );

      return {
        paymentId: Number(ins.lastInsertRowid),
        invoiceNumber: invoice.invoice_number,
        totalAmount: invoice.total_amount,
        amountPaid: newAmountPaid,
        balanceRemaining: Math.max(0, Number((invoice.total_amount - newAmountPaid).toFixed(2))),
        status: newStatus
      };
    });

    res.status(201).json({
      success: true,
      message: 'Payment recorded successfully',
      payment: result
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List Payments (with customer isolation)
paymentRouter.get('/', authenticate, (req: Request, res: Response): void => {
  let sql = `
    SELECT 
      p.id, p.invoice_id, p.amount, p.payment_method, p.payment_date, p.reference, p.note, p.created_at,
      i.invoice_number, i.total_amount as invoice_total,
      u.full_name as customer_name, u.email as customer_email
    FROM payments p
    JOIN invoices i ON p.invoice_id = i.id
    JOIN users u ON i.customer_id = u.id
  `;
  const params: any[] = [];

  if (req.user!.role === 'customer') {
    sql += ' WHERE i.customer_id = ?';
    params.push(req.user!.id);
  } else if (req.query.invoice_id) {
    sql += ' WHERE p.invoice_id = ?';
    params.push(req.query.invoice_id);
  }

  sql += ' ORDER BY p.id DESC';

  const payments = queryAll(sql, params);
  res.json({ success: true, payments });
});
