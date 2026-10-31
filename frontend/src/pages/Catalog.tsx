import React, { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import { Product, Plan, TaxRule, DiscountRule, QuotationTemplate, User } from '../types.js';
import { Alert, Button, Card, Checkbox, EmptyState, ErrorState, Input, Loading, Modal, PageHeader, Select, Tabs, table, useToast, cx } from '../components/ui.js';
import { formatDate, formatMoney } from '../lib/format.js';
import { EditDiscountModal, EditPlanModal, EditProductModal, EditTemplateModal } from '../components/CatalogEditors.js';
import { Pencil, Plus } from 'lucide-react';

interface CatalogProps {
  currentUser: User | null;
}

type TabId = 'products' | 'plans' | 'templates' | 'taxes' | 'discounts';

/** Adds two stored 2-decimal amounts exactly (integer cents) for the list-price preview only. */
const addMoney = (a: number, b: number) => (Math.round(a * 100) + Math.round(b * 100)) / 100;

const Chip: React.FC<{ on: boolean; label: string }> = ({ on, label }) => (
  <span className={cx('inline-flex items-center rounded border px-1.5 py-0.5 text-xs whitespace-nowrap', on ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-300 bg-slate-50 text-slate-500')}>
    {label}: {on ? 'Yes' : 'No'}
  </span>
);

export const Catalog: React.FC<CatalogProps> = ({ currentUser }) => {
  const toast = useToast();
  const isAdmin = currentUser?.role === 'admin';
  const [tab, setTab] = useState<TabId>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [taxes, setTaxes] = useState<TaxRule[]>([]);
  const [discounts, setDiscounts] = useState<DiscountRule[]>([]);
  const [templates, setTemplates] = useState<QuotationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | TabId>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<
    | { kind: 'product'; item: Product } | { kind: 'plan'; item: Plan }
    | { kind: 'discount'; item: DiscountRule } | { kind: 'template'; item: QuotationTemplate } | null
  >(null);

  // product form
  const [pName, setPName] = useState('');
  const [pType, setPType] = useState<'software' | 'service' | 'addon' | 'consumable'>('software');
  const [pSales, setPSales] = useState('');
  const [pCost, setPCost] = useState('');
  const [pNotes, setPNotes] = useState('');
  const [pVariants, setPVariants] = useState<Array<{ attribute_name: string; option_name: string; price_extra: string }>>([]);
  // plan form
  const [plName, setPlName] = useState('');
  const [plInterval, setPlInterval] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('monthly');
  const [plPrice, setPlPrice] = useState('0');
  const [plMin, setPlMin] = useState('1');
  const [plStart, setPlStart] = useState('');
  const [plEnd, setPlEnd] = useState('');
  const [plAutoClose, setPlAutoClose] = useState(false);
  const [plCanClose, setPlCanClose] = useState(true);
  const [plCanPause, setPlCanPause] = useState(true);
  const [plCanRenew, setPlCanRenew] = useState(true);
  // tax form
  const [tName, setTName] = useState('');
  const [tRate, setTRate] = useState('18');
  const [tDefault, setTDefault] = useState(false);
  // discount form
  const [dCode, setDCode] = useState('');
  const [dDesc, setDDesc] = useState('');
  const [dType, setDType] = useState<'percentage' | 'fixed'>('percentage');
  const [dValue, setDValue] = useState('');
  const [dScope, setDScope] = useState<'all' | 'product'>('all');
  const [dProduct, setDProduct] = useState('');
  const [dMinAmount, setDMinAmount] = useState('');
  const [dMinQty, setDMinQty] = useState('');
  const [dStart, setDStart] = useState('');
  const [dEnd, setDEnd] = useState('');
  const [dMaxUses, setDMaxUses] = useState('');
  // template form
  const [tpName, setTpName] = useState('');
  const [tpPlan, setTpPlan] = useState('');
  const [tpDays, setTpDays] = useState('30');
  const [tpLines, setTpLines] = useState<Array<{ product_id: number; variant_id: number | null; quantity: number }>>([]);

  const loadData = async (archived = showArchived) => {
    setLoading(true);
    setLoadError(null);
    try {
      const [prodRes, planRes, taxRes, discRes, tplRes] = await Promise.all([
        api.getProducts(archived), api.getPlans(archived), api.getTaxes(), api.getDiscounts(archived), api.getQuotationTemplates(archived)
      ]);
      setProducts(prodRes.products);
      setPlans(planRes.plans);
      setTaxes(taxRes.taxes);
      setDiscounts(discRes.discounts);
      setTemplates(tplRes.templates);
    } catch (err: any) {
      setLoadError('Unable to load the catalog. ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(showArchived);
  }, [showArchived]);

  const open = (which: TabId) => {
    setFormError(null);
    if (which === 'templates' && tpLines.length === 0 && products[0]) {
      setTpLines([{ product_id: products[0].id, variant_id: products[0].variants?.[0]?.id ?? null, quantity: 1 }]);
      if (!tpPlan && plans[0]) setTpPlan(String(plans[0].id));
    }
    setDialog(which);
  };

  const save = async (e: React.FormEvent, fn: () => Promise<unknown>, done: string) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await fn();
      setDialog(null);
      toast('success', done);
      await loadData();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const submitProduct = (e: React.FormEvent) =>
    save(e, () => api.createProduct({
      name: pName, type: pType, sales_price: pSales, cost_price: pCost, notes: pNotes || undefined,
      variants: pVariants.filter(v => v.attribute_name && v.option_name).map(v => ({ ...v, price_extra: v.price_extra || '0' }))
    }), `Product "${pName}" created.`).then(() => { setPName(''); setPSales(''); setPCost(''); setPNotes(''); setPVariants([]); });

  const submitPlan = (e: React.FormEvent) =>
    save(e, () => api.createPlan({
      name: plName, billing_interval: plInterval, price: plPrice, min_quantity: Number(plMin),
      start_date: plStart || undefined, end_date: plEnd || undefined,
      auto_close: plAutoClose, can_close_early: plCanClose, can_pause: plCanPause, can_renew: plCanRenew
    }), `Plan "${plName}" created.`);

  const submitTax = (e: React.FormEvent) =>
    save(e, () => api.createTax({ name: tName, rate_percentage: Number(tRate), is_default: tDefault }), 'Tax rule created. Invoices created from now on use it.');

  const submitDiscount = (e: React.FormEvent) =>
    save(e, () => api.createDiscount({
      code: dCode, description: dDesc, discount_type: dType, value: dValue, applies_to: dScope,
      target_product_id: dScope === 'product' && dProduct ? Number(dProduct) : undefined,
      min_amount: dMinAmount || undefined, min_quantity: dMinQty ? Number(dMinQty) : undefined,
      start_date: dStart || undefined, end_date: dEnd || undefined, max_uses: dMaxUses ? Number(dMaxUses) : undefined
    }), `Discount ${dCode.toUpperCase()} created.`);

  const submitTemplate = (e: React.FormEvent) =>
    save(e, () => api.createQuotationTemplate({
      name: tpName, plan_id: Number(tpPlan), validity_days: Number(tpDays),
      lines: tpLines.map(l => ({ product_id: l.product_id, variant_id: l.variant_id ?? undefined, default_quantity: l.quantity }))
    }), `Template "${tpName}" created.`);

  const editButton = (target: NonNullable<typeof editing>, label: string) =>
    isAdmin ? (
      <Button size="sm" onClick={() => setEditing(target)} aria-label={`Edit ${label}`}><Pencil className="w-3 h-3" aria-hidden="true" /> Edit</Button>
    ) : null;
  const archivedTag = (isActive: number | undefined) =>
    isActive === 0 ? <span className="ml-2 inline-flex rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">Archived</span> : null;

  const addButton = (which: TabId, label: string) =>
    isAdmin ? <Button variant="primary" onClick={() => open(which)}><Plus className="w-3.5 h-3.5" aria-hidden="true" /> {label}</Button> : undefined;

  const addAction = { products: addButton('products', 'New product'), plans: addButton('plans', 'New plan'), templates: addButton('templates', 'New template'), taxes: addButton('taxes', 'New tax rule'), discounts: addButton('discounts', 'New discount') }[tab];

  return (
    <div>
      <PageHeader
        title="Catalog"
        subtitle={isAdmin ? 'Products, plans, taxes, discounts and quotation templates' : 'Read-only view. Only an admin can change the catalog.'}
        actions={addAction}
      />

      <Tabs
        active={tab}
        onChange={id => setTab(id as TabId)}
        tabs={[
          { id: 'products', label: 'Products and variants', count: products.length },
          { id: 'plans', label: 'Plans', count: plans.length },
          { id: 'templates', label: 'Quotation templates', count: templates.length },
          { id: 'taxes', label: 'Tax rules', count: taxes.length },
          { id: 'discounts', label: 'Discounts', count: discounts.length }
        ]}
      />

      {isAdmin && (tab === 'products' || tab === 'plans' || tab === 'templates' || tab === 'discounts') && (
        <div className="mt-3">
          <Checkbox label="Show archived (inactive) items" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
        </div>
      )}

      <div className="mt-4">
        {loading ? <Loading label="Loading catalog…" /> : loadError ? <ErrorState message={loadError} onRetry={() => loadData()} /> : (
          <>
            {tab === 'products' && (
              <Card flush>
                {products.length === 0 ? <EmptyState title="No products yet" hint={isAdmin ? 'Create a product, then add variants such as a brand with a price extra.' : undefined} /> : (
                  <div className={table.wrap}>
                    <table className={table.table}>
                      <thead className={table.head}>
                        <tr>
                          <th className={table.th}>Product</th>
                          <th className={table.th}>Type</th>
                          <th className={table.thNum}>Sales price</th>
                          {isAdmin && <th className={table.thNum}>Cost price</th>}
                          <th className={table.th}>Variants: price extra → unit price on a new line</th>
                          {isAdmin && <th className={table.thNum}><span className="sr-only">Actions</span></th>}
                        </tr>
                      </thead>
                      <tbody className={table.body}>
                        {products.map(p => (
                          <tr key={p.id} className={table.row}>
                            <td className={table.td + ' align-top'}>
                              <div className="font-medium text-slate-900">{p.name}{archivedTag(p.is_active)}</div>
                              {p.notes && <div className="text-xs text-slate-500 max-w-xs">{p.notes}</div>}
                            </td>
                            <td className={table.td + ' align-top capitalize'}>{p.type}</td>
                            <td className={table.tdNum + ' align-top font-medium'}>{formatMoney(p.sales_price)}</td>
                            {isAdmin && <td className={table.tdNum + ' align-top text-slate-600'}>{formatMoney(p.cost_price)}</td>}
                            <td className={table.td + ' align-top'}>
                              {p.variants && p.variants.length > 0 ? (
                                <ul className="space-y-1">
                                  {p.variants.map(v => (
                                    <li key={v.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                                      <span className="text-slate-800">{v.attribute_name}: {v.option_name}</span>
                                      <span className="text-slate-500">{v.price_extra > 0 ? `+${formatMoney(v.price_extra)}` : 'no extra'}</span>
                                      <span className="text-slate-400">→</span>
                                      <span className="font-medium tabular-nums">{formatMoney(addMoney(p.sales_price, v.price_extra))}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : <span className="text-slate-500 text-sm">No variants</span>}
                            </td>
                            {isAdmin && <td className={table.tdNum + ' align-top'}>{editButton({ kind: 'product', item: p }, p.name)}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}

            {tab === 'plans' && (
              <Card flush>
                {plans.length === 0 ? <EmptyState title="No plans yet" /> : (
                  <div className={table.wrap}>
                    <table className={table.table}>
                      <thead className={table.head}>
                        <tr>
                          <th className={table.th}>Plan</th>
                          <th className={table.th}>Billed</th>
                          <th className={table.thNum}>Min qty</th>
                          <th className={table.th}>Available</th>
                          <th className={table.th}>Lifecycle rules</th>
                          {isAdmin && <th className={table.thNum}><span className="sr-only">Actions</span></th>}
                        </tr>
                      </thead>
                      <tbody className={table.body}>
                        {plans.map(p => (
                          <tr key={p.id} className={table.row}>
                            <td className={table.td + ' font-medium'}>{p.name}{archivedTag(p.is_active)}</td>
                            <td className={table.td + ' capitalize'}>{p.billing_interval}</td>
                            <td className={table.tdNum}>{p.min_quantity}</td>
                            <td className={table.td + ' whitespace-nowrap text-slate-600'}>{p.start_date || p.end_date ? `${formatDate(p.start_date)} to ${formatDate(p.end_date)}` : 'Always'}</td>
                            <td className={table.td}>
                              <div className="flex flex-wrap gap-1">
                                <Chip on={!!p.auto_close} label="Auto-close" />
                                <Chip on={p.can_close_early !== 0} label="Close early" />
                                <Chip on={!!p.can_pause} label="Pause" />
                                <Chip on={!!p.can_renew} label="Renew" />
                              </div>
                            </td>
                            {isAdmin && <td className={table.tdNum}>{editButton({ kind: 'plan', item: p }, p.name)}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}

            {tab === 'templates' && (
              templates.length === 0 ? <Card><EmptyState title="No quotation templates yet" hint={isAdmin ? 'A template bundles a plan and product lines so a quotation can start from it.' : undefined} /></Card> : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {templates.map(t => (
                    <Card key={t.id} title={t.is_active === 0 ? `${t.name} (archived)` : t.name} description={`Plan: ${t.plan_name} (${t.billing_interval}) · quotation valid ${t.validity_days} days`} actions={editButton({ kind: 'template', item: t }, t.name)} flush>
                      <table className={table.table}>
                        <tbody className={table.body}>
                          {t.lines.map(l => (
                            <tr key={l.id}>
                              <td className={table.td}>{l.product_name}{l.option_name && <span className="text-slate-500"> · {l.option_name}</span>}</td>
                              <td className={table.tdNum}>× {l.default_quantity}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Card>
                  ))}
                </div>
              )
            )}

            {tab === 'taxes' && (
              <Card flush>
                {taxes.length === 0 ? <EmptyState title="No tax rules yet" /> : (
                  <table className={table.table}>
                    <thead className={table.head}>
                      <tr><th className={table.th}>Tax rule</th><th className={table.thNum}>Rate</th><th className={table.th}>Used</th></tr>
                    </thead>
                    <tbody className={table.body}>
                      {taxes.map(t => (
                        <tr key={t.id} className={table.row}>
                          <td className={table.td + ' font-medium'}>{t.name}</td>
                          <td className={table.tdNum}>{t.rate_percentage}%</td>
                          <td className={table.td}>{t.is_default ? 'Default for lines without a rule' : 'When chosen on a line'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            )}

            {tab === 'discounts' && (
              <Card flush>
                {discounts.length === 0 ? <EmptyState title="No discount rules yet" hint={isAdmin ? 'Only an admin can create discount rules.' : undefined} /> : (
                  <div className={table.wrap}>
                    <table className={table.table}>
                      <thead className={table.head}>
                        <tr>
                          <th className={table.th}>Code</th>
                          <th className={table.th}>Discount</th>
                          <th className={table.th}>Applies to</th>
                          <th className={table.th}>Conditions</th>
                          <th className={table.th}>Valid</th>
                          <th className={table.thNum}>Used</th>
                          {isAdmin && <th className={table.thNum}><span className="sr-only">Actions</span></th>}
                        </tr>
                      </thead>
                      <tbody className={table.body}>
                        {discounts.map(d => (
                          <tr key={d.id} className={table.row}>
                            <td className={table.td}>
                              <div className="font-medium">{d.code}{archivedTag(d.is_active)}</div>
                              <div className="text-xs text-slate-500">{d.description}</div>
                            </td>
                            <td className={table.td + ' whitespace-nowrap'}>{d.discount_type === 'percentage' ? `${d.value}%` : formatMoney(d.value)}</td>
                            <td className={table.td}>{d.applies_to === 'product' ? d.target_product_name ?? 'One product' : 'Whole subscription'}</td>
                            <td className={table.td + ' text-slate-600'}>
                              {[d.min_amount > 0 && `min ${formatMoney(d.min_amount)}`, d.min_quantity > 0 && `min qty ${d.min_quantity}`].filter(Boolean).join(', ') || 'None'}
                            </td>
                            <td className={table.td + ' whitespace-nowrap text-slate-600'}>{d.start_date || d.end_date ? `${formatDate(d.start_date)} to ${formatDate(d.end_date)}` : 'Always'}</td>
                            <td className={table.tdNum}>{d.current_uses}{d.max_uses > 0 ? ` / ${d.max_uses}` : ''}</td>
                            {isAdmin && <td className={table.tdNum}>{editButton({ kind: 'discount', item: d }, d.code)}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}
          </>
        )}
      </div>

      {editing && (() => {
        const done = (message: string) => { setEditing(null); toast('success', message); loadData(); };
        const close = () => setEditing(null);
        if (editing.kind === 'product') return <EditProductModal item={editing.item} onClose={close} onSaved={done} />;
        if (editing.kind === 'plan') return <EditPlanModal item={editing.item} onClose={close} onSaved={done} />;
        if (editing.kind === 'discount') return <EditDiscountModal item={editing.item} onClose={close} onSaved={done} />;
        return <EditTemplateModal item={editing.item} onClose={close} onSaved={done} />;
      })()}

      {/* New product */}
      {dialog === 'products' && (
        <Modal title="New product" size="lg" onClose={() => setDialog(null)} footer={<><Button onClick={() => setDialog(null)} disabled={saving}>Cancel</Button><Button variant="primary" type="submit" form="product-form" loading={saving}>Create product</Button></>}>
          {formError && <div className="mb-3"><Alert kind="error">{formError}</Alert></div>}
          <form id="product-form" onSubmit={submitProduct} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Name" required value={pName} onChange={e => setPName(e.target.value)} />
              <Select label="Type" required value={pType} onChange={e => setPType(e.target.value as typeof pType)}>
                <option value="software">Software</option><option value="addon">Add-on</option><option value="service">Service</option><option value="consumable">Consumable</option>
              </Select>
              <Input label="Sales price (INR)" required inputMode="decimal" value={pSales} onChange={e => setPSales(e.target.value)} placeholder="1000.00" />
              <Input label="Cost price (INR)" required inputMode="decimal" value={pCost} onChange={e => setPCost(e.target.value)} placeholder="300.00" />
            </div>
            <Input label="Notes" value={pNotes} onChange={e => setPNotes(e.target.value)} />

            <fieldset className="border border-slate-200 rounded-md p-3">
              <legend className="px-1 text-sm font-medium text-slate-800">Variants</legend>
              <p className="text-xs text-slate-500 mb-2">A variant adds a price extra to the product price. A subscription line gets product price + extra, fixed when the line is created.</p>
              {pVariants.map((v, i) => (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_8rem_auto] gap-2 items-end mb-2">
                  <Input label="Attribute" value={v.attribute_name} onChange={e => setPVariants(pVariants.map((x, j) => j === i ? { ...x, attribute_name: e.target.value } : x))} placeholder="Brand" />
                  <Input label="Option" value={v.option_name} onChange={e => setPVariants(pVariants.map((x, j) => j === i ? { ...x, option_name: e.target.value } : x))} placeholder="Odoo" />
                  <Input label="Price extra" inputMode="decimal" value={v.price_extra} onChange={e => setPVariants(pVariants.map((x, j) => j === i ? { ...x, price_extra: e.target.value } : x))} placeholder="560" />
                  <Button size="sm" onClick={() => setPVariants(pVariants.filter((_, j) => j !== i))} aria-label={`Remove variant ${i + 1}`} className="mb-0.5">Remove</Button>
                </div>
              ))}
              <Button size="sm" onClick={() => setPVariants([...pVariants, { attribute_name: 'Brand', option_name: '', price_extra: '' }])}>Add variant</Button>
            </fieldset>
          </form>
        </Modal>
      )}

      {/* New plan */}
      {dialog === 'plans' && (
        <Modal title="New plan" size="lg" onClose={() => setDialog(null)} footer={<><Button onClick={() => setDialog(null)} disabled={saving}>Cancel</Button><Button variant="primary" type="submit" form="plan-form" loading={saving}>Create plan</Button></>}>
          {formError && <div className="mb-3"><Alert kind="error">{formError}</Alert></div>}
          <form id="plan-form" onSubmit={submitPlan} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Plan name" required value={plName} onChange={e => setPlName(e.target.value)} />
              <Select label="Billing cadence" required value={plInterval} onChange={e => setPlInterval(e.target.value as typeof plInterval)}>
                <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
              </Select>
              <Input label="Plan price (INR)" required inputMode="decimal" value={plPrice} onChange={e => setPlPrice(e.target.value)} hint="Reference only. Invoices are built from subscription lines." />
              <Input label="Minimum quantity" required type="number" min={1} value={plMin} onChange={e => setPlMin(e.target.value)} hint="Applies to every product line." />
              <Input label="Available from" type="date" value={plStart} onChange={e => setPlStart(e.target.value)} />
              <Input label="Available to" type="date" min={plStart || undefined} value={plEnd} onChange={e => setPlEnd(e.target.value)} />
            </div>
            <fieldset className="border border-slate-200 rounded-md p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <legend className="px-1 text-sm font-medium text-slate-800">Lifecycle rules</legend>
              <Checkbox label="Close automatically at expiry" checked={plAutoClose} onChange={e => setPlAutoClose(e.target.checked)} />
              <Checkbox label="Can be closed early" checked={plCanClose} onChange={e => setPlCanClose(e.target.checked)} />
              <Checkbox label="Can be paused" checked={plCanPause} onChange={e => setPlCanPause(e.target.checked)} />
              <Checkbox label="Can be renewed" checked={plCanRenew} onChange={e => setPlCanRenew(e.target.checked)} />
            </fieldset>
          </form>
        </Modal>
      )}

      {/* New tax rule */}
      {dialog === 'taxes' && (
        <Modal title="New tax rule" size="sm" onClose={() => setDialog(null)} footer={<><Button onClick={() => setDialog(null)} disabled={saving}>Cancel</Button><Button variant="primary" type="submit" form="tax-form" loading={saving}>Create tax rule</Button></>}>
          {formError && <div className="mb-3"><Alert kind="error">{formError}</Alert></div>}
          <form id="tax-form" onSubmit={submitTax} className="space-y-3">
            <Input label="Name" required value={tName} onChange={e => setTName(e.target.value)} placeholder="GST 18%" />
            <Input label="Rate (%)" required inputMode="decimal" value={tRate} onChange={e => setTRate(e.target.value)} hint="Between 0 and 100, up to 2 decimals." />
            <Checkbox label="Use as the default tax rule" checked={tDefault} onChange={e => setTDefault(e.target.checked)} />
          </form>
        </Modal>
      )}

      {/* New discount */}
      {dialog === 'discounts' && (
        <Modal title="New discount rule" size="lg" onClose={() => setDialog(null)} footer={<><Button onClick={() => setDialog(null)} disabled={saving}>Cancel</Button><Button variant="primary" type="submit" form="discount-form" loading={saving}>Create discount</Button></>}>
          {formError && <div className="mb-3"><Alert kind="error">{formError}</Alert></div>}
          <form id="discount-form" onSubmit={submitDiscount} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Code" required value={dCode} onChange={e => setDCode(e.target.value)} placeholder="SEATS20" />
              <Input label="Description" required value={dDesc} onChange={e => setDDesc(e.target.value)} />
              <Select label="Type" required value={dType} onChange={e => setDType(e.target.value as typeof dType)}>
                <option value="percentage">Percentage</option><option value="fixed">Fixed amount</option>
              </Select>
              <Input label={dType === 'percentage' ? 'Value (%)' : 'Value (INR)'} required inputMode="decimal" value={dValue} onChange={e => setDValue(e.target.value)} />
              <Select label="Applies to" required value={dScope} onChange={e => setDScope(e.target.value as typeof dScope)}>
                <option value="all">Whole subscription</option><option value="product">One product</option>
              </Select>
              {dScope === 'product' && (
                <Select label="Product" required value={dProduct} onChange={e => setDProduct(e.target.value)}>
                  <option value="">Select a product</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              )}
              <Input label="Minimum purchase (INR)" inputMode="decimal" value={dMinAmount} onChange={e => setDMinAmount(e.target.value)} />
              <Input label="Minimum quantity" type="number" min={0} value={dMinQty} onChange={e => setDMinQty(e.target.value)} />
              <Input label="Valid from" type="date" value={dStart} onChange={e => setDStart(e.target.value)} />
              <Input label="Valid to" type="date" min={dStart || undefined} value={dEnd} onChange={e => setDEnd(e.target.value)} />
              <Input label="Usage limit" type="number" min={0} value={dMaxUses} onChange={e => setDMaxUses(e.target.value)} hint="Leave empty for unlimited." />
            </div>
          </form>
        </Modal>
      )}

      {/* New quotation template */}
      {dialog === 'templates' && (
        <Modal title="New quotation template" size="lg" onClose={() => setDialog(null)} footer={<><Button onClick={() => setDialog(null)} disabled={saving}>Cancel</Button><Button variant="primary" type="submit" form="template-form" loading={saving}>Create template</Button></>}>
          {formError && <div className="mb-3"><Alert kind="error">{formError}</Alert></div>}
          <form id="template-form" onSubmit={submitTemplate} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input label="Name" required value={tpName} onChange={e => setTpName(e.target.value)} />
              <Select label="Plan" required value={tpPlan} onChange={e => setTpPlan(e.target.value)}>
                {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              <Input label="Valid for (days)" required type="number" min={1} value={tpDays} onChange={e => setTpDays(e.target.value)} />
            </div>
            <fieldset className="border border-slate-200 rounded-md p-3 space-y-2">
              <legend className="px-1 text-sm font-medium text-slate-800">Lines</legend>
              {tpLines.map((l, i) => {
                const prod = products.find(p => p.id === l.product_id);
                return (
                  <div key={i} className="grid grid-cols-1 sm:grid-cols-[2fr_2fr_6rem_auto] gap-2 items-end">
                    <Select label="Product" value={l.product_id} onChange={e => {
                      const np = products.find(p => p.id === Number(e.target.value));
                      setTpLines(tpLines.map((x, j) => j === i ? { product_id: Number(e.target.value), variant_id: np?.variants?.[0]?.id ?? null, quantity: x.quantity } : x));
                    }}>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                    <Select label="Variant" disabled={!prod?.variants?.length} value={l.variant_id ?? ''} onChange={e => setTpLines(tpLines.map((x, j) => j === i ? { ...x, variant_id: e.target.value ? Number(e.target.value) : null } : x))}>
                      {!prod?.variants?.length && <option value="">No variants</option>}
                      {prod?.variants?.map(v => <option key={v.id} value={v.id}>{v.attribute_name}: {v.option_name}</option>)}
                    </Select>
                    <Input label="Quantity" type="number" min={1} value={l.quantity} onChange={e => setTpLines(tpLines.map((x, j) => j === i ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x))} />
                    <Button size="sm" disabled={tpLines.length === 1} onClick={() => setTpLines(tpLines.filter((_, j) => j !== i))} aria-label={`Remove line ${i + 1}`} className="mb-0.5">Remove</Button>
                  </div>
                );
              })}
              <Button size="sm" onClick={() => products[0] && setTpLines([...tpLines, { product_id: products[0].id, variant_id: products[0].variants?.[0]?.id ?? null, quantity: 1 }])}>Add line</Button>
            </fieldset>
          </form>
        </Modal>
      )}
    </div>
  );
};
