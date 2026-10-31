import React, { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import { DashboardMetrics } from '../types.js';
import { Alert, EmptyState, Loading } from '../components/ui.js';
import { addDaysIso, formatMoney, today } from '../lib/format.js';
import { Download, PlayCircle, RefreshCw, Send } from 'lucide-react';

interface DashboardProps {
  onNavigateToInvoice: (invoiceId: number) => void;
  onNavigateToBilling: () => void;
}

type Data = { metrics: DashboardMetrics; planBreakdown: any[]; overdueInvoices: any[]; recentEvents: any[] };

const PRESETS: Array<{ label: string; range: () => { from: string; to: string } | null }> = [
  { label: 'All time', range: () => null },
  { label: 'This month', range: () => ({ from: today().slice(0, 8) + '01', to: today() }) },
  { label: 'Last 30 days', range: () => ({ from: addDaysIso(today(), -30), to: today() }) },
  { label: 'Last 90 days', range: () => ({ from: addDaysIso(today(), -90), to: today() }) }
];

const STATUS_ORDER: Array<[keyof DashboardMetrics['subscriptions'], string, string]> = [
  ['active', 'Active', 'bg-emerald-500'],
  ['confirmed', 'Confirmed', 'bg-blue-500'],
  ['quotation', 'Quotation', 'bg-amber-500'],
  ['draft', 'Draft', 'bg-slate-400'],
  ['paused', 'Paused', 'bg-orange-500'],
  ['closed', 'Closed', 'bg-slate-600']
];

const Card: React.FC<{ label: string; value: string; sub?: string; tone?: 'default' | 'good' | 'warn' | 'bad' }> = ({ label, value, sub, tone = 'default' }) => {
  const color = tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : tone === 'bad' ? 'text-red-700' : 'text-slate-900';
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-2xl font-black mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
};

export const Dashboard: React.FC<DashboardProps> = ({ onNavigateToInvoice, onNavigateToBilling }) => {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preset, setPreset] = useState(0);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sendingId, setSendingId] = useState<number | null>(null);

  const load = async (range?: { from?: string; to?: string }) => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.getSummary(range));
    } catch (err: any) {
      setError('Could not load the dashboard: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const applyPreset = (i: number) => {
    setPreset(i);
    const r = PRESETS[i].range();
    setFrom(r?.from ?? '');
    setTo(r?.to ?? '');
    load(r ?? undefined);
  };

  const applyCustom = () => {
    setPreset(-1);
    load({ from: from || undefined, to: to || undefined });
  };

  const remind = async (id: number) => {
    setSendingId(id);
    try {
      setNotice((await api.sendInvoice(id)).message);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSendingId(null);
    }
  };

  const exportCsv = async (kind: 'invoices' | 'subscriptions') => {
    try {
      await api.downloadCsv(kind);
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (!data) {
    return loading ? <Loading label="Loading dashboard…" /> : <Alert kind="error">{error ?? 'No data.'}</Alert>;
  }

  const m = data.metrics;
  const totalSubs = m.subscriptions.total || 1;
  const periodLabel = m.period?.from || m.period?.to ? `${m.period?.from ?? '…'} → ${m.period?.to ?? '…'}` : 'all time';

  return (
    <div className="space-y-6">
      <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Finance Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            Aggregated in the database, computed in {m.performance.queryExecutionTimeMs} ms. Period filter applies to invoiced and collected; the receivables book is always as of today.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => load(from || to ? { from: from || undefined, to: to || undefined } : undefined)} disabled={loading} className="px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button onClick={onNavigateToBilling} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5">
            <PlayCircle className="w-3.5 h-3.5" /> Billing run
          </button>
        </div>
      </div>

      {error && <Alert kind="error" onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert kind="success" onClose={() => setNotice(null)}>{notice}</Alert>}

      {/* Period filter */}
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p, i) => (
          <button
            key={p.label}
            onClick={() => applyPreset(i)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${preset === i ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'}`}
          >
            {p.label}
          </button>
        ))}
        <span className="mx-1 text-slate-300">|</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="From" className="border border-slate-300 rounded-lg px-2 py-1 text-xs" />
        <span className="text-xs text-slate-400">to</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="To" className="border border-slate-300 rounded-lg px-2 py-1 text-xs" />
        <button onClick={applyCustom} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 hover:bg-slate-50">Apply</button>
      </div>

      <div className={`grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 ${loading ? 'opacity-60' : ''}`}>
        <Card label="Active subscriptions" value={String(m.subscriptions.active)} sub={`of ${m.subscriptions.total} total`} tone="good" />
        <Card label="Monthly recurring revenue" value={formatMoney(m.recurringRevenue.mrr)} sub={`ARR ${formatMoney(m.recurringRevenue.arr)}`} />
        <Card label={`Invoiced (${periodLabel})`} value={formatMoney(m.financials.totalInvoiced)} />
        <Card label={`Payments received (${periodLabel})`} value={formatMoney(m.financials.totalCollected)} sub={`${m.period?.paymentsCount ?? 0} payment(s)`} tone="good" />
        <Card label="Outstanding (as of today)" value={formatMoney(m.financials.totalOwed)} tone={m.financials.totalOwed > 0 ? 'warn' : 'good'} />
        <Card label="Overdue invoices" value={String(m.financials.overdueCount)} sub={`${formatMoney(m.financials.overdueAmount)} overdue`} tone={m.financials.overdueCount > 0 ? 'bad' : 'good'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Overdue list */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 font-bold text-slate-900 text-sm flex items-center justify-between">
            Overdue invoices to chase
            <span className="text-xs font-semibold text-red-700">{m.financials.overdueCount} overdue · top 20 shown</span>
          </div>
          {data.overdueInvoices.length === 0 ? (
            <EmptyState title="Nothing overdue" hint="Every confirmed invoice is within its payment terms or paid." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2">Invoice</th>
                    <th className="px-4 py-2">Customer</th>
                    <th className="px-4 py-2 hidden sm:table-cell">Due</th>
                    <th className="px-4 py-2 text-right">Outstanding</th>
                    <th className="px-4 py-2 text-right">Chase</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.overdueInvoices.map(inv => (
                    <tr key={inv.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2">
                        <button onClick={() => onNavigateToInvoice(inv.id)} className="font-semibold text-odoo-500 hover:underline">{inv.invoice_number}</button>
                      </td>
                      <td className="px-4 py-2">
                        <div className="font-medium text-slate-900">{inv.customer_name}</div>
                        <div className="text-slate-400">{inv.company_name}</div>
                      </td>
                      <td className="px-4 py-2 text-red-600 font-semibold hidden sm:table-cell">{inv.due_date}</td>
                      <td className="px-4 py-2 text-right font-bold">{formatMoney(inv.balance_due)}</td>
                      <td className="px-4 py-2 text-right">
                        <button disabled={sendingId === inv.id} onClick={() => remind(inv.id)} className="px-2 py-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded font-semibold inline-flex items-center gap-1 disabled:opacity-50">
                          <Send className="w-3 h-3" /> {sendingId === inv.id ? 'Sending…' : 'Send'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Subscription status + plans */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="font-bold text-slate-900 text-sm mb-3">Subscriptions by status</div>
            <div className="space-y-2">
              {STATUS_ORDER.map(([key, label, color]) => (
                <div key={key} className="text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>{label}</span>
                    <strong>{m.subscriptions[key]}</strong>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded">
                    <div className={`h-1.5 rounded ${color}`} style={{ width: `${Math.round((m.subscriptions[key] / totalSubs) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="font-bold text-slate-900 text-sm mb-3">Subscriptions per plan</div>
            {data.planBreakdown.length === 0 ? (
              <EmptyState title="No plans yet" />
            ) : (
              <ul className="divide-y divide-slate-100 text-xs">
                {data.planBreakdown.map((p, i) => (
                  <li key={i} className="py-2 flex justify-between">
                    <span>{p.name} <span className="text-slate-400">({p.billing_interval})</span></span>
                    <strong>{p.count}</strong>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="font-bold text-slate-900 text-sm mb-2">Export</div>
            <div className="flex gap-2">
              <button onClick={() => exportCsv('invoices')} className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold hover:bg-slate-50 flex items-center justify-center gap-1.5"><Download className="w-3.5 h-3.5" /> Invoices</button>
              <button onClick={() => exportCsv('subscriptions')} className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-xs font-semibold hover:bg-slate-50 flex items-center justify-center gap-1.5"><Download className="w-3.5 h-3.5" /> Subscriptions</button>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="font-bold text-slate-900 text-sm mb-2">Recent activity</div>
        {data.recentEvents.length === 0 ? (
          <EmptyState title="No activity yet" />
        ) : (
          <ul className="divide-y divide-slate-100 text-xs">
            {data.recentEvents.map(e => (
              <li key={e.id} className="py-2 flex flex-col sm:flex-row sm:justify-between gap-1">
                <span className="text-slate-700">{e.description}</span>
                <span className="text-slate-400 font-mono">{e.created_at}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
