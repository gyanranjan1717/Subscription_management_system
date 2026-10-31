import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Inbox, Loader2, X } from 'lucide-react';

/** Join class names, skipping falsy values. */
export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

// ---------------------------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------------------------
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
  size?: 'sm' | 'md';
  loading?: boolean;
};

const BUTTON_VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 border-brand-700',
  success: 'bg-emerald-700 text-white hover:bg-emerald-800 border-emerald-700',
  secondary: 'bg-white text-slate-700 hover:bg-slate-50 border-slate-300',
  danger: 'bg-white text-red-700 hover:bg-red-50 border-red-300',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 border-transparent'
};

export const Button: React.FC<ButtonProps> = ({ variant = 'secondary', size = 'md', loading, disabled, className, children, type = 'button', ...rest }) => (
  <button
    type={type}
    disabled={disabled || loading}
    className={cx(
      'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium whitespace-nowrap transition-colors',
      'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-1',
      'disabled:opacity-50 disabled:cursor-not-allowed',
      size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
      BUTTON_VARIANTS[variant],
      className
    )}
    {...rest}
  >
    {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
    {children}
  </button>
);

// ---------------------------------------------------------------------------------------------
// Form fields: every control has a visible label
// ---------------------------------------------------------------------------------------------
export const controlCls =
  'block w-full h-9 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 ' +
  'focus:outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600 disabled:bg-slate-50 disabled:text-slate-500';

interface FieldShellProps {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string | null;
  id: string;
  children: React.ReactNode;
  className?: string;
}

const FieldShell: React.FC<FieldShellProps> = ({ label, required, hint, error, id, children, className }) => (
  <div className={className}>
    <label htmlFor={id} className="block text-xs font-medium text-slate-700 mb-1">
      {label}
      {required ? <span className="text-red-600" aria-hidden="true"> *</span> : <span className="text-slate-400 font-normal"> (optional)</span>}
    </label>
    {children}
    {error ? (
      <p id={`${id}-err`} className="text-xs text-red-700 mt-1">{error}</p>
    ) : hint ? (
      <p id={`${id}-hint`} className="text-xs text-slate-500 mt-1">{hint}</p>
    ) : null}
  </div>
);

type CommonField = { label: string; hint?: string; error?: string | null; wrapperClassName?: string };

export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement> & CommonField> = ({ label, hint, error, wrapperClassName, className, required, ...rest }) => {
  const id = useId();
  return (
    <FieldShell id={id} label={label} required={required} hint={hint} error={error} className={wrapperClassName}>
      <input id={id} required={required} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined} className={cx(controlCls, error && 'border-red-500', className)} {...rest} />
    </FieldShell>
  );
};

export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement> & CommonField> = ({ label, hint, error, wrapperClassName, className, required, children, ...rest }) => {
  const id = useId();
  return (
    <FieldShell id={id} label={label} required={required} hint={hint} error={error} className={wrapperClassName}>
      <select id={id} required={required} aria-invalid={!!error} className={cx(controlCls, error && 'border-red-500', className)} {...rest}>
        {children}
      </select>
    </FieldShell>
  );
};

export const Textarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement> & CommonField> = ({ label, hint, error, wrapperClassName, className, required, ...rest }) => {
  const id = useId();
  return (
    <FieldShell id={id} label={label} required={required} hint={hint} error={error} className={wrapperClassName}>
      <textarea id={id} required={required} className={cx(controlCls, 'h-auto py-2', error && 'border-red-500', className)} {...rest} />
    </FieldShell>
  );
};

