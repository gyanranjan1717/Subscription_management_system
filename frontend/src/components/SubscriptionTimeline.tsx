import React, { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { TimelineEvent } from '../types.js';
import { EmptyState, ErrorState, Loading, cx } from './ui.js';
import { formatDateTime, formatMoney } from '../lib/format.js';

interface Props {
  subscriptionId: number;
}

const LABEL: Record<TimelineEvent['type'], string> = {
  status_change: 'Status',
  renewal: 'Renewal',
  invoice: 'Invoice',
  invoice_status: 'Invoice status',
  payment: 'Payment',
  other: 'Event'
};

const FILTERS: Array<{ key: 'all' | TimelineEvent['type']; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'status_change', label: 'Status' },
  { key: 'invoice', label: 'Invoices' },
  { key: 'payment', label: 'Payments' },
  { key: 'renewal', label: 'Renewals' }
];

export const SubscriptionTimeline: React.FC<Props> = ({ subscriptionId }) => {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | TimelineEvent['type']>('all');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getSubscriptionTimeline(subscriptionId)
      .then(res => { if (!cancelled) setEvents([...res.timeline].reverse()); })
      .catch(err => { if (!cancelled) setError('Unable to load activity. ' + err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [subscriptionId, attempt]);

  const visible = events.filter(e => filter === 'all' || e.type === filter);

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-3" role="group" aria-label="Filter activity">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={cx('px-2 py-0.5 rounded border text-xs', filter === f.key ? 'bg-brand-700 border-brand-700 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50')}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? <Loading label="Loading activity…" /> : error ? <ErrorState message={error} onRetry={() => setAttempt(a => a + 1)} /> : visible.length === 0 ? (
        <EmptyState title="No activity yet" />
      ) : (
        <ol className="divide-y divide-slate-100 border border-slate-200 rounded-md">
          {visible.map(ev => (
            <li key={ev.id} className="px-3 py-2 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-medium text-slate-900">{ev.title}</span>
                <span className="text-xs text-slate-500 whitespace-nowrap">{formatDateTime(ev.timestamp)}</span>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-slate-500">
                <span>{LABEL[ev.type] ?? 'Event'} · {ev.description}</span>
                {ev.amount !== undefined && <span className="tabular-nums text-slate-700">{formatMoney(ev.amount)}</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};
