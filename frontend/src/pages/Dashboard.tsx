import React, { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import { DashboardMetrics } from '../types.js';
import { Alert, Button, Card, EmptyState, ErrorState, Input, Loading, PageHeader, Stat, StatusBadge, table, useToast } from '../components/ui.js';
import { addDaysIso, formatDate, formatDateTime, formatMoney, today } from '../lib/format.js';
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

const STATUS_ORDER: Array<[keyof DashboardMetrics['subscriptions'], string]> = [
  ['active', 'Active'], ['confirmed', 'Confirmed'], ['quotation', 'Quotation'], ['draft', 'Draft'], ['paused', 'Paused'], ['closed', 'Closed']
];

export const Dashboard: React.FC<DashboardProps> = ({ onNavigateToInvoice, onNavigateToBilling }) => {
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState(0);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<number | null>(null);

  const load = async (range?: { from?: string; to?: string }) => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.getSummary(range));
    } catch (err: any) {
      setError('Unable to load dashboard data. ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const applyPreset = (i: number) => {
    setPreset(i);
    setRangeError(null);
    const r = PRESETS[i].range();
    setFrom(r?.from ?? '');
    setTo(r?.to ?? '');
    load(r ?? undefined);
  };

  const applyCustom = () => {
    if (from && to && to < from) {
      setRangeError('The end date cannot be before the start date.');
      return;
    }
    setRangeError(null);
    setPreset(-1);
    load({ from: from || undefined, to: to || undefined });
  };

  const remind = async (id: number) => {
    setSendingId(id);
    try {
      toast('success', (await api.sendInvoice(id)).message);
    } catch (err: any) {
      toast('error', err.message);
    } finally {
      setSendingId(null);
    }
  };

  const exportCsv = async (kind: 'invoices' | 'subscriptions') => {
    try {
      await api.downloadCsv(kind);
    } catch (err: any) {
      toast('error', err.message);
    }
  };

  if (!data) {
    return (
      <>
        <PageHeader title="Dashboard" />
        {loading ? <Loading label="Loading dashboard…" /> : <ErrorState message={error ?? 'Unable to load dashboard data.'} onRetry={() => load()} />}
      </>
    );
  }

  const m = data.metrics;
  const f = m.financials;
  const periodLabel = m.period?.from || m.period?.to ? `${formatDate(m.period?.from)} to ${formatDate(m.period?.to)}` : 'all time';
  const attention: string[] = [];
  if (f.overdueCount > 0) attention.push(`${f.overdueCount} overdue invoice${f.overdueCount === 1 ? '' : 's'}, ${formatMoney(f.overdueAmount)} outstanding past due date`);
  if (m.subscriptions.quotation > 0) attention.push(`${m.subscriptions.quotation} quotation${m.subscriptions.quotation === 1 ? '' : 's'} waiting for confirmation`);
  if (m.subscriptions.draft > 0) attention.push(`${m.subscriptions.draft} draft subscription${m.subscriptions.draft === 1 ? '' : 's'} not yet sent`);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Subscriptions, revenue and receivables"
        actions={
          <>
            <Button onClick={() => load(from || to ? { from: from || undefined, to: to || undefined } : undefined)} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
            </Button>
            <Button variant="primary" onClick={onNavigateToBilling}>
              <PlayCircle className="w-3.5 h-3.5" aria-hidden="true" /> Go to billing run
            </Button>
          </>
        }
      />

      {error && <div className="mb-4"><Alert kind="error" onClose={() => setError(null)}>{error}</Alert></div>}

      {/* What needs attention */}
      <div className={`mb-5 rounded-lg border px-4 py-3 text-sm ${attention.length ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
        <div className="font-medium mb-0.5">{attention.length ? 'Needs attention' : 'Nothing needs attention'}</div>
        {attention.length ? (
          <ul className="list-disc list-inside text-sm">{attention.map(a => <li key={a}>{a}</li>)}</ul>
        ) : (
          <div>No overdue invoices and no pending quotations or drafts.</div>
        )}
      </div>

      {/* Period */}
      <div className="mb-5 flex flex-wrap items-end gap-x-4 gap-y-3">
        <div>
          <div className="text-xs font-medium text-slate-700 mb-1">Period for invoiced and payments</div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Period presets">
            {PRESETS.map((p, i) => (
              <Button key={p.label} size="sm" variant={preset === i ? 'primary' : 'secondary'} aria-pressed={preset === i} onClick={() => applyPreset(i)}>
                {p.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex items-end gap-2">
          <Input label="From" type="date" value={from} onChange={e => setFrom(e.target.value)} />
          <Input label="To" type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} error={rangeError} />
          <Button onClick={applyCustom} className="mb-0.5">Apply</Button>
        </div>
      </div>

      <div className={loading ? 'opacity-60 transition-opacity' : ''} aria-busy={loading}>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Recurring revenue</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
          <Stat label="Active subscriptions" value={String(m.subscriptions.active)} sub={`${m.subscriptions.total} subscriptions in total`} />
          <Stat label="Monthly recurring revenue (MRR)" value={formatMoney(m.recurringRevenue.mrr)} sub="Active subscriptions, before tax and discount" />
          <Stat label="Annual recurring revenue (ARR)" value={formatMoney(m.recurringRevenue.arr)} sub="MRR × 12" />
        </div>

        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Billing and collections, {periodLabel}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
          <Stat label="Invoiced" value={formatMoney(f.totalInvoiced)} sub="Confirmed and paid invoices issued in the period" />
          <Stat label="Payments received" value={formatMoney(f.totalCollected)} sub={`${m.period?.paymentsCount ?? 0} payment${m.period?.paymentsCount === 1 ? '' : 's'} recorded in the period`} tone="good" />
        </div>

        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Receivables, as of today</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <Stat label="Outstanding" value={formatMoney(f.totalOwed)} sub="Unpaid balance on confirmed invoices" tone={f.totalOwed > 0 ? 'warn' : 'good'} />
          <Stat label="Overdue" value={formatMoney(f.overdueAmount)} sub={`${f.overdueCount} invoice${f.overdueCount === 1 ? '' : 's'} past due date`} tone={f.overdueCount > 0 ? 'bad' : 'good'} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card
          className="lg:col-span-2"
          title="Overdue invoices"
          description={f.overdueCount > 20 ? `Largest 20 of ${f.overdueCount} shown` : undefined}
          flush
        >
          {data.overdueInvoices.length === 0 ? (
            <EmptyState title="No overdue invoices" hint="Every confirmed invoice is paid or still within its payment terms." />
          ) : (
            <div className={table.wrap}>
              <table className={table.table}>
                <thead className={table.head}>
                  <tr>
                    <th className={table.th}>Invoice</th>
                    <th className={table.th}>Customer</th>
                    <th className={table.th}>Due</th>
                    <th className={table.thNum}>Outstanding</th>
                    <th className={table.thNum}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className={table.body}>
                  {data.overdueInvoices.map(inv => (
                    <tr key={inv.id} className={table.row}>
                      <td className={table.td}>
                        <button onClick={() => onNavigateToInvoice(inv.id)} className="font-medium text-brand-700 hover:underline whitespace-nowrap">{inv.invoice_number}</button>
                      </td>
                      <td className={table.td}>
                        <div className="text-slate-900">{inv.customer_name}</div>
                        <div className="text-xs text-slate-500">{inv.company_name}</div>
                      </td>
                      <td className={table.td}>
                        <span className="whitespace-nowrap text-red-700">{formatDate(inv.due_date)}</span>
                      </td>
                      <td className={table.tdNum + ' font-medium'}>{formatMoney(inv.balance_due)}</td>
                      <td className={table.tdNum}>
                        <Button size="sm" loading={sendingId === inv.id} onClick={() => remind(inv.id)} aria-label={`Send ${inv.invoice_number} to customer`}>
                          <Send className="w-3 h-3" aria-hidden="true" /> Send
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card title="Subscriptions by status" flush>
            <table className={table.table}>
              <tbody className={table.body}>
                {STATUS_ORDER.map(([key, label]) => (
                  <tr key={key}>
                    <td className={table.td}><StatusBadge status={label} /></td>
                    <td className={table.tdNum + ' font-medium'}>{m.subscriptions[key]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Subscriptions per plan" flush>
            {data.planBreakdown.length === 0 ? (
              <EmptyState title="No plans yet" />
            ) : (
              <table className={table.table}>
                <tbody className={table.body}>
                  {data.planBreakdown.map((p, i) => (
                    <tr key={i}>
                      <td className={table.td}>
                        {p.name}
                        <span className="text-xs text-slate-500 capitalize"> · {p.billing_interval}</span>
                      </td>
                      <td className={table.tdNum + ' font-medium'}>{p.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Export">
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => exportCsv('invoices')}><Download className="w-3.5 h-3.5" aria-hidden="true" /> Invoices CSV</Button>
              <Button className="flex-1" onClick={() => exportCsv('subscriptions')}><Download className="w-3.5 h-3.5" aria-hidden="true" /> Subscriptions CSV</Button>
            </div>
          </Card>
        </div>
      </div>

      <Card className="mt-5" title="Recent activity" description="Latest entries from the audit log" flush>
        {data.recentEvents.length === 0 ? (
          <EmptyState title="No activity recorded yet" />
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {data.recentEvents.map(e => (
              <li key={e.id} className="px-4 py-2 flex flex-col sm:flex-row sm:justify-between gap-0.5">
                <span className="text-slate-700">{e.description}</span>
                <span className="text-xs text-slate-500 whitespace-nowrap">{formatDateTime(e.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};
