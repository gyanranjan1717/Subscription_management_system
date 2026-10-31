import { queryAll, queryOne } from '../db/database.js';

export interface TaxRule {
  id: number;
  name: string;
  rate_percentage: number;
  is_default: number;
  is_active: number;
}

export function getDefaultTaxRule(): TaxRule | null {
  return queryOne<TaxRule>('SELECT * FROM tax_rules WHERE is_default = 1 AND is_active = 1 LIMIT 1');
}

export function getTaxRuleById(id: number): TaxRule | null {
  return queryOne<TaxRule>('SELECT * FROM tax_rules WHERE id = ? AND is_active = 1', [id]);
}

export function calculateTax(amount: number, taxRuleId?: number | null): { taxAmount: number; rate: number; taxName: string } {
  let rule: TaxRule | null = null;
  if (taxRuleId) {
    rule = getTaxRuleById(taxRuleId);
  }
  if (!rule) {
    rule = getDefaultTaxRule();
  }

  if (!rule) {
    return { taxAmount: 0, rate: 0, taxName: 'No Tax' };
  }

  const taxAmount = Number(((amount * rule.rate_percentage) / 100).toFixed(2));
  return {
    taxAmount,
    rate: rule.rate_percentage,
    taxName: rule.name
  };
}
