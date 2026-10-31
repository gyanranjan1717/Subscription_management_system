import { queryAll } from '../db/database.js';
import { percentOf, Cents } from '../lib/money.js';

export interface TaxRule {
  id: number;
  name: string;
  rate_percentage: number;
  is_default: number;
  is_active: number;
}

/** Active tax rules indexed by id, plus the default rule. Loaded once per billing run (no per-line queries). */
export class TaxTable {
  private byId = new Map<number, TaxRule>();
  private fallback: TaxRule | null = null;

  constructor(rules: TaxRule[]) {
    for (const r of rules) {
      if (!r.is_active) continue;
      this.byId.set(r.id, r);
      if (r.is_default && !this.fallback) this.fallback = r;
    }
  }

  static load(): TaxTable {
    return new TaxTable(queryAll<TaxRule>('SELECT id, name, rate_percentage, is_default, is_active FROM tax_rules WHERE is_active = 1'));
  }

  /** The line's own rule if still active, otherwise the default rule, otherwise none. */
  resolve(taxId: number | null | undefined): { name: string; rate: number } {
    const rule = (taxId ? this.byId.get(taxId) : undefined) ?? this.fallback;
    return rule ? { name: rule.name, rate: rule.rate_percentage } : { name: 'No Tax', rate: 0 };
  }
}

/** Tax on a taxable amount: percentage of the (post-discount) line, HALF_UP to the cent. */
export function taxOnLine(taxableCents: Cents, ratePercent: number): Cents {
  return percentOf(taxableCents, ratePercent);
}
