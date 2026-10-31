// Display formatting only. Every amount shown comes from the backend; nothing is calculated here.
const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

export function formatMoney(value: number | null | undefined): string {
  return currency.format(Number(value ?? 0));
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One date format across the app: 05 Mar 2026. Accepts YYYY-MM-DD or a database timestamp. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : value;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const t = /[ T](\d{2}:\d{2})/.exec(value);
  return t ? `${formatDate(value)}, ${t[1]}` : formatDate(value);
}
