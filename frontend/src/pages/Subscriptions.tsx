import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api.js';
import Pager, { PageInfo } from '../components/Pager.js';
import { SubscriptionTimeline } from '../components/SubscriptionTimeline.js';
import { Subscription, Plan, Product, QuotationTemplate, DiscountRule } from '../types.js';
import {
  Alert, Button, Card, ConfirmDialog, EmptyState, ErrorState, Input, Loading, Modal, PageHeader, Select, Textarea, StatusBadge, table, useToast, cx
} from '../components/ui.js';
import { formatDate, formatMoney, today } from '../lib/format.js';
import { Download, Plus } from 'lucide-react';

type Customer = { id: number; email: string; full_name: string; company_name: string | null };
type FormLine = { product_id: number; variant_id: number | null; quantity: number };

const STATUS_FILTERS = ['All', 'Active', 'Quotation', 'Confirmed', 'Draft', 'Paused', 'Closed'] as const;
const FLOW = ['Draft', 'Quotation', 'Confirmed', 'Active', 'Closed'] as const;
const TERMS = ['Immediate Payment', '15 Days Net', '30 Days Net', '45 Days Net'];

/** Exact sum of two stored 2-decimal amounts (integer cents), used only for the list-price preview. */
const addMoney = (a: number, b: number) => (Math.round(a * 100) + Math.round(b * 100)) / 100;

interface Action { label: string; to: string; variant?: 'primary' | 'danger' | 'secondary'; confirm?: string; confirmLabel?: string }

/** Only transitions the server accepts for this state and plan policy. */
function actionsFor(s: Subscription): Action[] {
  const out: Action[] = [];
  const canClose = s.can_close_early !== 0;
  switch (s.status) {
    case 'Draft':
      out.push({ label: 'Send quotation', to: 'Quotation', variant: 'primary' });
      out.push({ label: 'Discard', to: 'Closed', variant: 'danger', confirm: 'Discard this draft? A closed subscription cannot be reopened.', confirmLabel: 'Discard' });
      break;
    case 'Quotation':
      out.push({ label: 'Confirm', to: 'Confirmed', variant: 'primary' });
      out.push({ label: 'Back to draft', to: 'Draft' });
      out.push({ label: 'Discard', to: 'Closed', variant: 'danger', confirm: 'Discard this quotation? A closed subscription cannot be reopened.', confirmLabel: 'Discard' });
      break;
    case 'Confirmed':
      out.push({ label: 'Activate', to: 'Active', variant: 'primary' });
      out.push({ label: 'Discard', to: 'Closed', variant: 'danger', confirm: 'Discard this confirmed subscription? A closed subscription cannot be reopened.', confirmLabel: 'Discard' });
      break;
    case 'Active':
      if (s.can_pause === 1) out.push({ label: 'Pause', to: 'Paused' });
      if (canClose) out.push({ label: 'Close early', to: 'Closed', variant: 'danger', confirm: 'Close this subscription now? It takes effect immediately with no refund or proration, and it cannot be reopened.', confirmLabel: 'Close subscription' });
      break;
    case 'Paused':
      out.push({ label: 'Resume', to: 'Active', variant: 'primary' });
      if (canClose) out.push({ label: 'Close early', to: 'Closed', variant: 'danger', confirm: 'Close this subscription now? It cannot be reopened.', confirmLabel: 'Close subscription' });
      break;
  }
  return out;
}

const Stepper: React.FC<{ status: Subscription['status'] }> = ({ status }) => {
  const idx = FLOW.indexOf((status === 'Paused' ? 'Active' : status) as (typeof FLOW)[number]);
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs" aria-label="Lifecycle">
      {FLOW.map((step, i) => {
        const done = i < idx;
        const current = i === idx;
        return (
          <li key={step} className="flex items-center gap-1" aria-current={current ? 'step' : undefined}>
            <span className={cx('rounded px-2 py-0.5 border', current ? 'bg-brand-700 border-brand-700 text-white font-medium' : done ? 'bg-slate-100 border-slate-300 text-slate-700' : 'border-slate-200 text-slate-400')}>
              {current && status === 'Paused' ? 'Active (paused)' : step}
            </span>
            {i < FLOW.length - 1 && <span className="text-slate-300" aria-hidden="true">›</span>}
          </li>
        );
      })}
    </ol>
  );
};

