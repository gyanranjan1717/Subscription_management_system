import { Cents } from '../lib/money.js';
import { TaxTable } from './taxEngine.js';
import { taxOnLine } from './taxEngine.js';
import { computeDiscount, DiscountRule, DiscountResult } from './discountEngine.js';

export interface BillableLine {
  productId: number | null;
  variantId: number | null;
  description: string;
  quantity: number;
  unitPriceCents: Cents;
  taxId: number | null;
}

export interface CalculatedLine extends BillableLine {
  grossCents: Cents;
  discountCents: Cents;
  netCents: Cents;
  taxName: string;
  taxRate: number;
  taxCents: Cents;
  totalCents: Cents;
}

export interface CalculatedInvoice {
  lines: CalculatedLine[];
  subtotalCents: Cents;
  discountCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
  discount: DiscountResult;
}

/**
 * The single place where invoice money is computed (billing, previews and tests all use it).
 *   gross    = quantity x unit price
 *   discount = from the discount engine (per line)
 *   net      = gross - discount
 *   tax      = net x rate, HALF_UP, per line
 *   total    = sum of line totals = subtotal - discount + tax
 * Totals are sums of already-rounded line values, so an invoice always foots to the cent.
 */
export function calculateInvoice(
  lines: BillableLine[],
  taxes: TaxTable,
  rule: DiscountRule | null,
  asOfDate: string,
  discountAllowed = true
): CalculatedInvoice {
  const grossLines = lines.map(l => ({
    productId: l.productId,
    quantity: l.quantity,
    grossCents: l.unitPriceCents * l.quantity
  }));

  const discount: DiscountResult = discountAllowed
    ? computeDiscount(rule, grossLines, asOfDate)
    : { applicable: false, perLineCents: lines.map(() => 0), totalCents: 0 };

  const calculated: CalculatedLine[] = lines.map((l, i) => {
    const grossCents = grossLines[i].grossCents;
    const discountCents = discount.applicable ? discount.perLineCents[i] : 0;
    const netCents = grossCents - discountCents;
    const tax = taxes.resolve(l.taxId);
    const taxCents = taxOnLine(netCents, tax.rate);
    return {
      ...l,
      grossCents,
      discountCents,
      netCents,
      taxName: tax.name,
      taxRate: tax.rate,
      taxCents,
      totalCents: netCents + taxCents
    };
  });

  const subtotalCents = calculated.reduce((s, l) => s + l.grossCents, 0);
  const discountCents = calculated.reduce((s, l) => s + l.discountCents, 0);
  const taxCents = calculated.reduce((s, l) => s + l.taxCents, 0);
  return {
    lines: calculated,
    subtotalCents,
    discountCents,
    taxCents,
    totalCents: subtotalCents - discountCents + taxCents,
    discount
  };
}
