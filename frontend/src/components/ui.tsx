import React from 'react';
import { AlertCircle, CheckCircle2, Inbox, Loader2 } from 'lucide-react';

const STYLES: Record<string, string> = {
  Draft: 'bg-slate-100 text-slate-700 border-slate-300',
  Quotation: 'bg-amber-100 text-amber-800 border-amber-300',
  Confirmed: 'bg-blue-100 text-blue-800 border-blue-300',
  Active: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  Paused: 'bg-orange-100 text-orange-800 border-orange-300',
  Closed: 'bg-slate-200 text-slate-700 border-slate-300',
  Paid: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  Cancelled: 'bg-slate-200 text-slate-600 border-slate-300 line-through',
  Overdue: 'bg-red-100 text-red-800 border-red-300',
  Partial: 'bg-amber-100 text-amber-800 border-amber-300'
};

/** One badge style for every subscription / invoice status in the app. */
export const StatusBadge: React.FC<{ status: string; overdue?: boolean; partial?: boolean }> = ({ status, overdue, partial }) => {
  const key = overdue && status === 'Confirmed' ? 'Overdue' : partial && status === 'Confirmed' ? 'Partial' : status;
  const label = key === 'Partial' ? 'Partially paid' : key;
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold border whitespace-nowrap ${STYLES[key] ?? STYLES.Draft}`}>
      {label}
    </span>
  );
};

export const Alert: React.FC<{ kind: 'error' | 'success'; children: React.ReactNode; onClose?: () => void }> = ({ kind, children, onClose }) => (
  <div
    role={kind === 'error' ? 'alert' : 'status'}
    className={`px-4 py-3 rounded-lg text-sm flex items-start justify-between gap-3 border ${
      kind === 'error' ? 'bg-red-50 border-red-300 text-red-900' : 'bg-emerald-50 border-emerald-300 text-emerald-950'
    }`}
  >
    <span className="flex items-start gap-2">
      {kind === 'error' ? <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />}
      <span>{children}</span>
    </span>
    {onClose && (
      <button onClick={onClose} aria-label="Dismiss" className="font-bold leading-none">
        ×
      </button>
    )}
  </div>
);

export const Loading: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div className="flex items-center justify-center gap-2 py-10 text-slate-500 text-sm">
    <Loader2 className="w-4 h-4 animate-spin" /> {label}
  </div>
);

export const EmptyState: React.FC<{ title: string; hint?: string }> = ({ title, hint }) => (
  <div className="flex flex-col items-center justify-center py-12 text-center text-slate-500">
    <Inbox className="w-8 h-8 mb-2 text-slate-300" />
    <div className="font-semibold text-slate-700 text-sm">{title}</div>
    {hint && <div className="text-xs mt-1">{hint}</div>}
  </div>
);