export const Checkbox: React.FC<React.InputHTMLAttributes<HTMLInputElement> & { label: string }> = ({ label, className, ...rest }) => {
  const id = useId();
  return (
    <label htmlFor={id} className={cx('flex items-center gap-2 text-sm text-slate-700', className)}>
      <input id={id} type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600" {...rest} />
      {label}
    </label>
  );
};

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------
export const PageHeader: React.FC<{ title: string; subtitle?: string; actions?: React.ReactNode }> = ({ title, subtitle, actions }) => (
  <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
    <div className="min-w-0">
      <h1 className="text-xl font-semibold text-slate-900 tracking-tight">{title}</h1>
      {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

export const Card: React.FC<{ title?: string; description?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string; flush?: boolean }> = ({
  title, description, actions, children, className, flush
}) => (
  <section className={cx('bg-white border border-slate-200 rounded-lg shadow-sm', className)}>
    {(title || actions) && (
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
        <div className="min-w-0">
          {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
          {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </header>
    )}
    <div className={flush ? '' : 'p-4'}>{children}</div>
  </section>
);

type Tone = 'default' | 'good' | 'warn' | 'bad';
const TONE_TEXT: Record<Tone, string> = { default: 'text-slate-900', good: 'text-emerald-700', warn: 'text-amber-700', bad: 'text-red-700' };

/** A KPI: label, value, one line of context. Values always come from the API. */
export const Stat: React.FC<{ label: string; value: string; sub?: string; tone?: Tone }> = ({ label, value, sub, tone = 'default' }) => (
  <div className="bg-white border border-slate-200 rounded-lg px-4 py-3">
    <div className="text-xs font-medium text-slate-500">{label}</div>
    <div className={cx('text-xl font-semibold tabular-nums mt-1', TONE_TEXT[tone])}>{value}</div>
    {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
  </div>
);

export const Tabs: React.FC<{ tabs: Array<{ id: string; label: string; count?: number }>; active: string; onChange: (id: string) => void }> = ({ tabs, active, onChange }) => (
  <div role="tablist" className="flex gap-1 border-b border-slate-200 overflow-x-auto">
    {tabs.map(t => (
      <button
        key={t.id}
        role="tab"
        aria-selected={active === t.id}
        onClick={() => onChange(t.id)}
        className={cx(
          'px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
          active === t.id ? 'border-brand-700 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'
        )}
      >
        {t.label}
        {t.count !== undefined && <span className="ml-1.5 text-xs text-slate-400">{t.count}</span>}
      </button>
    ))}
  </div>
);

// ---------------------------------------------------------------------------------------------
// Tables: shared class names so every table has the same density and alignment
// ---------------------------------------------------------------------------------------------
export const table = {
  wrap: 'overflow-x-auto',
  table: 'w-full text-left text-sm',
  head: 'bg-slate-50 border-b border-slate-200',
  th: 'px-4 py-2.5 text-xs font-medium text-slate-600 whitespace-nowrap',
  thNum: 'px-4 py-2.5 text-xs font-medium text-slate-600 whitespace-nowrap text-right',
  body: 'divide-y divide-slate-100',
  row: 'hover:bg-slate-50',
  td: 'px-4 py-3 align-middle',
  tdNum: 'px-4 py-3 align-middle text-right tabular-nums whitespace-nowrap'
};

// ---------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------
const STATUS_STYLES: Record<string, string> = {
  Draft: 'bg-slate-100 text-slate-700 border-slate-300',
  Quotation: 'bg-amber-50 text-amber-800 border-amber-300',
  Confirmed: 'bg-blue-50 text-blue-800 border-blue-300',
  Active: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  Paused: 'bg-orange-50 text-orange-800 border-orange-300',
  Closed: 'bg-slate-100 text-slate-600 border-slate-300',
  Paid: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  Cancelled: 'bg-slate-100 text-slate-500 border-slate-300',
  Overdue: 'bg-red-50 text-red-800 border-red-300',
  Partial: 'bg-amber-50 text-amber-800 border-amber-300'
};

/** Text label + colour, never colour alone. */
export const StatusBadge: React.FC<{ status: string; overdue?: boolean; partial?: boolean }> = ({ status, overdue, partial }) => {
  const key = overdue && status === 'Confirmed' ? 'Overdue' : partial && status === 'Confirmed' ? 'Partial' : status;
  const label = key === 'Partial' ? 'Partially paid' : key;
  return (
    <span className={cx('inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap', STATUS_STYLES[key] ?? STATUS_STYLES.Draft)}>
      {label}
    </span>
  );
};

// ---------------------------------------------------------------------------------------------
// Feedback: inline messages, toasts, loading / empty / error states
// ---------------------------------------------------------------------------------------------
export const Alert: React.FC<{ kind: 'error' | 'success' | 'info'; children: React.ReactNode; onClose?: () => void }> = ({ kind, children, onClose }) => (
  <div
    role={kind === 'error' ? 'alert' : 'status'}
    className={cx(
      'px-3 py-2.5 rounded-md text-sm flex items-start justify-between gap-3 border',
      kind === 'error' && 'bg-red-50 border-red-200 text-red-900',
      kind === 'success' && 'bg-emerald-50 border-emerald-200 text-emerald-900',
      kind === 'info' && 'bg-blue-50 border-blue-200 text-blue-900'
    )}
  >
    <span className="flex items-start gap-2 min-w-0">
      {kind === 'error' ? <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" /> : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />}
      <span className="break-words">{children}</span>
    </span>
    {onClose && (
      <button onClick={onClose} aria-label="Dismiss message" className="shrink-0 text-current opacity-70 hover:opacity-100">
        <X className="w-4 h-4" />
      </button>
    )}
  </div>
);

type ToastKind = 'success' | 'error';
interface ToastItem { id: number; kind: ToastKind; message: string }
const ToastContext = createContext<(kind: ToastKind, message: string) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const push = useCallback((kind: ToastKind, message: string) => {
    const id = ++seq.current;
    setItems(prev => [...prev.slice(-2), { id, kind, message }]);
    setTimeout(() => setItems(prev => prev.filter(t => t.id !== id)), kind === 'error' ? 9000 : 6000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 right-4 left-4 sm:left-auto sm:w-96 z-[80] space-y-2">
        {items.map(t => (
          <div key={t.id} className="shadow-md">
            <Alert kind={t.kind} onClose={() => setItems(prev => prev.filter(x => x.id !== t.id))}>{t.message}</Alert>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const Loading: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div role="status" className="flex items-center justify-center gap-2 py-12 text-slate-500 text-sm">
    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> {label}
  </div>
);

export const EmptyState: React.FC<{ title: string; hint?: string; action?: React.ReactNode }> = ({ title, hint, action }) => (
  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
    <Inbox className="w-7 h-7 mb-2 text-slate-300" aria-hidden="true" />
    <div className="text-sm font-medium text-slate-700">{title}</div>
    {hint && <div className="text-xs text-slate-500 mt-1 max-w-sm">{hint}</div>}
    {action && <div className="mt-3">{action}</div>}
  </div>
);

export const ErrorState: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div role="alert" className="flex flex-col items-center justify-center py-12 px-4 text-center">
    <AlertCircle className="w-7 h-7 mb-2 text-red-400" aria-hidden="true" />
    <div className="text-sm font-medium text-slate-800">{message}</div>
    {onRetry && <Button className="mt-3" onClick={onRetry}>Retry</Button>}
  </div>
);

// ---------------------------------------------------------------------------------------------
// Modal and confirmation dialog (Escape closes, focus moves in and is restored, background locked)
// ---------------------------------------------------------------------------------------------
export const Modal: React.FC<{
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}> = ({ title, onClose, children, footer, size = 'md' }) => {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = panel.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    (focusable ?? panel.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && panel.current) {
        const nodes = Array.from(panel.current.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)'));
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cx('w-full bg-white rounded-lg shadow-xl border border-slate-200 my-auto focus:outline-none', width)}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h2 id={titleId} className="text-base font-semibold text-slate-900">{title}</h2>
          <button data-close onClick={onClose} aria-label="Close dialog" className="p-1 rounded text-slate-500 hover:bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 max-h-[75vh] overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50 rounded-b-lg">{footer}</div>}
      </div>
    </div>
  );
};

export const ConfirmDialog: React.FC<{
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ title, message, confirmLabel, danger, busy, onConfirm, onCancel }) => (
  <Modal
    title={title}
    size="sm"
    onClose={onCancel}
    footer={
      <>
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
      </>
    }
  >
    <p className="text-sm text-slate-700">{message}</p>
  </Modal>
);

/** Key/value line used in summaries (invoice totals, review step). */
export const Row: React.FC<{ label: React.ReactNode; value: React.ReactNode; strong?: boolean; tone?: Tone; className?: string }> = ({ label, value, strong, tone = 'default', className }) => (
  <div className={cx('flex justify-between gap-6 text-sm', strong ? 'font-semibold' : 'text-slate-600', className)}>
    <span>{label}</span>
    <span className={cx('tabular-nums', TONE_TEXT[tone] !== TONE_TEXT.default && TONE_TEXT[tone])}>{value}</span>
  </div>
);
