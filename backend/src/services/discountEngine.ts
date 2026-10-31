import { queryOne, execute } from '../db/database.js';

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

export interface DiscountEvaluationResult {
  applicable: boolean;
  reason?: string;
  discountAmount: number;
  discountRule?: DiscountRule;
}

export function evaluateDiscount(
  discountRuleId: number | null | undefined,
  subtotal: number,
  totalQuantity: number,
  asOfDate: string = new Date().toISOString().split('T')[0],
  productLines?: Array<{ productId: number; quantity: number; lineTotal: number }>
): DiscountEvaluationResult {
  if (!discountRuleId) {
    return { applicable: false, discountAmount: 0 };
  }

  const rule = queryOne<DiscountRule>(
    'SELECT * FROM discount_rules WHERE id = ? AND is_active = 1',
    [discountRuleId]
  );

  if (!rule) {
    return { applicable: false, reason: 'Discount rule not found or inactive', discountAmount: 0 };
  }

  // 1. Check date bounds
  if (rule.start_date && asOfDate < rule.start_date) {
    return { applicable: false, reason: `Discount is not yet valid (starts ${rule.start_date})`, discountAmount: 0 };
  }
  if (rule.end_date && asOfDate > rule.end_date) {
    return { applicable: false, reason: `Discount has expired (ended ${rule.end_date})`, discountAmount: 0 };
  }

  // 2. Check usage limit
  if (rule.max_uses > 0 && rule.current_uses >= rule.max_uses) {
    return { applicable: false, reason: `Discount usage limit reached (${rule.current_uses}/${rule.max_uses})`, discountAmount: 0 };
  }

  // 3. Check min purchase amount
  if (rule.min_amount > 0 && subtotal < rule.min_amount) {
    return { applicable: false, reason: `Minimum order amount of $${rule.min_amount} not met (current: $${subtotal})`, discountAmount: 0 };
  }

  // 4. Check min quantity
  if (rule.min_quantity > 0 && totalQuantity < rule.min_quantity) {
    return { applicable: false, reason: `Minimum quantity of ${rule.min_quantity} not met (current: ${totalQuantity})`, discountAmount: 0 };
  }

  // 5. Calculate discount amount
  let discountAmount = 0;

  if (rule.applies_to === 'product' && rule.target_product_id && productLines) {
    // Apply discount only to the specific target product line(s)
    const matchingLines = productLines.filter(l => l.productId === rule.target_product_id);
    const targetSubtotal = matchingLines.reduce((sum, l) => sum + l.lineTotal, 0);
    if (targetSubtotal <= 0) {
      return { applicable: false, reason: 'Target product not in order', discountAmount: 0 };
    }

    if (rule.discount_type === 'percentage') {
      discountAmount = (targetSubtotal * rule.value) / 100;
    } else {
      discountAmount = Math.min(rule.value, targetSubtotal);
    }
  } else {
    // Applies to whole subscription
    if (rule.discount_type === 'percentage') {
      discountAmount = (subtotal * rule.value) / 100;
    } else {
      discountAmount = Math.min(rule.value, subtotal);
    }
  }

  discountAmount = Number(discountAmount.toFixed(2));

  return {
    applicable: true,
    discountAmount,
    discountRule: rule
  };
}

export function recordDiscountUsage(discountRuleId: number): void {
  execute(
    'UPDATE discount_rules SET current_uses = current_uses + 1 WHERE id = ?',
    [discountRuleId]
  );
}
