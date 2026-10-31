import React from 'react';
import { TrendPoint } from '../types.js';
import { formatMoney } from '../lib/format.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;

/** Compact INR for axis labels: 12.5k, 1.2L (lakh), 3.4Cr (crore). */
function short(n: number): string {
  if (n >= 1e7) return `${+(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `${+(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

/** Rounds the top of the scale up to 1, 2, 2.5, 5 or 10 times a power of ten, so gridlines are readable. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * pow) return m * pow;
  return 10 * pow;
}

const W = 640, H = 230, L = 46, R = 8, T = 10, B = 28;

export const TrendChart: React.FC<{ data: TrendPoint[] }> = ({ data }) => {
  const peak = niceMax(Math.max(0, ...data.flatMap(d => [d.invoiced, d.collected])));
  const innerW = W - L - R;
  const innerH = H - T - B;
  const slot = innerW / data.length;
  const barW = Math.min(26, slot / 2.6);
  const y = (v: number) => T + innerH - (v / peak) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => t * peak);
  const empty = data.every(d => d.invoiced === 0 && d.collected === 0);
  const summary = data.map(d => `${monthLabel(d.month)}: invoiced ${formatMoney(d.invoiced)}, collected ${formatMoney(d.collected)}`).join('; ');

  return (
    <div>
      <div className="flex items-center gap-4 text-xs text-slate-600 mb-2" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-brand-600" /> Invoiced</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Collected</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Invoiced versus collected, last six months. ${summary}`} className="w-full h-auto">
        {ticks.map(t => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="stroke-slate-200" strokeWidth={1} />
            <text x={L - 6} y={y(t) + 3} textAnchor="end" className="fill-slate-500" fontSize={10}>{short(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = L + slot * i + slot / 2;
          return (
            <g key={d.month}>
              <title>{`${monthLabel(d.month)} ${d.month.slice(0, 4)}: invoiced ${formatMoney(d.invoiced)}, collected ${formatMoney(d.collected)}`}</title>
              <rect x={cx - barW - 1} y={y(d.invoiced)} width={barW} height={Math.max(0, T + innerH - y(d.invoiced))} rx={2} className="fill-brand-600" />
              <rect x={cx + 1} y={y(d.collected)} width={barW} height={Math.max(0, T + innerH - y(d.collected))} rx={2} className="fill-emerald-500" />
              <text x={cx} y={H - 9} textAnchor="middle" className="fill-slate-600" fontSize={11}>{monthLabel(d.month)}</text>
            </g>
          );
        })}
      </svg>
      {empty && <p className="text-xs text-slate-500 mt-1">No invoices or payments in the last six months yet.</p>}
    </div>
  );
};
