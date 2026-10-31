import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api.js';
import Pager, { PageInfo } from '../components/Pager.js';
import { Alert, EmptyState, Loading, StatusBadge } from '../components/ui.js';
import { formatMoney, today } from '../lib/format.js';
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
  const [customers, setCustomers] = useState<Array<{ id: number; email: string; full_name: string; company_name: string | null }>>([]);
  const [customerId, setCustomerId] = useState<number>(0);
  const [planId, setPlanId] = useState<number>(0);
  const [startDate, setStartDate] = useState<string>(today());
  const [expiryDate, setExpiryDate] = useState<string>('');
  const [paymentTerms, setPaymentTerms] = useState<string>('Immediate Payment');
  const [lines, setLines] = useState<Array<{ product_id: number; variant_id: number | null; quantity: number }>>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [discountId, setDiscountId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getSubscriptions({ status: statusFilter, page, q: searchTerm || undefined });
      setSubscriptions(res.subscriptions);
      setPageInfo(res.pagination);
    } catch (err: any) {
      setError('Could not load subscriptions: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadCatalogForModal = async () => {
    try {
      const [tplRes, plansRes, prodRes, discRes, custRes] = await Promise.all([
        api.getQuotationTemplates(),
        api.getPlans(),
        api.getProducts(),
        api.getDiscounts(),
        api.getCustomers()
      ]);
      setTemplates(tplRes.templates);
      setPlans(plansRes.plans);
      setProducts(prodRes.products);
      setDiscounts(discRes.discounts);
      setCustomers(custRes.customers);
      if (!customerId && custRes.customers[0]) setCustomerId(custRes.customers[0].id);
      if (!planId && plansRes.plans[0]) setPlanId(plansRes.plans[0].id);
      if (lines.length === 0 && prodRes.products[0]) {
        const p = prodRes.products[0];
        setLines([{ product_id: p.id, variant_id: p.variants?.[0]?.id ?? null, quantity: 1 }]);
      }
    } catch (err: any) {
      setFormError('Could not load the catalog: ' + err.message);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // One request per change: a new filter goes back to page 1 instead of fetching the stale page first.
  const filterKey = `${statusFilter}|${searchTerm}`;
  const lastStatusFilter = useRef(filterKey);
  useEffect(() => {
    if (lastStatusFilter.current !== filterKey) {
      lastStatusFilter.current = filterKey;
      if (page !== 1) {
        setPage(1);
        return;
      }
    }
    loadData();
  }, [filterKey, page]);

  const openCreateModal = () => {
    setFormError(null);
    loadCatalogForModal();
    setModalOpen(true);
  };

  const handleCreateSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const payload: any = {
        customer_id: customerId,
        plan_id: planId,
        start_date: startDate,
        expiry_date: expiryDate || undefined,
        payment_terms: paymentTerms,
        notes: notes || undefined,
        discount_rule_id: discountId ? Number(discountId) : undefined
      };

      if (selectedTemplateId) {
        payload.template_id = Number(selectedTemplateId);
      } else {
        payload.lines = lines.map(l => ({ product_id: l.product_id, variant_id: l.variant_id ?? undefined, quantity: l.quantity }));
      }

      const res = await api.createSubscription(payload);
      setActionNotice(`Created ${res.subscription.subscription_number} as Draft. Use Send quote, Confirm, then Activate.`);
      setTimeout(() => setActionNotice(null), 8000);
      setModalOpen(false);
      loadData();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (subId: number, newStatus: string) => {
    if (newStatus === 'Closed' && !window.confirm('Close this subscription? A closed subscription cannot be reopened.')) return;
    setError(null);
    try {
      const res = await api.updateSubscriptionStatus(subId, newStatus);
      setActionNotice(res.message);
      setTimeout(() => setActionNotice(null), 4000);
      loadData();
      if (selectedSub && selectedSub.id === subId) {
        viewSubscriptionDetails(subId);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const viewSubscriptionDetails = async (id: number) => {
    try {
      const res = await api.getSubscription(id);
      setSelectedSub(res.subscription);
    } catch (err: any) {
      setError('Could not open the subscription: ' + err.message);
    }
  };

  const getStatusBadge = (status: string) => <StatusBadge status={status} />;

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
            onClick={() => api.downloadCsv('subscriptions').catch(err => setError(err.message))}
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

      {error && <Alert kind="error" onClose={() => setError(null)}>{error}</Alert>}
      {actionNotice && <Alert kind="success" onClose={() => setActionNotice(null)}>{actionNotice}</Alert>}

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
            placeholder="Subscription number starts with…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
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
                      {['Active', 'Paused', 'Draft', 'Quotation', 'Confirmed'].includes(s.status) && s.can_close_early !== 0 && (
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
          {loading && <Loading label="Loading subscriptions…" />}
          {!loading && subscriptions.length === 0 && (
            <EmptyState title="No subscriptions match" hint="Create one with the button above, or change the filter." />
          )}
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
                  <span className="font-bold text-odoo-500">{selectedSub.discount_code} ({selectedSub.discount_type === 'percentage' ? `${selectedSub.discount_value}%` : formatMoney(selectedSub.discount_value)})</span>
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
                          Variant: {l.attribute_name} - {l.option_name} (+{formatMoney(l.price_extra)})
                        </div>
                      )}
                      <div className="text-[11px] text-slate-400">Qty: {l.quantity} × {formatMoney(l.unit_price)}</div>
                    </div>
                    <div className="font-bold text-slate-900">{formatMoney(l.line_amount)}</div>
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
                      <span className="font-mono text-slate-600">{formatMoney(inv.total_amount)}</span>
                      <StatusBadge status={inv.status} />
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
          <div className="bg-white rounded-xl shadow-2xl max-w-xl w-full p-6 border border-slate-200 max-h-[95vh] overflow-y-auto">
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
                  required
                  className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white"
                >
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.full_name}{c.company_name ? ` — ${c.company_name}` : ''} ({c.email})</option>
                  ))}
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
                      {p.name} — {p.billing_interval}{p.min_quantity > 1 ? `, min qty ${p.min_quantity}` : ''}{p.auto_close ? ', auto-close' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Dates and payment terms */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Start date</label>
                  <input type="date" required value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full border border-slate-300 rounded-lg p-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Expiry (optional)</label>
                  <input type="date" value={expiryDate} min={startDate} onChange={e => setExpiryDate(e.target.value)} className="w-full border border-slate-300 rounded-lg p-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Payment terms</label>
                  <select value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} className="w-full border border-slate-300 rounded-lg p-2 text-sm bg-white">
                    {['Immediate Payment', '15 Days Net', '30 Days Net', '45 Days Net'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              {/* Product lines (blank subscription only; a template brings its own lines) */}
              {!selectedTemplateId && (
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-700">Products</label>
                  {lines.map((l, i) => {
                    const product = products.find(p => p.id === l.product_id);
                    return (
                      <div key={i} className="grid grid-cols-12 gap-2 items-center">
                        <select
                          value={l.product_id}
                          onChange={e => {
                            const prod = products.find(p => p.id === Number(e.target.value));
                            setLines(lines.map((x, j) => (j === i ? { product_id: Number(e.target.value), variant_id: prod?.variants?.[0]?.id ?? null, quantity: x.quantity } : x)));
                          }}
                          className="col-span-5 border border-slate-300 rounded-lg p-2 text-xs bg-white"
                        >
                          {products.map(p => <option key={p.id} value={p.id}>{p.name} — {formatMoney(p.sales_price)}</option>)}
                        </select>
                        <select
                          value={l.variant_id ?? ''}
                          disabled={!product?.variants?.length}
                          onChange={e => setLines(lines.map((x, j) => (j === i ? { ...x, variant_id: e.target.value ? Number(e.target.value) : null } : x)))}
                          className="col-span-4 border border-slate-300 rounded-lg p-2 text-xs bg-white disabled:bg-slate-50"
                        >
                          {!product?.variants?.length && <option value="">No variants</option>}
                          {product?.variants?.map(v => (
                            <option key={v.id} value={v.id}>{v.attribute_name}: {v.option_name}{v.price_extra ? ` (+${formatMoney(v.price_extra)})` : ''}</option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={1}
                          value={l.quantity}
                          onChange={e => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x)))}
                          className="col-span-2 border border-slate-300 rounded-lg p-2 text-xs"
                          aria-label="Quantity"
                        />
                        <button
                          type="button"
                          disabled={lines.length === 1}
                          onClick={() => setLines(lines.filter((_, j) => j !== i))}
                          className="col-span-1 text-slate-400 hover:text-red-600 disabled:opacity-30"
                          aria-label="Remove line"
                        >✕</button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => products[0] && setLines([...lines, { product_id: products[0].id, variant_id: products[0].variants?.[0]?.id ?? null, quantity: 1 }])}
                    className="text-xs font-semibold text-odoo-500 hover:underline"
                  >+ Add product line</button>
                  <p className="text-[11px] text-slate-500">The unit price (product price + variant extra) is fixed on the line when you save; later price changes do not alter it.</p>
                </div>
              )}

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
                      {d.code} — {d.description} ({d.discount_type === 'percentage' ? `${d.value}%` : formatMoney(d.value)})
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

              {formError && <Alert kind="error">{formError}</Alert>}

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
                  disabled={submitting || !customerId || !planId}
                  className="px-4 py-2 bg-odoo-500 hover:bg-odoo-600 text-white rounded-lg text-sm font-semibold shadow-sm transition-all disabled:opacity-50"
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
