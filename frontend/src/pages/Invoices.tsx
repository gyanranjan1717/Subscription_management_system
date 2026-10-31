import React, { useState, useEffect, useRef } from 'react';
import { api, getCurrentUser } from '../services/api.js';
import { Invoice } from '../types.js';
import Pager, { PageInfo } from '../components/Pager.js';
import { Alert, EmptyState, Loading, StatusBadge } from '../components/ui.js';
import { formatMoney } from '../lib/format.js';
import { AlertTriangle, Eye, Printer, Send, DollarSign, Download } from 'lucide-react';

interface InvoicesProps {
  initialInvoiceId?: number | null;
}

const METHODS = ['Bank Transfer', 'Credit Card', 'UPI', 'Cash', 'Cheque'] as const;

export const Invoices: React.FC<InvoicesProps> = ({ initialInvoiceId }) => {
  const user = getCurrentUser();
  const isStaff = user?.role === 'admin' || user?.role === 'staff';

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('All');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [detail, setDetail] = useState<Invoice | null>(null);
  const [payTarget, setPayTarget] = useState<Invoice | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<(typeof METHODS)[number]>('Bank Transfer');
  const [payRef, setPayRef] = useState('');
  const [payNote, setPayNote] = useState('');
  const [payError, setPayError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Debounce the server-side search (invoice-number prefix).
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadInvoices = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getInvoices({ status: statusFilter, overdue: overdueOnly, page, q: search || undefined });
      setInvoices(res.invoices);
      setPageInfo(res.pagination);
    } catch (err: any) {
      setError('Could not load invoices: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // One request per change: a new filter returns to page 1 instead of fetching the stale page first.
  const filterKey = `${statusFilter}|${overdueOnly}|${search}`;
  const lastFilterKey = useRef(filterKey);
  useEffect(() => {
    if (lastFilterKey.current !== filterKey) {
      lastFilterKey.current = filterKey;
      if (page !== 1) {
        setPage(1);
        return;
      }
    }
    loadInvoices();
  }, [filterKey, page]);

  useEffect(() => {
    if (initialInvoiceId) viewInvoice(initialInvoiceId);
  }, [initialInvoiceId]);

  const flash = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 6000);
  };

  const viewInvoice = async (id: number) => {
    try {
      setDetail((await api.getInvoice(id)).invoice);
    } catch (err: any) {
      setError('Could not open the invoice: ' + err.message);
    }
  };

  const changeStatus = async (inv: Invoice, status: 'Confirmed' | 'Cancelled') => {
    if (status === 'Cancelled' && !window.confirm(`Cancel invoice ${inv.invoice_number}? A cancelled period is never billed again.`)) return;
    setBusyId(inv.id);
    setError(null);
    try {
      await api.updateInvoiceStatus(inv.id, status);
      flash(`Invoice ${inv.invoice_number} is now ${status}.`);
      await loadInvoices();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const sendInvoice = async (inv: Invoice) => {
    setBusyId(inv.id);
    try {
      flash((await api.sendInvoice(inv.id)).message);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const openPay = (inv: Invoice) => {
    setPayTarget(inv);
    setPayAmount(String(inv.balance_due ?? Number((inv.total_amount - inv.amount_paid).toFixed(2))));
    setPayRef('');
    setPayNote('');
    setPayError(null);
  };

  const submitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payTarget) return;
    setSubmitting(true);
    setPayError(null);
    try {
      const res = await api.recordPayment({
        invoice_id: payTarget.id,
        amount: payAmount.trim(),
        payment_method: payMethod,
        reference: payRef || undefined,
        note: payNote || undefined
      });
      const p = res.payment;
      flash(
        `Recorded on ${p.invoiceNumber}. Paid ${formatMoney(p.amountPaid)} of ${formatMoney(p.totalAmount)}, outstanding ${formatMoney(p.balanceRemaining)}. Status: ${p.status.toUpperCase()}.`
      );
      setPayTarget(null);
      setDetail(null);
      await loadInvoices();
    } catch (err: any) {
      setPayError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const balanceOf = (inv: Invoice) => inv.balance_due ?? Number((inv.total_amount - inv.amount_paid).toFixed(2));
  const downloadCsv = async () => {
    try {
      await api.downloadCsv('invoices');
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{isStaff ? 'Invoices & Payments' : 'My Invoices'}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {isStaff
              ? 'Confirm invoices, record partial or full payments and chase overdue balances.'
              : `Invoices for ${user?.email}. You can only see your own.`}
          </p>
        </div>
        {isStaff && (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={downloadCsv} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
            <button
              onClick={() => { setOverdueOnly(!overdueOnly); setStatusFilter('All'); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 ${
                overdueOnly ? 'bg-red-100 text-red-900 border-red-300' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-red-600" /> Overdue only
            </button>
          </div>
        )}
      </div>

      {error && <Alert kind="error" onClose={() => setError(null)}>{error}</Alert>}
      {feedback && <Alert kind="success" onClose={() => setFeedback(null)}>{feedback}</Alert>}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {['All', 'Draft', 'Confirmed', 'Paid', 'Cancelled'].map(st => (
            <button
              key={st}
              onClick={() => { setStatusFilter(st); setOverdueOnly(false); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${
                statusFilter === st && !overdueOnly ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Invoice number starts with…"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          className="w-full sm:w-64 px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-odoo-500"
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <Loading label="Loading invoices…" />
        ) : invoices.length === 0 ? (
          <EmptyState
            title="No invoices match"
            hint={isStaff ? 'Run billing from the Billing Run page to create invoices.' : 'Invoices appear here after your subscription is billed.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Invoice</th>
                  {isStaff && <th className="px-4 py-3 hidden md:table-cell">Customer</th>}
                  <th className="px-4 py-3 hidden lg:table-cell">Period</th>
                  <th className="px-4 py-3 hidden sm:table-cell">Due</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3 text-right">Outstanding</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map(inv => {
                  const balance = balanceOf(inv);
                  const busy = busyId === inv.id;
                  return (
                    <tr key={inv.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <button onClick={() => viewInvoice(inv.id)} className="font-semibold text-odoo-500 hover:underline flex items-center gap-1.5 whitespace-nowrap">
                          <Eye className="w-3.5 h-3.5 text-slate-400" /> {inv.invoice_number}
                        </button>
                        <div className="text-[11px] text-slate-400">{inv.subscription_number}</div>
                      </td>
                      {isStaff && (
                        <td className="px-4 py-3 hidden md:table-cell">
                          <div className="font-medium text-slate-900">{inv.customer_name}</div>
                          <div className="text-xs text-slate-400">{inv.company_name}</div>
                        </td>
                      )}
                      <td className="px-4 py-3 text-xs font-mono text-slate-600 hidden lg:table-cell">{inv.period_start} → {inv.period_end}</td>
                      <td className={`px-4 py-3 text-xs hidden sm:table-cell ${inv.is_overdue ? 'text-red-600 font-bold' : 'text-slate-600'}`}>{inv.due_date}</td>
                      <td className="px-4 py-3 text-right font-bold">{formatMoney(inv.total_amount)}</td>
                      <td className="px-4 py-3 text-right text-emerald-700 font-medium">{formatMoney(inv.amount_paid)}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${balance > 0 && inv.status !== 'Cancelled' ? 'text-amber-700' : 'text-slate-400'}`}>
                        {inv.status === 'Cancelled' ? '—' : formatMoney(balance)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={inv.status} overdue={!!inv.is_overdue} partial={inv.amount_paid > 0 && balance > 0} />
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap space-x-1">
                        {isStaff && inv.status === 'Draft' && (
                          <button disabled={busy} onClick={() => changeStatus(inv, 'Confirmed')} className="px-2 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded text-xs font-semibold disabled:opacity-50">
                            Confirm
                          </button>
                        )}
                        {isStaff && inv.status === 'Confirmed' && balance > 0 && (
                          <button disabled={busy} onClick={() => openPay(inv)} className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50">
                            <DollarSign className="w-3 h-3" /> Pay
                          </button>
                        )}
                        {isStaff && ['Draft', 'Confirmed'].includes(inv.status) && inv.amount_paid === 0 && (
                          <button disabled={busy} onClick={() => changeStatus(inv, 'Cancelled')} className="px-2 py-1 bg-red-50 text-red-700 hover:bg-red-100 rounded text-xs font-semibold disabled:opacity-50">
                            Cancel
                          </button>
                        )}
                        <button onClick={() => viewInvoice(inv.id)} className="px-2 py-1 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded text-xs font-semibold inline-flex items-center gap-1">
                          <Printer className="w-3 h-3" /> View
                        </button>
                        {isStaff && (
                          <button disabled={busy} onClick={() => sendInvoice(inv)} className="px-2 py-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50">
                            <Send className="w-3 h-3" /> Send
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager info={pageInfo} onPage={setPage} />
      </div>

      {/* Invoice document */}
      {detail && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto print:static print:bg-white print:p-0">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full p-4 sm:p-8 border border-slate-200 my-4">
            <div className="flex justify-between items-start border-b border-slate-200 pb-4 gap-3">
              <div>
                <div className="text-xl font-black text-slate-900 uppercase tracking-tight">Brightloop Software</div>
                <div className="text-xs text-slate-500">billing@brightloop.com</div>
              </div>
              <div className="flex items-center gap-2 print:hidden">
                {isStaff && detail.status === 'Confirmed' && balanceOf(detail) > 0 && (
                  <button onClick={() => openPay(detail)} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold">
                    Record payment
                  </button>
                )}
                <button onClick={() => window.print()} className="px-3 py-1.5 bg-odoo-500 hover:bg-odoo-600 text-white rounded text-xs font-semibold flex items-center gap-1">
                  <Printer className="w-3.5 h-3.5" /> Print / PDF
                </button>
                <button onClick={() => setDetail(null)} aria-label="Close" className="text-slate-400 hover:text-slate-700 font-bold text-lg px-1">✕</button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-5 text-xs">
              <div>
                <span className="text-slate-400 uppercase font-bold text-[10px] block">Billed to</span>
                <div className="font-bold text-slate-900 text-sm mt-0.5">{detail.customer_name}</div>
                <div className="text-slate-600">{detail.company_name}</div>
                <div className="text-slate-500">{detail.customer_email}</div>
              </div>
              <div className="sm:text-right space-y-0.5">
                <div className="text-lg font-black text-odoo-500">{detail.invoice_number}</div>
                <div><StatusBadge status={detail.status} overdue={!!detail.is_overdue} partial={detail.amount_paid > 0 && balanceOf(detail) > 0} /></div>
                <div className="text-slate-600">Subscription: <strong>{detail.subscription_number}</strong></div>
                <div className="text-slate-600">Billing period: <strong>{detail.period_start} → {detail.period_end}</strong></div>
                <div className="text-slate-600">Issued: <strong>{detail.issue_date}</strong> · Due: <strong>{detail.due_date}</strong></div>
              </div>
            </div>

            <div className="border border-slate-200 rounded-lg overflow-x-auto text-xs">
              <table className="w-full text-left min-w-[560px]">
                <thead className="bg-slate-50 border-b border-slate-200 font-bold text-slate-700">
                  <tr>
                    <th className="p-2.5">Item</th>
                    <th className="p-2.5 text-center">Qty</th>
                    <th className="p-2.5 text-right">Unit price</th>
                    <th className="p-2.5 text-right">Discount</th>
                    <th className="p-2.5 text-right">Tax</th>
                    <th className="p-2.5 text-right">Line total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detail.lines?.map(l => (
                    <tr key={l.id}>
                      <td className="p-2.5 font-medium text-slate-800">{l.description}</td>
                      <td className="p-2.5 text-center">{l.quantity}</td>
                      <td className="p-2.5 text-right font-mono">{formatMoney(l.unit_price)}</td>
                      <td className="p-2.5 text-right font-mono">{l.discount_amount ? `-${formatMoney(l.discount_amount)}` : '—'}</td>
                      <td className="p-2.5 text-right font-mono">
                        {formatMoney(l.tax_amount)}
                        {l.tax_rate !== undefined && <div className="text-[10px] text-slate-400">{l.tax_rate}%</div>}
                      </td>
                      <td className="p-2.5 text-right font-mono font-semibold">{formatMoney(l.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end my-4 text-xs">
              <div className="w-full sm:w-72 space-y-1.5">
                <Row label="Subtotal" value={formatMoney(detail.subtotal)} />
                {detail.discount_amount > 0 && (
                  <Row
                    label={`Discount${detail.discounts?.length ? ` (${detail.discounts.map(d => d.code).join(', ')})` : ''}`}
                    value={`-${formatMoney(detail.discount_amount)}`}
                    className="text-purple-700 font-semibold"
                  />
                )}
                <Row label="Tax" value={formatMoney(detail.tax_amount)} />
                <Row label="Total" value={formatMoney(detail.total_amount)} className="text-base font-black text-slate-900 border-t border-slate-200 pt-2" />
                <Row label="Paid" value={formatMoney(detail.amount_paid)} className="font-bold text-emerald-700" />
                <Row label="Outstanding" value={formatMoney(balanceOf(detail))} className={`font-bold ${balanceOf(detail) > 0 ? 'text-amber-700' : 'text-emerald-700'}`} />
              </div>
            </div>

            {detail.payments && detail.payments.length > 0 && (
              <div className="border-t border-slate-200 pt-4">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">Payments received</h4>
                <div className="space-y-1 text-xs">
                  {detail.payments.map(p => (
                    <div key={p.id} className="p-2 bg-emerald-50 text-emerald-950 rounded flex justify-between items-center gap-2">
                      <div>
                        <span className="font-bold">{p.payment_method}</span> · {p.payment_date}
                        {p.reference && <span className="text-slate-600"> · {p.reference}</span>}
                        {p.note && <span className="text-emerald-800"> — {p.note}</span>}
                      </div>
                      <span className="font-mono font-bold">{formatMoney(p.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Record payment */}
      {payTarget && (
        <div className="fixed inset-0 bg-slate-900/60 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-slate-200 max-h-[95vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-lg">Record payment</h3>
              <button onClick={() => setPayTarget(null)} aria-label="Close" className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>
            <form onSubmit={submitPayment} className="mt-4 space-y-4 text-sm">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs space-y-1">
                <Row label="Invoice" value={payTarget.invoice_number} />
                <Row label="Total" value={formatMoney(payTarget.total_amount)} />
                <Row label="Already paid" value={formatMoney(payTarget.amount_paid)} className="text-emerald-700" />
                <Row label="Outstanding" value={formatMoney(balanceOf(payTarget))} className="font-bold text-amber-700" />
              </div>

              {payError && <Alert kind="error">{payError}</Alert>}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="pay-amount">Amount</label>
                <div className="flex gap-2">
                  <input
                    id="pay-amount"
                    inputMode="decimal"
                    required
                    value={payAmount}
                    onChange={e => setPayAmount(e.target.value)}
                    placeholder="0.00"
                    className="flex-1 border border-slate-300 rounded-lg p-2 font-mono font-bold"
                  />
                  <button type="button" onClick={() => setPayAmount(String(balanceOf(payTarget)))} className="px-3 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50">
                    Full balance
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Pay less than the outstanding amount for a partial payment. The server rejects overpayment.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="pay-method">Method</label>
                <select id="pay-method" value={payMethod} onChange={e => setPayMethod(e.target.value as any)} className="w-full border border-slate-300 rounded-lg p-2 bg-white">
                  {METHODS.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <input value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="Reference (optional)" className="w-full border border-slate-300 rounded-lg p-2" />
              <input value={payNote} onChange={e => setPayNote(e.target.value)} placeholder="Note (optional)" className="w-full border border-slate-300 rounded-lg p-2" />

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button type="button" onClick={() => setPayTarget(null)} className="px-4 py-2 border border-slate-300 rounded-lg font-semibold hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={submitting || !payAmount.trim()} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold disabled:opacity-50">
                  {submitting ? 'Recording…' : 'Record payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

const Row: React.FC<{ label: string; value: string; className?: string }> = ({ label, value, className = '' }) => (
  <div className={`flex justify-between gap-4 text-slate-600 ${className}`}>
    <span>{label}</span>
    <span className="font-mono">{value}</span>
  </div>
);
