import React, { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { TimelineEvent } from '../types.js';
import { FileText, CreditCard, GitBranch, RefreshCw, Receipt, X } from 'lucide-react';

interface SubscriptionTimelineProps {
  subscriptionId: number;
  subscriptionNumber: string;
  onClose: () => void;
}

const STYLE: Record<TimelineEvent['type'], { icon: React.ReactNode; dot: string; label: string }> = {
  status_change: { icon: <GitBranch className="w-3.5 h-3.5" />, dot: 'bg-blue-100 text-blue-700 border-blue-300', label: 'Status' },
  renewal: { icon: <RefreshCw className="w-3.5 h-3.5" />, dot: 'bg-purple-100 text-purple-700 border-purple-300', label: 'Renewed' },
  invoice: { icon: <FileText className="w-3.5 h-3.5" />, dot: 'bg-amber-100 text-amber-700 border-amber-300', label: 'Invoice' },
  invoice_status: { icon: <Receipt className="w-3.5 h-3.5" />, dot: 'bg-slate-100 text-slate-700 border-slate-300', label: 'Invoice status' },
  payment: { icon: <CreditCard className="w-3.5 h-3.5" />, dot: 'bg-emerald-100 text-emerald-700 border-emerald-300', label: 'Payment' },
  other: { icon: <FileText className="w-3.5 h-3.5" />, dot: 'bg-slate-100 text-slate-700 border-slate-300', label: 'Event' }
};

const FILTERS: { key: 'all' | TimelineEvent['type']; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'status_change', label: 'Status' },
  { key: 'invoice', label: 'Invoices' },
  { key: 'payment', label: 'Payments' },
  { key: 'renewal', label: 'Renewals' }
];

function formatTime(ts: string): string {
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? ts : d.toLocaleString();
}

export const SubscriptionTimeline: React.FC<SubscriptionTimelineProps> = ({ subscriptionId, subscriptionNumber, onClose }) => {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | TimelineEvent['type']>('all');
  const [newestFirst, setNewestFirst] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getSubscriptionTimeline(subscriptionId)
      .then(res => { if (!cancelled) setEvents(res.timeline); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [subscriptionId]);

  const visible = events.filter(e => filter === 'all' || e.type === filter);
  const ordered = newestFirst ? [...visible].reverse() : visible;

  return (
    <div className="mt-3 border border-slate-200 rounded-lg bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-bold text-slate-900 text-sm">Activity Timeline · <span className="font-mono text-odoo-500">{subscriptionNumber}</span></h4>
        <button onClick={onClose} aria-label="Close timeline" className="text-slate-400 hover:text-slate-700">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-2.5 py-0.5 rounded-full font-semibold border ${
              filter === f.key ? 'bg-odoo-500 text-white border-odoo-500' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {f.label}
          </button>
        ))}
        <button
          onClick={() => setNewestFirst(v => !v)}
          className="ml-auto px-2.5 py-0.5 rounded-full font-semibold border border-slate-300 text-slate-600 hover:bg-slate-50"
        >
          {newestFirst ? 'Newest first' : 'Oldest first'}
        </button>
      </div>

      {loading && <div className="text-xs text-slate-400 py-4 text-center">Loading activity…</div>}
      {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
      {!loading && !error && ordered.length === 0 && (
        <div className="text-xs text-slate-400 py-4 text-center">No activity recorded yet.</div>
      )}

      {!loading && !error && ordered.length > 0 && (
        <ol className="relative border-l-2 border-slate-200 ml-3 space-y-4">
          {ordered.map(ev => {
            const s = STYLE[ev.type] ?? STYLE.other;
            return (
              <li key={ev.id} className="ml-5">
                <span className={`absolute -left-[13px] flex items-center justify-center w-6 h-6 rounded-full border ${s.dot}`}>
                  {s.icon}
                </span>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900">{ev.title}</span>
                  {ev.amount !== undefined && (
                    <span className="text-xs font-mono font-bold text-slate-800">${ev.amount.toFixed(2)}</span>
                  )}
                </div>
                <div className="text-xs text-slate-500">{ev.description}</div>
                <div className="text-[11px] text-slate-400 font-mono">{formatTime(ev.timestamp)}</div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
};