export const Subscriptions: React.FC = () => {
  const toast = useToast();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [selected, setSelected] = useState<Subscription | null>(null);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('All');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [pending, setPending] = useState<{ sub: Subscription; action: Action } | null>(null);

  // create form
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState<QuotationTemplate[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [discounts, setDiscounts] = useState<DiscountRule[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [planId, setPlanId] = useState('');
  const [startDate, setStartDate] = useState(today());
  const [expiryDate, setExpiryDate] = useState('');
  const [terms, setTerms] = useState('Immediate Payment');
  const [discountId, setDiscountId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<FormLine[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getSubscriptions({ status: statusFilter, page, q: search || undefined });
      setSubscriptions(res.subscriptions);
      setPageInfo(res.pagination);
    } catch (err: any) {
      setError('Unable to load subscriptions. ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // One request per change: a new filter returns to page 1 instead of fetching the stale page first.
  const filterKey = `${statusFilter}|${search}`;
  const lastFilterKey = useRef(filterKey);
  useEffect(() => {
    if (lastFilterKey.current !== filterKey) {
      lastFilterKey.current = filterKey;
      if (page !== 1) {
        setPage(1);
        return;
      }
    }
    loadData();
  }, [filterKey, page]);

  const openDetail = async (id: number) => {
    try {
      setSelected((await api.getSubscription(id)).subscription);
    } catch (err: any) {
      toast('error', 'Unable to open the subscription. ' + err.message);
    }
  };

  const transition = async (sub: Subscription, action: Action) => {
    setBusyId(sub.id);
    try {
      const res = await api.updateSubscriptionStatus(sub.id, action.to);
      toast('success', `${sub.subscription_number}: ${res.message}`);
      setPending(null);
      await loadData();
      if (selected?.id === sub.id) await openDetail(sub.id);
    } catch (err: any) {
      setPending(null);
      toast('error', err.message);
    } finally {
      setBusyId(null);
    }
  };

  const run = (sub: Subscription, action: Action) => (action.confirm ? setPending({ sub, action }) : transition(sub, action));

  // ---- create ----------------------------------------------------------------------------------
  const openCreate = async () => {
    setFormError(null);
    setCreating(true);
    try {
      const [tpl, pl, pr, disc, cust] = await Promise.all([
        api.getQuotationTemplates(), api.getPlans(), api.getProducts(), api.getDiscounts(), api.getCustomers()
      ]);
      setTemplates(tpl.templates);
      setPlans(pl.plans);
      setProducts(pr.products);
      setDiscounts(disc.discounts);
      setCustomers(cust.customers);
      if (!customerId && cust.customers[0]) setCustomerId(String(cust.customers[0].id));
      if (!planId && pl.plans[0]) setPlanId(String(pl.plans[0].id));
      if (lines.length === 0 && pr.products[0]) setLines([{ product_id: pr.products[0].id, variant_id: pr.products[0].variants?.[0]?.id ?? null, quantity: 1 }]);
    } catch (err: any) {
      setFormError('Unable to load the form data. ' + err.message);
    }
  };

  const template = templates.find(t => t.id === Number(templateId));
  const plan = plans.find(p => p.id === Number(template ? template.plan_id : planId));
  const customer = customers.find(c => c.id === Number(customerId));

  const reviewLines = template
    ? template.lines.map(l => ({ name: l.product_name, variant: l.option_name ? `${l.attribute_name}: ${l.option_name}` : null, qty: l.default_quantity, unit: addMoney(l.sales_price, l.price_extra ?? 0) }))
    : lines.map(l => {
        const p = products.find(x => x.id === l.product_id);
        const v = p?.variants?.find(x => x.id === l.variant_id);
        return { name: p?.name ?? 'Unknown product', variant: v ? `${v.attribute_name}: ${v.option_name}` : null, qty: l.quantity, unit: addMoney(p?.sales_price ?? 0, v?.price_extra ?? 0) };
      });

  const minQtyProblem = plan && reviewLines.some(l => l.qty < plan.min_quantity) ? `${plan.name} requires a quantity of at least ${plan.min_quantity} on every line.` : null;
  const dateProblem = expiryDate && expiryDate < startDate ? 'The expiry date cannot be before the start date.' : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (minQtyProblem || dateProblem) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const payload: Record<string, unknown> = {
        customer_id: Number(customerId),
        start_date: startDate,
        expiry_date: expiryDate || undefined,
        payment_terms: terms,
        notes: notes || undefined,
        discount_rule_id: discountId ? Number(discountId) : undefined
      };
      if (template) payload.template_id = template.id;
      else {
        payload.plan_id = Number(planId);
        payload.lines = lines.map(l => ({ product_id: l.product_id, variant_id: l.variant_id ?? undefined, quantity: l.quantity }));
      }
      const res = await api.createSubscription(payload);
      toast('success', `${res.subscription.subscription_number} created as Draft. Next: send the quotation.`);
      setCreating(false);
      await loadData();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const hasFilters = statusFilter !== 'All' || !!search;

  return (
    <div>
      <PageHeader
        title="Subscriptions"
        subtitle="Draft, quotation, confirmed, active and closed contracts"
        actions={
          <>
            <Button onClick={() => api.downloadCsv('subscriptions').catch(err => toast('error', err.message))}><Download className="w-3.5 h-3.5" aria-hidden="true" /> Export CSV</Button>
            <Button variant="primary" onClick={openCreate}><Plus className="w-3.5 h-3.5" aria-hidden="true" /> New subscription</Button>
          </>
        }
      />

      {error && <div className="mb-4"><Alert kind="error" onClose={() => setError(null)}>{error}</Alert></div>}

      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 mb-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map(st => (
            <Button key={st} size="sm" variant={statusFilter === st ? 'primary' : 'secondary'} aria-pressed={statusFilter === st} onClick={() => setStatusFilter(st)}>{st}</Button>
          ))}
        </div>
        <div className="w-full lg:w-72">
          <Input label="Search" type="search" value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Subscription number, e.g. SUB-2026-0001" />
        </div>
      </div>

      <Card flush>
        {loading ? <Loading label="Loading subscriptions…" /> : error && subscriptions.length === 0 ? <ErrorState message="Unable to load subscriptions." onRetry={loadData} /> : subscriptions.length === 0 ? (
          <EmptyState
            title={hasFilters ? 'No subscriptions match this filter' : 'No subscriptions yet'}
            hint={hasFilters ? 'Clear the filter or search to see all subscriptions.' : 'Create the first subscription for a customer.'}
            action={!hasFilters ? <Button variant="primary" onClick={openCreate}>New subscription</Button> : undefined}
          />
        ) : (
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Subscription</th>
                  <th className={table.th}>Customer</th>
                  <th className={table.th}>Plan</th>
                  <th className={table.th}>Status</th>
                  <th className={table.th}>Next billing</th>
                  <th className={table.thNum}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className={table.body}>
                {subscriptions.map(s => {
                  const primary = actionsFor(s).find(a => a.variant === 'primary');
                  return (
                    <tr key={s.id} className={table.row}>
                      <td className={table.td}>
                        <button onClick={() => openDetail(s.id)} className="font-medium text-brand-700 hover:underline whitespace-nowrap">{s.subscription_number}</button>
                      </td>
                      <td className={table.td}>
                        <div className="text-slate-900">{s.customer_name}</div>
                        <div className="text-xs text-slate-500">{s.company_name}</div>
                      </td>
                      <td className={table.td}>
                        {s.plan_name}
                        <div className="text-xs text-slate-500 capitalize">{s.billing_interval}</div>
                      </td>
                      <td className={table.td}><StatusBadge status={s.status} /></td>
                      <td className={table.td + ' whitespace-nowrap text-slate-600'}>{s.status === 'Active' ? formatDate(s.next_billing_date) : '—'}</td>
                      <td className={table.tdNum}>
                        <div className="flex justify-end gap-1.5">
                          {primary && <Button size="sm" variant="primary" loading={busyId === s.id} onClick={() => run(s, primary)}>{primary.label}</Button>}
                          <Button size="sm" onClick={() => openDetail(s.id)}>View</Button>
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

      {/* Detail */}
      {selected && (
        <Modal
          title={selected.subscription_number}
          size="xl"
          onClose={() => setSelected(null)}
          footer={actionsFor(selected).map(a => (
            <Button key={a.label} variant={a.variant ?? 'secondary'} loading={busyId === selected.id} onClick={() => run(selected, a)}>{a.label}</Button>
          ))}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <Stepper status={selected.status} />
            <StatusBadge status={selected.status} />
          </div>

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm mb-5">
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Customer</dt><dd className="text-right">{selected.customer_name}{selected.company_name ? `, ${selected.company_name}` : ''}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Plan</dt><dd className="capitalize">{selected.plan_name} ({selected.billing_interval})</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Start date</dt><dd>{formatDate(selected.start_date)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Expiry date</dt><dd>{formatDate(selected.expiry_date)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Payment terms</dt><dd>{selected.payment_terms}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-500">Next billing</dt><dd>{selected.status === 'Active' ? formatDate(selected.next_billing_date) : '—'}</dd></div>
            {selected.discount_code && (
              <div className="flex justify-between gap-4"><dt className="text-slate-500">Discount</dt><dd>{selected.discount_code} ({selected.discount_type === 'percentage' ? `${selected.discount_value}%` : formatMoney(selected.discount_value)})</dd></div>
            )}
          </dl>

          <h3 className="text-sm font-semibold text-slate-900 mb-2">Lines</h3>
          <div className={table.wrap + ' border border-slate-200 rounded-md mb-5'}>
            <table className={table.table + ' min-w-[520px]'}>
              <thead className={table.head}>
                <tr><th className={table.th}>Product</th><th className={table.thNum}>Qty</th><th className={table.thNum}>Unit price</th><th className={table.th}>Tax</th><th className={table.thNum}>Amount</th></tr>
              </thead>
              <tbody className={table.body}>
                {selected.lines?.map(l => (
                  <tr key={l.id}>
                    <td className={table.td}>
                      {l.product_name}
                      {l.option_name && <div className="text-xs text-slate-500">{l.attribute_name}: {l.option_name} (+{formatMoney(l.price_extra)})</div>}
                    </td>
                    <td className={table.tdNum}>{l.quantity}</td>
                    <td className={table.tdNum}>{formatMoney(l.unit_price)}</td>
                    <td className={table.td + ' text-slate-600'}>{l.tax_name ?? 'Default'}</td>
                    <td className={table.tdNum + ' font-medium'}>{formatMoney(l.line_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="text-sm font-semibold text-slate-900 mb-2">Invoices</h3>
          {selected.invoices && selected.invoices.length > 0 ? (
            <div className={table.wrap + ' border border-slate-200 rounded-md mb-5'}>
              <table className={table.table}>
                <tbody className={table.body}>
                  {selected.invoices.map(inv => (
                    <tr key={inv.id}>
                      <td className={table.td + ' font-medium'}>{inv.invoice_number}</td>
                      <td className={table.td + ' text-slate-600 whitespace-nowrap'}>{formatDate(inv.period_start)} to {formatDate(inv.period_end)}</td>
                      <td className={table.tdNum}>{formatMoney(inv.total_amount)}</td>
                      <td className={table.td}><StatusBadge status={inv.status} partial={inv.amount_paid > 0 && inv.amount_paid < inv.total_amount} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-500 mb-5">No invoices yet. Invoices are created by the billing run once the subscription is Active.</p>
          )}

          <h3 className="text-sm font-semibold text-slate-900 mb-2">Activity</h3>
          <SubscriptionTimeline key={`${selected.id}-${selected.status}`} subscriptionId={selected.id} />
        </Modal>
      )}

      {pending && (
        <ConfirmDialog
          title={`${pending.action.label}?`}
          message={pending.action.confirm}
          confirmLabel={pending.action.confirmLabel ?? pending.action.label}
          danger={pending.action.variant === 'danger'}
          busy={busyId === pending.sub.id}
          onConfirm={() => transition(pending.sub, pending.action)}
          onCancel={() => setPending(null)}
        />
      )}

      {/* Create */}
      {creating && (
        <Modal
          title="New subscription"
          size="xl"
          onClose={() => !submitting && setCreating(false)}
          footer={
            <>
              <Button onClick={() => setCreating(false)} disabled={submitting}>Cancel</Button>
              <Button variant="primary" type="submit" form="sub-form" loading={submitting} disabled={!customerId || (!template && !planId) || !!minQtyProblem || !!dateProblem}>
                {submitting ? 'Creating…' : 'Create as draft'}
              </Button>
            </>
          }
        >
          {formError && <div className="mb-3"><Alert kind="error">{formError}</Alert></div>}
          <form id="sub-form" onSubmit={submit} className="space-y-5">
            <section>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">1. Customer and plan</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Select label="Customer" required value={customerId} onChange={e => setCustomerId(e.target.value)}>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.full_name}{c.company_name ? `, ${c.company_name}` : ''}</option>)}
                </Select>
                <Select label="Start from quotation template" value={templateId} onChange={e => setTemplateId(e.target.value)} hint="Copies the plan and product lines.">
                  <option value="">None (choose plan and products)</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
                <Select label="Plan" required={!template} disabled={!!template} value={template ? String(template.plan_id) : planId} onChange={e => setPlanId(e.target.value)}
                  hint={plan ? `Billed ${plan.billing_interval}${plan.min_quantity > 1 ? `, minimum quantity ${plan.min_quantity}` : ''}` : undefined}>
                  {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </div>
            </section>

            {!template && (
              <section>
                <h3 className="text-sm font-semibold text-slate-900 mb-2">2. Products and variants</h3>
                <div className="space-y-2">
                  {lines.map((l, i) => {
                    const product = products.find(p => p.id === l.product_id);
                    return (
                      <div key={i} className="grid grid-cols-1 sm:grid-cols-[2fr_2fr_6rem_auto] gap-2 items-end">
                        <Select label="Product" value={l.product_id} onChange={e => {
                          const np = products.find(p => p.id === Number(e.target.value));
                          setLines(lines.map((x, j) => j === i ? { product_id: Number(e.target.value), variant_id: np?.variants?.[0]?.id ?? null, quantity: x.quantity } : x));
                        }}>
                          {products.map(p => <option key={p.id} value={p.id}>{p.name} ({formatMoney(p.sales_price)})</option>)}
                        </Select>
                        <Select label="Variant" disabled={!product?.variants?.length} value={l.variant_id ?? ''} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, variant_id: e.target.value ? Number(e.target.value) : null } : x))}>
                          {!product?.variants?.length && <option value="">No variants</option>}
                          {product?.variants?.map(v => <option key={v.id} value={v.id}>{v.attribute_name}: {v.option_name}{v.price_extra ? ` (+${formatMoney(v.price_extra)})` : ''}</option>)}
                        </Select>
                        <Input label="Quantity" type="number" min={1} required value={l.quantity} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x))} />
                        <Button size="sm" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label={`Remove line ${i + 1}`} className="mb-0.5">Remove</Button>
                      </div>
                    );
                  })}
                  <Button size="sm" onClick={() => products[0] && setLines([...lines, { product_id: products[0].id, variant_id: products[0].variants?.[0]?.id ?? null, quantity: 1 }])}>Add product line</Button>
                </div>
              </section>
            )}

            <section>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">{template ? '2' : '3'}. Dates, payment terms and discount</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Input label="Start date" type="date" required value={startDate} onChange={e => setStartDate(e.target.value)} />
                <Input label="Expiry date" type="date" min={startDate} value={expiryDate} onChange={e => setExpiryDate(e.target.value)} error={dateProblem} />
                <Select label="Payment terms" required value={terms} onChange={e => setTerms(e.target.value)}>
                  {TERMS.map(t => <option key={t}>{t}</option>)}
                </Select>
                <Select label="Discount rule" value={discountId} onChange={e => setDiscountId(e.target.value)} wrapperClassName="sm:col-span-3" hint="Applied automatically to each invoice while it is valid.">
                  <option value="">No discount</option>
                  {discounts.map(d => <option key={d.id} value={d.id}>{d.code}: {d.description}</option>)}
                </Select>
                <Textarea label="Notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)} wrapperClassName="sm:col-span-3" />
              </div>
            </section>

            <section aria-live="polite">
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Review</h3>
              {minQtyProblem && <div className="mb-2"><Alert kind="error">{minQtyProblem}</Alert></div>}
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                <div className="flex flex-wrap justify-between gap-2 mb-2">
                  <span><span className="text-slate-500">Customer:</span> {customer ? `${customer.full_name}${customer.company_name ? `, ${customer.company_name}` : ''}` : '—'}</span>
                  <span><span className="text-slate-500">Plan:</span> {plan?.name ?? '—'}{plan ? ` (${plan.billing_interval})` : ''}</span>
                </div>
                <table className="w-full">
                  <tbody>
                    {reviewLines.map((l, i) => (
                      <tr key={i} className="border-t border-slate-200">
                        <td className="py-1.5">{l.name}{l.variant && <span className="text-slate-500"> · {l.variant}</span>}</td>
                        <td className="py-1.5 text-right tabular-nums whitespace-nowrap">{l.qty} × {formatMoney(l.unit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-slate-500 mt-2">Unit price = product price + variant extra, fixed on the line when you create the subscription. Tax and discount are applied on each invoice.</p>
              </div>
            </section>
          </form>
        </Modal>
      )}
    </div>
  );
};
