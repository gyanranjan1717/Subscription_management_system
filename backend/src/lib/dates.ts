/** Calendar arithmetic on ISO `YYYY-MM-DD` strings, in UTC, so results never depend on the server time zone. */

export type BillingInterval = 'daily' | 'weekly' | 'monthly' | 'yearly';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO_DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Adds whole months, clamping to the last day of the target month (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsClamped(iso: string, months: number): string {
  const [y, m, day] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = total % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const dd = Math.min(day, lastDay);
  return `${String(ty).padStart(4, '0')}-${String(tm + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/**
 * Start date of billing period `index`, always computed from the subscription start date
 * (never by repeatedly adding to the previous period), so month-end clamping cannot drift:
 * start 31 Jan gives 31 Jan, 28 Feb, 31 Mar, 30 Apr ...
 */
export function periodStart(startDate: string, interval: BillingInterval, index: number): string {
  switch (interval) {
    case 'daily': return addDays(startDate, index);
    case 'weekly': return addDays(startDate, index * 7);
    case 'monthly': return addMonthsClamped(startDate, index);
    case 'yearly': return addMonthsClamped(startDate, index * 12);
  }
}

/** Number of days in a payment term string: "30 Days Net" is 30, "Immediate Payment" is 0. */
export function paymentTermDays(terms: string): number {
  const m = /(\d{1,3})/.exec(terms);
  return m ? Number(m[1]) : 0;
}

export const PAYMENT_TERMS_RE = /^(Immediate Payment|\d{1,3} Days Net)$/;
