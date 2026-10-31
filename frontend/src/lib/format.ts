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
