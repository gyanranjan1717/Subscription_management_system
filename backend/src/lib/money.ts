/**
 * Exact money arithmetic. Amounts are carried as integer cents (paise) everywhere in the
 * calculation path; floating point is only used to hand the final 2-decimal value to SQLite.
 * Rounding is HALF_UP and applied per line, so stored totals are plain sums of stored lines.
 */

export type Cents = number;

const MONEY_RE = /^\d{1,10}(\.\d{1,2})?$/;

/** Parses a user-supplied amount ("1560", "1560.5", 1560.5) to cents without float math. */
export function parseMoney(input: unknown): Cents | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null;
    input = String(input);
  }
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!MONEY_RE.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** Converts a stored 2-decimal value to cents. */
export function toCents(amount: number): Cents {
  return Math.round(amount * 100);
}

/** Converts cents to the 2-decimal number that is stored / returned by the API. */
export function fromCents(cents: Cents): number {
  return cents / 100;
}

/** Integer division of non-negative numbers rounded HALF_UP. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((numerator * 2 + denominator) / (denominator * 2));
}

/** Percentage of an amount, rounded HALF_UP to the cent. `ratePercent` may have up to 2 decimals. */
export function percentOf(cents: Cents, ratePercent: number): Cents {
  const basisPoints = Math.round(ratePercent * 100); // 18 -> 1800, 12.5 -> 1250
  return divRoundHalfUp(cents * basisPoints, 10000);
}

/**
 * Splits `total` across `weights` so the parts sum exactly to `total` (largest remainder),
 * used to spread an invoice-level discount over lines without losing a cent.
 */
export function allocate(total: Cents, weights: number[]): Cents[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const shares = weights.map(w => Math.floor((total * w) / sum));
  let remainder = total - shares.reduce((a, b) => a + b, 0);
  const order = weights
    .map((w, i) => ({ i, frac: (total * w) % sum }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; remainder > 0 && k < order.length; k++, remainder--) {
    shares[order[k].i] += 1;
  }
  return shares;
}
