import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api.js';
import Pager, { PageInfo } from '../components/Pager.js';
import { Subscription, Plan, Product, QuotationTemplate, DiscountRule } from '../types.js';
import {
  FileText, Plus, Filter, CheckCircle, ArrowRight, PauseCircle,
  XCircle, PlayCircle, Eye, AlertCircle, RefreshCw, Sparkles
} from 'lucide-react';

export const Subscriptions: React.FC = () => {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [selectedSub, setSelectedSub] = useState<Subscription | null>(null);
  const [statusFilter, setStatusFilter] = useState('All');
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  // Form states for creating subscription
  const [templates, setTemplates] = useState<QuotationTemplate[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [discounts, setDiscounts] = useState<DiscountRule[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [customerId, setCustomerId] = useState<number>(3); // default Acme Corp
  const [planId, setPlanId] = useState<number>(2);
  const [discountId, setDiscountId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await api.getSubscriptions({ status: statusFilter, page });
      setSubscriptions(res.subscriptions);
      setPageInfo(res.pagination);
    } catch (err: any) {
      alert('Error loading subscriptions: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadCatalogForModal = async () => {
    try {
      const [tplRes, plansRes, prodRes, discRes] = await Promise.all([
        api.getQuotationTemplates(),
        api.getPlans(),
        api.getProducts(),
        api.getDiscounts()
      ]);
      setTemplates(tplRes.templates);
      setPlans(plansRes.plans);
      setProducts(prodRes.products);
      setDiscounts(discRes.discounts);
    } catch (err: any) {
      console.error('Error loading catalog metadata', err);
    }
  };

  // One request per change: a new filter goes back to page 1 instead of fetching the stale page first.
  const lastStatusFilter = useRef(statusFilter);
  useEffect(() => {
    if (lastStatusFilter.current !== statusFilter) {
      lastStatusFilter.current = statusFilter;
      if (page !== 1) {
        setPage(1);
        return;
      }
    }
    loadData();
  }, [statusFilter, page]);

  const openCreateModal = () => {
    loadCatalogForModal();
    setModalOpen(true);
  };

  const handleCreateSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload: any = {
        customer_id: customerId,
        plan_id: planId,
        notes: notes || undefined,
        discount_rule_id: discountId ? Number(discountId) : undefined,
        initial_status: 'Draft'
      };

      if (selectedTemplateId) {
        payload.template_id = Number(selectedTemplateId);
      } else {
        // default with flagship product
        payload.lines = [
          { product_id: products[0]?.id || 1, default_quantity: 1 }
        ];
      }

      const res = await api.createSubscription(payload);
      setActionNotice(`Created subscription ${res.subscription.subscription_number}!`);
      setTimeout(() => setActionNotice(null), 4000);
      setModalOpen(false);
      loadData();
    } catch (err: any) {
      alert('Failed to create subscription: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (subId: number, newStatus: string) => {
    try {
      const res = await api.updateSubscriptionStatus(subId, newStatus);
      setActionNotice(res.message);
      setTimeout(() => setActionNotice(null), 4000);
      loadData();
      if (selectedSub && selectedSub.id === subId) {
        viewSubscriptionDetails(subId);
      }
    } catch (err: any) {
      alert('State transition failed: ' + err.message);
    }
  };

  const viewSubscriptionDetails = async (id: number) => {
    try {
      const res = await api.getSubscription(id);
      setSelectedSub(res.subscription);
    } catch (err: any) {
      alert('Error fetching details: ' + err.message);
    }
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, string> = {
      Active: 'bg-emerald-100 text-emerald-800 border-emerald-200',
      Confirmed: 'bg-blue-100 text-blue-800 border-blue-200',
      Quotation: 'bg-indigo-100 text-indigo-800 border-indigo-200',
      Draft: 'bg-slate-100 text-slate-800 border-slate-200',
      Paused: 'bg-amber-100 text-amber-800 border-amber-200',
      Closed: 'bg-red-100 text-red-800 border-red-200'
    };
    return (
      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${map[status] || 'bg-gray-100 text-gray-800'}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Subscription Management & Lifecycle</h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage contract states from Draft & Quotation through Confirmed, Active, Paused, and Closed.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => window.open('/api/analytics/export/subscriptions', '_blank')}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold border border-slate-300 transition-all flex items-center gap-1.5"
            title="Download CSV"
          >
            Export CSV
          </button>

          <button
            onClick={openCreateModal}
            className="px-4 py-2 bg-odoo-500 hover:bg-odoo-600 text-white rounded-lg text-sm font-semibold shadow-sm transition-all flex items-center gap-1.5 self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" /> Create Subscription / Quote
          </button>
        </div>
      </div>

      {actionNotice && (
        <div className="bg-emerald-50 border border-emerald-300 text-emerald-800 px-4 py-3 rounded-lg text-sm flex items-center justify-between shadow-sm">
          <span>{actionNotice}</span>
          <button onClick={() => setActionNotice(null)} className="text-emerald-700 font-bold">×</button>
        </div>
      )}

      {/* Filter Tabs & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {['All', 'Active', 'Quotation', 'Confirmed', 'Draft', 'Paused', 'Closed'].map(st => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                statusFilter === st
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
            placeholder="Search subscriptions or customers..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-odoo-500"
          />
        </div>
      </div>

      {/* Main Grid: Subscriptions Table + Detail Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Subscriptions Table */}
        <div className={`${selectedSub ? 'lg:col-span-2' : 'lg:col-span-3'} bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Subscription #</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Next Billing</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {subscriptions
                  .filter(s => {
                    if (!searchTerm) return true;
                    const term = searchTerm.toLowerCase();
                    return (
                      s.subscription_number.toLowerCase().includes(term) ||
                      s.customer_name.toLowerCase().includes(term) ||
                      (s.company_name && s.company_name.toLowerCase().includes(term)) ||
                      s.plan_name.toLowerCase().includes(term)
                    );
                  })
                  .map(s => (
                  <tr
                    key={s.id}
                    className={`hover:bg-slate-50 transition-colors ${selectedSub?.id === s.id ? 'bg-purple-50/40' : ''}`}
                  >
                    <td
                      className="px-4 py-3 font-semibold text-odoo-500 cursor-pointer flex items-center gap-1.5"
                      onClick={() => viewSubscriptionDetails(s.id)}
                    >
                      <Eye className="w-3.5 h-3.5 text-slate-400" />
                      {s.subscription_number}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{s.customer_name}</div>
                      <div className="text-xs text-slate-400">{s.company_name}</div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="font-semibold text-slate-800">{s.plan_name}</div>
                      <div className="text-slate-400 capitalize">{s.billing_interval}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 font-mono">
                      {s.next_billing_date}
                    </td>
                    <td className="px-4 py-3">
                      {getStatusBadge(s.status)}
                    </td>
                    <td className="px-4 py-3 text-right space-x-1 whitespace-nowrap">
                      {/* State Machine Transition Actions */}
                      {s.status === 'Draft' && (
                        <button
                          onClick={() => handleStatusChange(s.id, 'Quotation')}
                          className="px-2 py-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded text-xs font-semibold"
                        >
                          Send Quote
                        </button>
                      )}
                      {s.status === 'Quotation' && (
                        <button
                          onClick={() => handleStatusChange(s.id, 'Confirmed')}
                          className="px-2 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded text-xs font-semibold"
                        >
                          Confirm
                        </button>
                      )}
                      {s.status === 'Confirmed' && (
                        <button
                          onClick={() => handleStatusChange(s.id, 'Active')}
                          className="px-2 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded text-xs font-semibold"
                        >
                          Activate
                        </button>
                      )}
                      {s.status === 'Active' && s.can_pause === 1 && (
                        <button
                          onClick={() => handleStatusChange(s.id, 'Paused')}
                          className="px-2 py-1 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded text-xs font-semibold"
                        >
                          Pause
                        </button>
                      )}
                      {s.status === 'Paused' && (
                        <button
                          onClick={() => handleStatusChange(s.id, 'Active')}
                          className="px-2 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded text-xs font-semibold"
                        >
                          Resume
                        </button>
                      )}
                      {['Active', 'Paused', 'Draft', 'Quotation', 'Confirmed'].includes(s.status) && (
                        <button
                          onClick={() => handleStatusChange(s.id, 'Closed')}
                          className="px-2 py-1 bg-red-50 text-red-700 hover:bg-red-100 rounded text-xs font-semibold"
                        >
                          Close
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager info={pageInfo} onPage={setPage} />
        </div>

        {/* Detail Panel */}
        {selectedSub && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-base">{selectedSub.subscription_number}</h3>
                <span className="text-xs text-slate-400">Created {selectedSub.created_at}</span>
              </div>
              <button onClick={() => setSelectedSub(null)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            <div className="text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">Customer:</span>
                <span className="font-semibold text-slate-800">{selectedSub.customer_name} ({selectedSub.company_name})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Plan Policy:</span>
                <span className="font-semibold text-slate-800">{selectedSub.plan_name} ({selectedSub.billing_interval})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Current Status:</span>
                {getStatusBadge(selectedSub.status)}
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Next Billing Date:</span>
                <span className="font-mono font-bold text-slate-800">{selectedSub.next_billing_date}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Payment Terms:</span>
                <span className="font-semibold text-slate-800">{selectedSub.payment_terms}</span>
              </div>
              {selectedSub.discount_code && (
                <div className="flex justify-between bg-purple-50 p-2 rounded border border-purple-200">
                  <span className="text-odoo-500 font-semibold">Discount Attached:</span>
                  <span className="font-bold text-odoo-500">{selectedSub.discount_code} ({selectedSub.discount_value}{selectedSub.discount_type === 'percentage' ? '%' : '$'})</span>
                </div>
              )}
            </div>

            {/* Line Items */}
            <div className="border-t border-slate-100 pt-3">
              <h4 className="font-semibold text-slate-900 text-xs mb-2">Subscription Line Items & Variants</h4>
              <div className="space-y-1.5 text-xs">
                {selectedSub.lines?.map(l => (
                  <div key={l.id} className="p-2 bg-slate-50 rounded border border-slate-100 flex justify-between items-center">
                    <div>
                      <div className="font-semibold text-slate-800">{l.product_name}</div>
                      {l.option_name && (
                        <div className="text-[11px] text-odoo-500 font-medium">
                          Variant: {l.attribute_name} - {l.option_name} (+${l.price_extra})
                        </div>
                      )}
                      <div className="text-[11px] text-slate-400">Qty: {l.quantity} × ${l.unit_price.toFixed(2)}</div>
                    </div>
                    <div className="font-bold text-slate-900">${l.line_amount.toFixed(2)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Invoice History */}
            <div className="border-t border-slate-100 pt-3">
              <h4 className="font-semibold text-slate-900 text-xs mb-2">Invoices Generated</h4>
              {selectedSub.invoices && selectedSub.invoices.length > 0 ? (
                <div className="space-y-1 text-xs">
                  {selectedSub.invoices.map(inv => (
                    <div key={inv.id} className="p-2 bg-slate-50 rounded flex justify-between items-center">
                      <span className="font-medium text-odoo-500">{inv.invoice_number}</span>
                      <span className="font-mono text-slate-600">${inv.total_amount.toFixed(2)}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 font-semibold">{inv.status}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">No invoices generated yet.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal: Create Subscription / Convert from Quotation Template */}
      {modalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 border border-slate-200">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-odoo-500" /> Create Subscription / Quote
              </h3>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
            </div>

            <form onSubmit={handleCreateSubscription} className="mt-4 space-y-4 text-sm">
              {/* Quotation Template Option */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Start from Quotation Template (Optional)
                </label>
                <select
                  value={selectedTemplateId}
                  onChange={e => {
                    setSelectedTemplateId(e.target.value);
                    const tpl = templates.find(t => t.id === Number(e.target.value));
                    if (tpl) setPlanId(tpl.plan_id);
                  }}
                  className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white"
                >
                  <option value="">-- Custom Blank Subscription --</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({t.plan_name} - {t.billing_interval})</option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  Templates automatically pre-populate product lines, Odoo brand variants, and plan terms!
                </p>
              </div>

              {/* Customer */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Select Customer</label>
                <select
                  value={customerId}
                  onChange={e => setCustomerId(Number(e.target.value))}
                  className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white"
                >
                  <option value={3}>David Miller — Acme Corporation (acme@corp.com)</option>
                  <option value={4}>Elena Rostova — Globex International (globex@biz.com)</option>
                </select>
              </div>

              {/* Plan */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Billing Plan</label>
                <select
                  value={planId}
                  onChange={e => setPlanId(Number(e.target.value))}
                  className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white"
                >
                  {plans.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} — ${p.price} / {p.billing_interval} {p.auto_close ? '(Auto-close on expiry)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Discount Rule */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Attach Discount Rule (Optional)</label>
                <select
                  value={discountId}
                  onChange={e => setDiscountId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white"
                >
                  <option value="">No Discount Attached</option>
                  {discounts.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.code} — {d.description} ({d.value}{d.discount_type === 'percentage' ? '%' : '$'})
                    </option>
                  ))}
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Contract Notes</label>
                <input
                  type="text"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="e.g. Special negotiated rate for 2026 expansion"
                  className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-odoo-500 hover:bg-odoo-600 text-white rounded-lg text-sm font-semibold shadow-sm transition-all"
                >
                  {submitting ? 'Creating...' : 'Create Subscription'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
