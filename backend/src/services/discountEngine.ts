import { queryOne, execute } from '../db/database.js';
import { allocate, percentOf, Cents, toCents } from '../lib/money.js';

export interface DiscountRule {
  id: number;
  code: string;
  description: string;
  discount_type: 'fixed' | 'percentage';
  value: number;
  min_amount: number;
  min_quantity: number;
  start_date: string | null;
  end_date: string | null;
  max_uses: number; // 0 = unlimited
  current_uses: number;
  applies_to: 'all' | 'product' | 'subscription';
  target_product_id: number | null;
  is_active: number;
}

export interface DiscountableLine {
  productId: number | null;
  quantity: number;
  grossCents: Cents;
}

export interface DiscountResult {
  applicable: boolean;
  reason?: string;
  /** Discount per input line, in cents; sums to totalCents exactly. */
  perLineCents: Cents[];
  totalCents: Cents;
  rule?: DiscountRule;
}

const NONE: DiscountResult = { applicable: false, perLineCents: [], totalCents: 0 };
const none = (lines: DiscountableLine[], reason?: string): DiscountResult =>
  ({ ...NONE, perLineCents: lines.map(() => 0), reason });

export function loadDiscountRule(id: number | null | undefined): DiscountRule | null {
  if (!id) return null;
  return queryOne<DiscountRule>('SELECT * FROM discount_rules WHERE id = ? AND is_active = 1', [id]);
}

/**
 * Pure server-side discount calculation. Validity (dates, usage cap, minimums) is decided here and
 * nowhere else; the client never sends or computes a discount amount.
 *
 *  - product scope: only lines of `target_product_id`; percentage per line, fixed amount per line (capped at the line).
 *  - all / subscription scope: applied to the whole invoice; the total is spread over lines with
 *    largest-remainder allocation so line discounts add up exactly (tax is then computed per line).
 */
export function computeDiscount(rule: DiscountRule | null, lines: DiscountableLine[], asOfDate: string): DiscountResult {
  if (!rule || !rule.is_active) return none(lines, 'Discount rule not found or inactive');

  if (rule.start_date && asOfDate < rule.start_date) return none(lines, `Discount is not yet valid (starts ${rule.start_date})`);
  if (rule.end_date && asOfDate > rule.end_date) return none(lines, `Discount has expired (ended ${rule.end_date})`);
  if (rule.max_uses > 0 && rule.current_uses >= rule.max_uses) {
    return none(lines, `Discount usage limit reached (${rule.current_uses}/${rule.max_uses})`);
  }

  const productScope = rule.applies_to === 'product';
  const eligible = lines.map(l => (productScope ? l.productId === rule.target_product_id : true) && l.grossCents > 0);
  const eligibleGross = lines.reduce((s, l, i) => s + (eligible[i] ? l.grossCents : 0), 0);
  const eligibleQty = lines.reduce((s, l, i) => s + (eligible[i] ? l.quantity : 0), 0);

  if (eligibleGross <= 0) return none(lines, 'No eligible lines for this discount');
  if (rule.min_amount > 0 && eligibleGross < toCents(rule.min_amount)) {
    return none(lines, `Minimum purchase of ${rule.min_amount} not met`);
  }
  if (rule.min_quantity > 0 && eligibleQty < rule.min_quantity) {
    return none(lines, `Minimum quantity of ${rule.min_quantity} not met`);
  }

  const valueCents = toCents(rule.value);
  let perLine: Cents[];

  if (productScope) {
    perLine = lines.map((l, i) => {
      if (!eligible[i]) return 0;
      return rule.discount_type === 'percentage'
        ? percentOf(l.grossCents, rule.value)
        : Math.min(valueCents, l.grossCents);
    });
  } else {
    const total = rule.discount_type === 'percentage'
      ? percentOf(eligibleGross, rule.value)
      : Math.min(valueCents, eligibleGross);
    perLine = allocate(total, lines.map((l, i) => (eligible[i] ? l.grossCents : 0)));
  }

  const totalCents = perLine.reduce((a, b) => a + b, 0);
  if (totalCents <= 0) return none(lines, 'Discount amount is zero');
  return { applicable: true, perLineCents: perLine, totalCents, rule };
}

/**
 * Atomically consumes one use of a rule. The WHERE clause is the guard, so two concurrent invoices
 * can never both take the last use; callers must be inside a transaction with the invoice insert.
 */
export function claimDiscountUse(ruleId: number): boolean {
  const res = execute(
    `UPDATE discount_rules SET current_uses = current_uses + 1
     WHERE id = ? AND is_active = 1 AND (max_uses = 0 OR current_uses < max_uses)`,
    [ruleId]
  );
  return res.changes === 1;
}
