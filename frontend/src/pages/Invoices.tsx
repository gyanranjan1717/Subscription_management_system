import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api.js';
import Pager, { PageInfo } from '../components/Pager.js';
import { Invoice } from '../types.js';
import {
  CreditCard, Printer, Send, DollarSign, CheckCircle2,
  AlertTriangle, Eye, Filter, RefreshCw, X
} from 'lucide-react';

interface InvoicesProps {
  initialInvoiceId?: number | null;
}

export const Invoices: React.FC<InvoicesProps> = ({ initialInvoiceId }) => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('All');
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  // Modal states
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [targetInvoice, setTargetInvoice] = useState<Invoice | null>(null);

  // Payment form states
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<'Bank Transfer' | 'Credit Card' | 'UPI' | 'Cash' | 'Cheque'>('Bank Transfer');
  const [paymentRef, setPaymentRef] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadInvoices = async () => {
    setLoading(true);
    try {
      const res = await api.getInvoices({
        status: statusFilter,
        overdue: overdueOnly,
        page
      });
      setInvoices(res.invoices);
      setPageInfo(res.pagination);
      if (initialInvoiceId) {
        viewInvoice(initialInvoiceId);
      }
    } catch (err: any) {
      alert('Error fetching invoices: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // One request per change: a new filter goes back to page 1 instead of fetching the stale page first.
  const filterKey = `${statusFilter}|${overdueOnly}`;
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

  const viewInvoice = async (id: number) => {
    try {
      const res = await api.getInvoice(id);
      setSelectedInvoice(res.invoice);
      setTargetInvoice(res.invoice);
      setPrintModalOpen(true);
    } catch (err: any) {
      alert('Error loading invoice details: ' + err.message);
    }
  };

  const handleConfirmInvoice = async (id: number) => {
    try {
      await api.updateInvoiceStatus(id, 'Confirmed');
      setFeedback(`Invoice #${id} confirmed.`);
      setTimeout(() => setFeedback(null), 3000);
      loadInvoices();
    } catch (err: any) {
      alert('Failed to confirm: ' + err.message);
    }
  };

  const handleCancelInvoice = async (id: number) => {
    if (!confirm('Are you sure you want to cancel this invoice?')) return;
    try {
      await api.updateInvoiceStatus(id, 'Cancelled');
      setFeedback(`Invoice #${id} cancelled.`);
      setTimeout(() => setFeedback(null), 3000);
      loadInvoices();
    } catch (err: any) {
      alert('Failed to cancel: ' + err.message);
    }
  };

  const handleSendInvoice = async (id: number) => {
    try {
      const res = await api.sendInvoice(id);
      setFeedback(res.message);
      setTimeout(() => setFeedback(null), 4000);
    } catch (err: any) {
      alert('Failed to send invoice: ' + err.message);
    }
  };

  const openPaymentModal = (inv: Invoice) => {
    setTargetInvoice(inv);
    const balance = Number((inv.total_amount - inv.amount_paid).toFixed(2));
    setPaymentAmount(balance > 0 ? balance : 0);
    setPaymentRef(`TXN-${Date.now().toString().slice(-6)}`);
    setPaymentNote('Settlement payment');
    setPaymentModalOpen(true);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetInvoice) return;
    setSubmittingPayment(true);
    try {
      const res = await api.recordPayment({
        invoice_id: targetInvoice.id,
        amount: Number(paymentAmount),
        payment_method: paymentMethod,
        reference: paymentRef,
        note: paymentNote
      });
      setFeedback(`Payment of $${paymentAmount} recorded! Status is now: ${res.payment.status}`);
      setTimeout(() => setFeedback(null), 4000);
      setPaymentModalOpen(false);
      loadInvoices();
    } catch (err: any) {
      alert('Payment recording failed: ' + err.message);
    } finally {
      setSubmittingPayment(false);
    }
  };

  const getStatusBadge = (status: string, isOverdue?: number) => {
    if (status === 'Paid') {
      return <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">Paid</span>;
    }
    if (isOverdue) {
      return <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800">Overdue</span>;
    }
    if (status === 'Confirmed') {
      return <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800">Confirmed</span>;
    }
    if (status === 'Draft') {
      return <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-800">Draft</span>;
    }
    return <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-gray-100 text-gray-800">{status}</span>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Invoice Ledger & Payments</h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage recurring invoices, track outstanding balances, dispatch notices, and record payments.
          </p>
        </div>

        {/* Filters & Export */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => window.open('/api/analytics/export/invoices', '_blank')}
            className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
          >
            Export CSV
          </button>

          <button
            onClick={() => setOverdueOnly(!overdueOnly)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors flex items-center gap-1.5 ${
              overdueOnly
                ? 'bg-amber-100 text-amber-900 border-amber-300'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            Overdue Only
          </button>
        </div>
      </div>

      {feedback && (
        <div className="bg-emerald-50 border border-emerald-300 text-emerald-950 px-4 py-3 rounded-lg text-sm flex items-center justify-between shadow-sm">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" /> {feedback}
          </span>
          <button onClick={() => setFeedback(null)} className="text-emerald-800 font-bold">×</button>
        </div>
      )}

      {/* Status Tabs & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {['All', 'Confirmed', 'Paid', 'Draft', 'Cancelled'].map(st => (
            <button
              key={st}
              onClick={() => { setStatusFilter(st); setOverdueOnly(false); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                statusFilter === st && !overdueOnly
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        <div className="w-full sm:w-64">
          <input
            type="text"
            placeholder="Search invoice #, customer..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-odoo-500"
          />
        </div>
      </div>

      {/* Invoice Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Invoice #</th>
                <th className="px-4 py-3">Customer / Company</th>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Due Date</th>
                <th className="px-4 py-3 text-right">Total Amount</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices
                .filter(inv => {
                  if (!searchTerm) return true;
                  const term = searchTerm.toLowerCase();
                  return (
                    inv.invoice_number.toLowerCase().includes(term) ||
                    (inv.customer_name && inv.customer_name.toLowerCase().includes(term)) ||
                    (inv.company_name && inv.company_name.toLowerCase().includes(term))
                  );
                })
                .map(inv => {
                const balance = Number((inv.total_amount - inv.amount_paid).toFixed(2));
                return (
                  <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                    <td
                      className="px-4 py-3 font-semibold text-odoo-500 cursor-pointer flex items-center gap-1.5"
                      onClick={() => viewInvoice(inv.id)}
                    >
                      <Eye className="w-3.5 h-3.5 text-slate-400" />
                      {inv.invoice_number}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{inv.customer_name}</div>
                      <div className="text-xs text-slate-400">{inv.company_name}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 font-mono">
                      {inv.period_start} → {inv.period_end}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className={inv.is_overdue ? 'text-red-600 font-bold' : 'text-slate-600'}>
                        {inv.due_date}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-slate-900">
                      ${inv.total_amount.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right text-xs">
                      <span className="font-medium text-emerald-700">${inv.amount_paid.toFixed(2)}</span>
                      {balance > 0 && inv.status !== 'Draft' && (
                        <div className="text-[10px] text-amber-600">Owed: ${balance.toFixed(2)}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {getStatusBadge(inv.status, inv.is_overdue)}
                    </td>
                    <td className="px-4 py-3 text-right space-x-1 whitespace-nowrap">
                      {inv.status === 'Draft' && (
                        <button
                          onClick={() => handleConfirmInvoice(inv.id)}
                          className="px-2 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded text-xs font-semibold"
                        >
                          Confirm
                        </button>
                      )}

                      {['Draft', 'Confirmed'].includes(inv.status) && (
                        <button
                          onClick={() => handleCancelInvoice(inv.id)}
                          className="px-2 py-1 bg-red-50 text-red-700 hover:bg-red-100 rounded text-xs font-semibold"
                        >
                          Cancel
                        </button>
                      )}

                      <button
                        onClick={() => viewInvoice(inv.id)}
                        title="Print / View Invoice"
                        className="px-2 py-1 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded text-xs font-semibold inline-flex items-center gap-1"
                      >
                        <Printer className="w-3 h-3" /> View/Print
                      </button>

                      <button
                        onClick={() => handleSendInvoice(inv.id)}
                        title="Send to Customer Email"
                        className="px-2 py-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded text-xs font-semibold inline-flex items-center gap-1"
                      >
                        <Send className="w-3 h-3" /> Send
                      </button>

                      {balance > 0 && inv.status !== 'Cancelled' && inv.status !== 'Draft' && (
                        <button
                          onClick={() => openPaymentModal(inv)}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold inline-flex items-center gap-1"
                        >
                          <DollarSign className="w-3 h-3" /> Pay
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pager info={pageInfo} onPage={setPage} />
      </div>

      {/* Modal 1: Printable Official Invoice View */}
      {printModalOpen && targetInvoice && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-8 border border-slate-200 max-h-[90vh] overflow-y-auto">
            {/* Header & Controls */}
            <div className="flex justify-between items-start border-b border-slate-200 pb-5">
              <div>
                <div className="text-xl font-black text-slate-900 uppercase tracking-tight">Brightloop Software Ltd.</div>
                <div className="text-xs text-slate-500">Tax ID: US-984210948 | billing@brightloop.com</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 bg-odoo-500 hover:bg-odoo-600 text-white rounded text-xs font-semibold flex items-center gap-1"
                >
                  <Printer className="w-3.5 h-3.5" /> Print / PDF
                </button>
                <button onClick={() => setPrintModalOpen(false)} className="text-slate-400 hover:text-slate-600 font-bold text-lg">✕</button>
              </div>
            </div>

            {/* Invoice Meta */}
            <div className="grid grid-cols-2 gap-4 my-6 text-xs">
              <div>
                <span className="text-slate-400 uppercase font-bold text-[10px] block">Billed To:</span>
                <div className="font-bold text-slate-900 text-sm mt-0.5">{targetInvoice.customer_name}</div>
                <div className="text-slate-600">{targetInvoice.company_name}</div>
                <div className="text-slate-500">{targetInvoice.customer_email}</div>
              </div>

              <div className="text-right">
                <div className="text-lg font-black text-odoo-500">{targetInvoice.invoice_number}</div>
                <div className="text-slate-600 mt-1">Issue Date: <strong>{targetInvoice.issue_date}</strong></div>
                <div className="text-slate-600">Due Date: <strong>{targetInvoice.due_date}</strong></div>
                <div className="text-slate-600">Period: <strong>{targetInvoice.period_start} to {targetInvoice.period_end}</strong></div>
              </div>
            </div>

            {/* Lines */}
            <div className="border border-slate-200 rounded-lg overflow-hidden my-4 text-xs">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-200 font-bold text-slate-700">
                  <tr>
                    <th className="p-2.5">Item Description</th>
                    <th className="p-2.5 text-center">Qty</th>
                    <th className="p-2.5 text-right">Unit Price</th>
                    <th className="p-2.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {targetInvoice.lines?.map(l => (
                    <tr key={l.id}>
                      <td className="p-2.5 font-medium text-slate-800">{l.description}</td>
                      <td className="p-2.5 text-center">{l.quantity}</td>
                      <td className="p-2.5 text-right font-mono">${l.unit_price.toFixed(2)}</td>
                      <td className="p-2.5 text-right font-mono font-semibold">${l.line_total.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals Breakdown */}
            <div className="flex justify-end my-4 text-xs">
              <div className="w-64 space-y-1.5">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal:</span>
                  <span className="font-mono font-medium">${targetInvoice.subtotal.toFixed(2)}</span>
                </div>
                {targetInvoice.discount_amount > 0 && (
                  <div className="flex justify-between text-purple-700 font-semibold">
                    <span>Discount Applied:</span>
                    <span className="font-mono">-${targetInvoice.discount_amount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-600">
                  <span>Tax (Calculated from Rules):</span>
                  <span className="font-mono font-medium">${targetInvoice.tax_amount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-base font-black text-slate-900 border-t border-slate-200 pt-2">
                  <span>Total Amount:</span>
                  <span className="font-mono">${targetInvoice.total_amount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs font-bold text-emerald-700">
                  <span>Amount Paid:</span>
                  <span className="font-mono">${targetInvoice.amount_paid.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs font-bold text-amber-700">
                  <span>Balance Due:</span>
                  <span className="font-mono">${Math.max(0, targetInvoice.total_amount - targetInvoice.amount_paid).toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Payment History */}
            {targetInvoice.payments && targetInvoice.payments.length > 0 && (
              <div className="border-t border-slate-200 pt-4 mt-4">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">Recorded Payments</h4>
                <div className="space-y-1 text-xs">
                  {targetInvoice.payments.map(p => (
                    <div key={p.id} className="p-2 bg-emerald-50 text-emerald-950 rounded flex justify-between items-center">
                      <div>
                        <span className="font-bold">{p.payment_method}</span> ({p.reference || 'No ref'}) on {p.payment_date}
                        {p.note && <span className="text-[11px] text-emerald-800 ml-1">- {p.note}</span>}
                      </div>
                      <span className="font-mono font-bold">${p.amount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal 2: Record Payment */}
      {paymentModalOpen && targetInvoice && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-slate-200">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-emerald-600" /> Record Customer Payment
              </h3>
              <button onClick={() => setPaymentModalOpen(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            <form onSubmit={handleRecordPayment} className="mt-4 space-y-4 text-sm">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Invoice:</span>
                  <span className="font-bold text-slate-900">{targetInvoice.invoice_number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Customer:</span>
                  <span className="font-medium text-slate-800">{targetInvoice.customer_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Total Invoiced:</span>
                  <span className="font-mono font-bold">${targetInvoice.total_amount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Already Paid:</span>
                  <span className="font-mono text-emerald-700">${targetInvoice.amount_paid.toFixed(2)}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Amount ($)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  min="0.01"
                  value={paymentAmount}
                  onChange={e => setPaymentAmount(parseFloat(e.target.value) || 0)}
                  className="w-full border border-slate-300 rounded-lg p-2 font-mono font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Method</label>
                <select
                  value={paymentMethod}
                  onChange={e => setPaymentMethod(e.target.value as any)}
                  className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white"
                >
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Credit Card">Credit Card</option>
                  <option value="UPI">UPI</option>
                  <option value="Cash">Cash</option>
                  <option value="Cheque">Cheque</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Reference / Transaction ID</label>
                <input
                  type="text"
                  value={paymentRef}
                  onChange={e => setPaymentRef(e.target.value)}
                  placeholder="e.g. TXN-109284"
                  className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Note</label>
                <input
                  type="text"
                  value={paymentNote}
                  onChange={e => setPaymentNote(e.target.value)}
                  placeholder="e.g. Wire transfer confirmed by bank"
                  className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setPaymentModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingPayment}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-all"
                >
                  {submittingPayment ? 'Recording...' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
