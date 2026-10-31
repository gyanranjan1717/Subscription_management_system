import { queryAll, queryOne, execute, runTransaction } from '../db/database.js';
import { calculateTax } from './taxEngine.js';
import { evaluateDiscount, recordDiscountUsage } from './discountEngine.js';

export interface BillingRunResult {
  asOfDate: string;
  processedCount: number;
  invoicesCreated: number;
  skippedDuplicates: number;
  totalBilledAmount: number;
  invoiceIds: number[];
  details: Array<{
    subscriptionNumber: string;
    invoiceNumber?: string;
    amount?: number;
    status: 'created' | 'already_billed' | 'auto_closed' | 'error';
    reason?: string;
  }>;
}

export function computeNextDate(currentDateStr: string, interval: 'daily' | 'weekly' | 'monthly' | 'yearly'): string {
  const d = new Date(currentDateStr);
  if (interval === 'daily') {
    d.setDate(d.getDate() + 1);
  } else if (interval === 'weekly') {
    d.setDate(d.getDate() + 7);
  } else if (interval === 'monthly') {
    d.setMonth(d.getMonth() + 1);
  } else if (interval === 'yearly') {
    d.setFullYear(d.getFullYear() + 1);
  }
  return d.toISOString().split('T')[0];
}

export function runBillingCycle(asOfDate: string = new Date().toISOString().split('T')[0], operatorUserId?: number): BillingRunResult {
  return runTransaction<BillingRunResult>(() => {
    // 1. Fetch eligible active subscriptions
    const subscriptions = queryAll<{
      id: number;
      subscription_number: string;
      customer_id: number;
      plan_id: number;
      status: string;
      start_date: string;
      expiry_date: string | null;
      next_billing_date: string;
      payment_terms: string;
      discount_rule_id: number | null;
      plan_name: string;
      billing_interval: 'daily' | 'weekly' | 'monthly' | 'yearly';
      auto_close: number;
      plan_price: number;
    }>(`
      SELECT 
        s.id, s.subscription_number, s.customer_id, s.plan_id, s.status,
        s.start_date, s.expiry_date, s.next_billing_date, s.payment_terms, s.discount_rule_id,
        p.name as plan_name, p.billing_interval, p.auto_close, p.price as plan_price
      FROM subscriptions s
      JOIN plans p ON s.plan_id = p.id
      WHERE s.status = 'Active'
        AND s.next_billing_date <= ?
      ORDER BY s.id ASC
    `, [asOfDate]);

    const result: BillingRunResult = {
      asOfDate,
      processedCount: subscriptions.length,
      invoicesCreated: 0,
      skippedDuplicates: 0,
      totalBilledAmount: 0,
      invoiceIds: [],
      details: []
    };

    for (const sub of subscriptions) {
      // Check if auto_close applies
      if (sub.auto_close === 1 && sub.expiry_date && asOfDate >= sub.expiry_date) {
        execute("UPDATE subscriptions SET status = 'Closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [sub.id]);
        result.details.push({
          subscriptionNumber: sub.subscription_number,
          status: 'auto_closed',
          reason: `Auto-closed as plan ended on ${sub.expiry_date}`
        });
        continue;
      }

      const periodStart = sub.next_billing_date;
      const periodEnd = computeNextDate(periodStart, sub.billing_interval);

      // Check for existing invoice for this period - The Idempotency Check
      const existing = queryOne<{ id: number; invoice_number: string }>(
        'SELECT id, invoice_number FROM invoices WHERE subscription_id = ? AND period_start = ?',
        [sub.id, periodStart]
      );

      if (existing) {
        result.skippedDuplicates++;
        result.details.push({
          subscriptionNumber: sub.subscription_number,
          invoiceNumber: existing.invoice_number,
          status: 'already_billed',
          reason: `Invoice #${existing.invoice_number} already generated for period ${periodStart}`
        });
        continue;
      }

      // Fetch subscription lines
      const lines = queryAll<{
        id: number;
        product_id: number;
        variant_id: number | null;
        quantity: number;
        unit_price: number;
        tax_id: number | null;
        product_name: string;
        attribute_name: string | null;
        option_name: string | null;
        price_extra: number | null;
      }>(`
        SELECT 
          sl.id, sl.product_id, sl.variant_id, sl.quantity, sl.unit_price, sl.tax_id,
          p.name as product_name,
          pv.attribute_name, pv.option_name, pv.price_extra
        FROM subscription_lines sl
        JOIN products p ON sl.product_id = p.id
        LEFT JOIN product_variants pv ON sl.variant_id = pv.id
        WHERE sl.subscription_id = ?
      `, [sub.id]);

      let subtotal = 0;
      let totalTax = 0;
      let totalQty = 0;

      const productLineEvaluations: Array<{ productId: number; quantity: number; lineTotal: number }> = [];

      for (const line of lines) {
        const effectiveUnitPrice = line.unit_price;
        const lineBase = effectiveUnitPrice * line.quantity;
        subtotal += lineBase;
        totalQty += line.quantity;
        productLineEvaluations.push({
          productId: line.product_id,
          quantity: line.quantity,
          lineTotal: lineBase
        });

        const taxResult = calculateTax(lineBase, line.tax_id);
        totalTax += taxResult.taxAmount;
      }

      // Evaluate discount
      const discountRes = evaluateDiscount(
        sub.discount_rule_id,
        subtotal,
        totalQty,
        asOfDate,
        productLineEvaluations
      );

      const discountAmount = discountRes.applicable ? discountRes.discountAmount : 0;
      const netTaxable = Math.max(0, subtotal - discountAmount);
      // Recalculate tax proportionally if discount is applied at whole subscription level
      const finalTax = Number((totalTax * (subtotal > 0 ? (netTaxable / subtotal) : 1)).toFixed(2));
      const totalAmount = Number((netTaxable + finalTax).toFixed(2));

      // Generate invoice number e.g. INV-2026-XXXX
      const invCount = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM invoices');
      const invoiceNumber = `INV-${new Date().getFullYear()}-${String((invCount?.count || 0) + 1).padStart(5, '0')}`;
      const dueDate = computeNextDate(asOfDate, 'monthly'); // standard 30 day due date

      // Insert invoice
      const invInsert = execute(`
        INSERT INTO invoices (
          invoice_number, subscription_id, customer_id, period_start, period_end,
          subtotal, tax_amount, discount_amount, total_amount, amount_paid,
          status, issue_date, due_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'Confirmed', ?, ?)
      `, [
        invoiceNumber, sub.id, sub.customer_id, periodStart, periodEnd,
        subtotal, finalTax, discountAmount, totalAmount,
        asOfDate, dueDate
      ]);

      const invoiceId = Number(invInsert.lastInsertRowid);

      // Insert invoice lines
      for (const line of lines) {
        const lineBase = line.unit_price * line.quantity;
        const lineTax = calculateTax(lineBase, line.tax_id).taxAmount;
        const variantDesc = line.option_name ? ` (${line.attribute_name}: ${line.option_name})` : '';
        const description = `${line.product_name}${variantDesc} [${periodStart} to ${periodEnd}]`;

        execute(`
          INSERT INTO invoice_lines (
            invoice_id, product_id, variant_id, description,
            quantity, unit_price, tax_amount, discount_amount, line_total
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
        `, [
          invoiceId, line.product_id, line.variant_id, description,
          line.quantity, line.unit_price, lineTax, lineBase
        ]);
      }

      // Advance subscription next_billing_date
      const newNextBillingDate = periodEnd;
      execute(
        'UPDATE subscriptions SET next_billing_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [newNextBillingDate, sub.id]
      );

      // Record discount usage if applied
      if (discountRes.applicable && sub.discount_rule_id) {
        recordDiscountUsage(sub.discount_rule_id);
      }

      result.invoicesCreated++;
      result.totalBilledAmount += totalAmount;
      result.invoiceIds.push(invoiceId);
      result.details.push({
        subscriptionNumber: sub.subscription_number,
        invoiceNumber,
        amount: totalAmount,
        status: 'created'
      });
    }

    result.totalBilledAmount = Number(result.totalBilledAmount.toFixed(2));

    // Audit log
    let validUserId: number | null = null;
    if (operatorUserId) {
      const u = queryOne('SELECT id FROM users WHERE id = ?', [operatorUserId]);
      if (u) validUserId = operatorUserId;
    }

    execute(
      'INSERT INTO audit_logs (event_type, description, user_id, metadata_json) VALUES (?, ?, ?, ?)',
      [
        'BILLING_RUN',
        `Billing run executed as of ${asOfDate}. Created ${result.invoicesCreated} invoices, skipped ${result.skippedDuplicates} duplicates.`,
        validUserId,
        JSON.stringify(result)
      ]
    );

    return result;
  });
}
