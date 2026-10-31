import React, { useState, useEffect, useRef } from 'react';
import { api, getCurrentUser } from '../services/api.js';
import { Invoice } from '../types.js';
import Pager, { PageInfo } from '../components/Pager.js';
import {
  Alert, Button, Card, ConfirmDialog, EmptyState, ErrorState, Input, Loading, Modal, PageHeader, Select, StatusBadge, table, useToast, cx
} from '../components/ui.js';
import { formatDate, formatMoney } from '../lib/format.js';
import { BellRing, Download, Printer, Send } from 'lucide-react';

interface InvoicesProps {
  initialInvoiceId?: number | null;
}

const METHODS = ['Bank Transfer', 'Credit Card', 'UPI', 'Cash', 'Cheque'] as const;
const FILTERS = ['All', 'Draft', 'Confirmed', 'Paid', 'Cancelled'] as const;

const balanceOf = (inv: Invoice) => inv.balance_due ?? Number((inv.total_amount - inv.amount_paid).toFixed(2));
const isPartial = (inv: Invoice) => inv.amount_paid > 0 && balanceOf(inv) > 0;

export const Invoices: React.FC<InvoicesProps> = ({ initialInvoiceId }) => {
  const toast = useToast();
  const user = getCurrentUser();
  const isStaff = user?.role === 'admin' || user?.role === 'staff';

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<(typeof FILTERS)[number]>('All');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<Invoice | null>(null);
  const [payTarget, setPayTarget] = useState<Invoice | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<(typeof METHODS)[number]>('Bank Transfer');
  const [payDate, setPayDate] = useState('');
  const [payRef, setPayRef] = useState('');
  const [payNote, setPayNote] = useState('');
  const [payError, setPayError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Invoice | null>(null);

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
      setError('Unable to load invoices. ' + err.message);
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

  const viewInvoice = async (id: number) => {
    try {
      setDetail((await api.getInvoice(id)).invoice);
    } catch (err: any) {
      toast('error', 'Unable to open the invoice. ' + err.message);
    }
  };

  const confirmInvoice = async (inv: Invoice) => {
    setBusyId(inv.id);
    try {
      await api.updateInvoiceStatus(inv.id, 'Confirmed');
      toast('success', `${inv.invoice_number} confirmed.`);
      await loadInvoices();
      if (detail?.id === inv.id) await viewInvoice(inv.id);
    } catch (err: any) {
      toast('error', err.message);
    } finally {
      setBusyId(null);
    }
  };

  const cancelInvoice = async () => {
    if (!cancelTarget) return;
    setBusyId(cancelTarget.id);
    try {
      await api.updateInvoiceStatus(cancelTarget.id, 'Cancelled');
      toast('success', `${cancelTarget.invoice_number} cancelled.`);
      setCancelTarget(null);
      setDetail(null);
      await loadInvoices();
    } catch (err: any) {
      setCancelTarget(null);
      toast('error', err.message);
    } finally {
      setBusyId(null);
    }
  };

  const sendInvoice = async (inv: Invoice) => {
    setBusyId(inv.id);
    try {
      toast('success', (await api.sendInvoice(inv.id)).message);
    } catch (err: any) {
      toast('error', err.message);
    } finally {
      setBusyId(null);
    }
  };

  const remindInvoice = async (inv: Invoice) => {
    setBusyId(inv.id);
    try {
      toast('success', (await api.remindInvoice(inv.id)).message);
    } catch (err: any) {
      toast('error', err.message);
    } finally {
      setBusyId(null);
    }
  };

  const openPay = (inv: Invoice) => {
    setPayTarget(inv);
    setPayAmount(String(balanceOf(inv)));
    setPayDate(new Date().toISOString().slice(0, 10));
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
        payment_date: payDate || undefined,
        reference: payRef || undefined,
        note: payNote || undefined
      });
      const p = res.payment;
      toast('success', `Paid ${formatMoney(p.amountPaid)} of ${formatMoney(p.totalAmount)}. Outstanding ${formatMoney(p.balanceRemaining)}. Status: ${String(p.status).toUpperCase()}.`);
      setPayTarget(null);
      setDetail(null);
      await loadInvoices();
    } catch (err: any) {
      setPayError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const downloadCsv = async () => {
    try {
      await api.downloadCsv('invoices');
    } catch (err: any) {
      toast('error', err.message);
    }
  };

  const hasFilters = statusFilter !== 'All' || overdueOnly || !!search;
  const canPay = (inv: Invoice) => isStaff && inv.status === 'Confirmed' && balanceOf(inv) > 0;

  return (
    <div>
      <PageHeader
        title={isStaff ? 'Invoices' : 'My invoices'}
        subtitle={isStaff ? 'Confirm invoices, record payments and chase overdue balances' : `Invoices for ${user?.email}`}
        actions={isStaff && <Button onClick={downloadCsv}><Download className="w-3.5 h-3.5" aria-hidden="true" /> Export CSV</Button>}
      />

      {error && <div className="mb-4"><Alert kind="error" onClose={() => setError(null)}>{error}</Alert></div>}

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-3">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by status">
          {FILTERS.map(st => (
            <Button key={st} size="sm" variant={statusFilter === st && !overdueOnly ? 'primary' : 'secondary'} aria-pressed={statusFilter === st && !overdueOnly} onClick={() => { setStatusFilter(st); setOverdueOnly(false); }}>
              {st}
            </Button>
          ))}
          {isStaff && (
            <Button size="sm" variant={overdueOnly ? 'danger' : 'secondary'} aria-pressed={overdueOnly} onClick={() => { setOverdueOnly(!overdueOnly); setStatusFilter('All'); }}>
              Overdue
            </Button>
          )}
        </div>
        <div className="w-full lg:w-72">
          <Input label="Search" type="search" value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Invoice number, e.g. INV-2026-0001" hint={undefined} />
        </div>
      </div>

      <Card flush>
        {loading ? (
          <Loading label="Loading invoices…" />
        ) : error && invoices.length === 0 ? (
          <ErrorState message="Unable to load invoices." onRetry={loadInvoices} />
        ) : invoices.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No invoices match these filters' : 'No invoices yet'}
            hint={hasFilters ? 'Clear the filters to see every invoice.' : isStaff ? 'Run billing to create the first invoices.' : 'Invoices appear here once your subscription has been billed.'}
          />
        ) : (
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Invoice</th>
                  {isStaff && <th className={table.th}>Customer</th>}
                  <th className={table.th}>Billing period</th>
                  <th className={table.th}>Due</th>
                  <th className={table.thNum}>Total</th>
                  <th className={table.thNum}>Paid</th>
                  <th className={table.thNum}>Outstanding</th>
                  <th className={table.th}>Status</th>
                  <th className={table.thNum}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className={table.body}>
                {invoices.map(inv => {
                  const balance = balanceOf(inv);
                  const busy = busyId === inv.id;
                  return (
                    <tr key={inv.id} className={table.row}>
                      <td className={table.td}>
                        <button onClick={() => viewInvoice(inv.id)} className="font-medium text-brand-700 hover:underline whitespace-nowrap">{inv.invoice_number}</button>
                        <div className="text-xs text-slate-500 whitespace-nowrap">{inv.subscription_number}</div>
                      </td>
                      {isStaff && (
                        <td className={table.td}>
                          <div className="text-slate-900">{inv.customer_name}</div>
                          <div className="text-xs text-slate-500">{inv.company_name}</div>
                        </td>
                      )}
                      <td className={table.td + ' whitespace-nowrap text-slate-600'}>{formatDate(inv.period_start)} to {formatDate(inv.period_end)}</td>
                      <td className={table.td + ' whitespace-nowrap ' + (inv.is_overdue ? 'text-red-700 font-medium' : 'text-slate-600')}>{formatDate(inv.due_date)}</td>
                      <td className={table.tdNum + ' font-medium'}>{formatMoney(inv.total_amount)}</td>
                      <td className={table.tdNum}>{formatMoney(inv.amount_paid)}</td>
                      <td className={table.tdNum + (balance > 0 && inv.status !== 'Cancelled' ? ' text-amber-800 font-medium' : ' text-slate-400')}>
                        {inv.status === 'Cancelled' ? '—' : formatMoney(balance)}
                      </td>
                      <td className={table.td}>
                        <StatusBadge status={inv.status} overdue={!!inv.is_overdue} partial={isPartial(inv)} />
                      </td>
                      <td className={table.tdNum}>
                        <div className="flex justify-end gap-1.5">
                          {isStaff && inv.status === 'Draft' && <Button size="sm" loading={busy} onClick={() => confirmInvoice(inv)}>Confirm</Button>}
                          {canPay(inv) && <Button size="sm" variant="primary" disabled={busy} onClick={() => openPay(inv)}>Record payment</Button>}
                          <Button size="sm" onClick={() => viewInvoice(inv.id)}>View</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager info={pageInfo} onPage={setPage} />
      </Card>

      {/* Invoice document */}
      {detail && (
        <Modal
          title={`Invoice ${detail.invoice_number}`}
          size="xl"
          onClose={() => setDetail(null)}
          footer={
            <>
              <Button onClick={() => window.print()}><Printer className="w-3.5 h-3.5" aria-hidden="true" /> Print / PDF</Button>
              {isStaff && detail.status !== 'Draft' && detail.status !== 'Cancelled' && <Button loading={busyId === detail.id} onClick={() => sendInvoice(detail)}><Send className="w-3.5 h-3.5" aria-hidden="true" /> Send to customer</Button>}
              {isStaff && detail.status === 'Confirmed' && detail.amount_paid < detail.total_amount && <Button loading={busyId === detail.id} onClick={() => remindInvoice(detail)}><BellRing className="w-3.5 h-3.5" aria-hidden="true" /> Send reminder</Button>}
              {isStaff && ['Draft', 'Confirmed'].includes(detail.status) && detail.amount_paid === 0 && <Button variant="danger" onClick={() => setCancelTarget(detail)}>Cancel invoice</Button>}
              {isStaff && detail.status === 'Draft' && <Button variant="primary" loading={busyId === detail.id} onClick={() => confirmInvoice(detail)}>Confirm invoice</Button>}
              {canPay(detail) && <Button variant="primary" onClick={() => openPay(detail)}>Record payment</Button>}
            </>
          }
        >
          <div className="flex flex-col sm:flex-row sm:justify-between gap-4 pb-4 border-b border-slate-200">
            <div className="text-sm">
              <div className="text-xs font-medium text-slate-500 mb-1">Billed to</div>
              <div className="font-semibold text-slate-900">{detail.customer_name}</div>
              {detail.company_name && <div className="text-slate-700">{detail.company_name}</div>}
              <div className="text-slate-500">{detail.customer_email}</div>
            </div>
            <dl className="text-sm grid grid-cols-[auto_auto] gap-x-4 gap-y-1 sm:text-right">
              <dt className="text-slate-500">Status</dt>
              <dd><StatusBadge status={detail.status} overdue={!!detail.is_overdue} partial={isPartial(detail)} /></dd>
              <dt className="text-slate-500">Subscription</dt>
              <dd className="font-medium">{detail.subscription_number}</dd>
              <dt className="text-slate-500">Billing period</dt>
              <dd>{formatDate(detail.period_start)} to {formatDate(detail.period_end)}</dd>
              <dt className="text-slate-500">Issued</dt>
              <dd>{formatDate(detail.issue_date)}</dd>
              <dt className="text-slate-500">Due</dt>
              <dd className={detail.is_overdue ? 'text-red-700 font-medium' : ''}>{formatDate(detail.due_date)}</dd>
            </dl>
          </div>

          <div className={table.wrap + ' mt-4 border border-slate-200 rounded-md'}>
            <table className={table.table + ' min-w-[640px]'}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Item</th>
                  <th className={table.thNum}>Qty</th>
                  <th className={table.thNum}>Unit price</th>
                  <th className={table.thNum}>Discount</th>
                  <th className={table.thNum}>Tax</th>
                  <th className={table.thNum}>Line total</th>
                </tr>
              </thead>
              <tbody className={table.body}>
                {detail.lines?.map(l => (
                  <tr key={l.id}>
                    <td className={table.td}>{l.description}</td>
                    <td className={table.tdNum}>{l.quantity}</td>
                    <td className={table.tdNum}>{formatMoney(l.unit_price)}</td>
                    <td className={table.tdNum}>{l.discount_amount ? `−${formatMoney(l.discount_amount)}` : '—'}</td>
                    <td className={table.tdNum}>
                      {formatMoney(l.tax_amount)}
                      {l.tax_rate !== undefined && <div className="text-xs text-slate-500">{l.tax_rate}%</div>}
                    </td>
                    <td className={table.tdNum + ' font-medium'}>{formatMoney(l.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end mt-4">
            <dl className="w-full sm:w-80 text-sm space-y-1">
              <Line label="Subtotal" value={formatMoney(detail.subtotal)} />
              {detail.discount_amount > 0 && (
                <Line label={`Discount${detail.discounts?.length ? ` (${detail.discounts.map(d => d.code).join(', ')})` : ''}`} value={`−${formatMoney(detail.discount_amount)}`} />
              )}
              <Line label="Tax" value={`+${formatMoney(detail.tax_amount)}`} />
              <Line label="Total" value={formatMoney(detail.total_amount)} strong className="border-t border-slate-300 pt-1.5 mt-1.5 text-base" />
              <Line label="Paid" value={`−${formatMoney(detail.amount_paid)}`} />
              <Line
                label="Outstanding"
                value={formatMoney(balanceOf(detail))}
                strong
                className={cx('border-t border-slate-300 pt-1.5 mt-1.5', balanceOf(detail) > 0 && detail.status !== 'Cancelled' ? 'text-amber-800' : 'text-emerald-700')}
              />
            </dl>
          </div>

          {detail.payments && detail.payments.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Payments received</h3>
              <div className={table.wrap + ' border border-slate-200 rounded-md'}>
                <table className={table.table}>
                  <thead className={table.head}>
                    <tr>
                      <th className={table.th}>Date</th>
                      <th className={table.th}>Method</th>
                      <th className={table.th}>Reference / note</th>
                      <th className={table.thNum}>Amount</th>
                    </tr>
                  </thead>
                  <tbody className={table.body}>
                    {detail.payments.map(p => (
                      <tr key={p.id}>
                        <td className={table.td + ' whitespace-nowrap'}>{formatDate(p.payment_date)}</td>
                        <td className={table.td}>{p.payment_method}</td>
                        <td className={table.td + ' text-slate-600'}>{[p.reference, p.note].filter(Boolean).join(' · ') || '—'}</td>
                        <td className={table.tdNum + ' font-medium'}>{formatMoney(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Record payment */}
      {payTarget && (
        <Modal
          title="Record payment"
          size="md"
          onClose={() => !submitting && setPayTarget(null)}
          footer={
            <>
              <Button onClick={() => setPayTarget(null)} disabled={submitting}>Cancel</Button>
              <Button variant="primary" type="submit" form="payment-form" loading={submitting} disabled={!payAmount.trim()}>
                {submitting ? 'Recording…' : 'Record payment'}
              </Button>
            </>
          }
        >
          <dl className="rounded-md border border-slate-200 bg-slate-50 p-3 mb-4 text-sm space-y-1">
            <Line label="Invoice" value={payTarget.invoice_number} />
            <Line label="Total" value={formatMoney(payTarget.total_amount)} />
            <Line label="Already paid" value={formatMoney(payTarget.amount_paid)} />
            <Line label="Outstanding" value={formatMoney(balanceOf(payTarget))} strong className="text-amber-800" />
          </dl>

          {payError && <div className="mb-3"><Alert kind="error">{payError}</Alert></div>}

          <form id="payment-form" onSubmit={submitPayment} className="space-y-3">
            <div className="flex items-end gap-2">
              <Input label="Payment amount (INR)" required inputMode="decimal" value={payAmount} onChange={e => setPayAmount(e.target.value)} wrapperClassName="flex-1" hint="Enter less than the outstanding amount for a partial payment." />
              <Button size="sm" onClick={() => setPayAmount(String(balanceOf(payTarget)))} className="mb-6">Full balance</Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select label="Payment method" required value={payMethod} onChange={e => setPayMethod(e.target.value as (typeof METHODS)[number])}>
                {METHODS.map(m => <option key={m}>{m}</option>)}
              </Select>
              <Input label="Payment date" type="date" required value={payDate} onChange={e => setPayDate(e.target.value)} />
            </div>
            <Input label="Reference" value={payRef} onChange={e => setPayRef(e.target.value)} placeholder="Transaction or cheque number" />
            <Input label="Note" value={payNote} onChange={e => setPayNote(e.target.value)} />
          </form>
        </Modal>
      )}

      {cancelTarget && (
        <ConfirmDialog
          title="Cancel this invoice?"
          message={`Invoice ${cancelTarget.invoice_number} will be cancelled. Its billing period is kept and will not be invoiced again.`}
          confirmLabel="Cancel invoice"
          danger
          busy={busyId === cancelTarget.id}
          onConfirm={cancelInvoice}
          onCancel={() => setCancelTarget(null)}
        />
      )}
    </div>
  );
};

const Line: React.FC<{ label: string; value: string; strong?: boolean; className?: string }> = ({ label, value, strong, className }) => (
  <div className={cx('flex justify-between gap-6', strong ? 'font-semibold text-slate-900' : 'text-slate-600', className)}>
    <dt>{label}</dt>
    <dd className="tabular-nums">{value}</dd>
  </div>
);
