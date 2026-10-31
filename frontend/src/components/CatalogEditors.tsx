import React, { useState } from 'react';
import { api } from '../services/api.js';
import { DiscountRule, Plan, Product, QuotationTemplate } from '../types.js';
import { Alert, Button, Checkbox, Input, Modal, Select } from './ui.js';

/** Plain-text form of a stored amount for an input ("1560" -> "1560.00"). */
const amountText = (n: number | null | undefined) => (n === null || n === undefined ? '' : Number(n).toFixed(2));

interface EditorProps<T> {
  item: T;
  onClose: () => void;
  /** Called after a successful save with the message to show. */
  onSaved: (message: string) => void;
}

/** Shared shell: modal, error banner, submit button and the "keeps history" note. */
const EditorShell: React.FC<{
  title: string;
  formId: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  note?: string;
  size?: 'md' | 'lg';
  children: React.ReactNode;
}> = ({ title, formId, saving, error, onClose, onSubmit, note, size = 'md', children }) => (
  <Modal
    title={title}
    size={size}
    onClose={onClose}
    footer={<><Button onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" type="submit" form={formId} loading={saving}>Save changes</Button></>}
  >
    {error && <div className="mb-3"><Alert kind="error">{error}</Alert></div>}
    <form id={formId} onSubmit={onSubmit} className="space-y-3">
      {children}
    </form>
    {note && <p className="text-xs text-slate-500 mt-3">{note}</p>}
  </Modal>
);

function useSave(onSaved: (m: string) => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (e: React.FormEvent, fn: () => Promise<{ message: string }[] | { message: string }>) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fn();
      onSaved((Array.isArray(res) ? res[res.length - 1] : res)?.message ?? 'Saved.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };
  return { saving, error, run };
}

// ---- Product (and its variants) -----------------------------------------------------------------

export const EditProductModal: React.FC<EditorProps<Product>> = ({ item, onClose, onSaved }) => {
  const [name, setName] = useState(item.name);
  const [type, setType] = useState(item.type);
  const [sales, setSales] = useState(amountText(item.sales_price));
  const [cost, setCost] = useState(amountText(item.cost_price));
  const [notes, setNotes] = useState(item.notes ?? '');
  const [active, setActive] = useState(item.is_active !== 0);
  const [variants, setVariants] = useState((item.variants ?? []).map(v => ({ id: v.id, attribute_name: v.attribute_name, option_name: v.option_name, price_extra: amountText(v.price_extra) })));
  const { saving, error, run } = useSave(onSaved);

  return (
    <EditorShell
      title={`Edit ${item.name}`} formId="edit-product" size="lg" saving={saving} error={error} onClose={onClose}
      note="Existing subscription lines and issued invoices keep the price they were created with. A change applies to lines created from now on."
      onSubmit={e => run(e, async () => {
        const out = [await api.updateProduct(item.id, { name, type, sales_price: sales, cost_price: cost, notes, is_active: active })];
        for (const v of variants) {
          const orig = item.variants?.find(x => x.id === v.id);
          if (orig && (orig.attribute_name !== v.attribute_name || orig.option_name !== v.option_name || amountText(orig.price_extra) !== v.price_extra)) {
            out.push(await api.updateVariant(v.id, { attribute_name: v.attribute_name, option_name: v.option_name, price_extra: v.price_extra }));
          }
        }
        return { message: `${name} updated.` };
      })}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input label="Name" required value={name} onChange={e => setName(e.target.value)} />
        <Select label="Type" required value={type} onChange={e => setType(e.target.value as Product['type'])}>
          <option value="software">Software</option><option value="addon">Add-on</option><option value="service">Service</option><option value="consumable">Consumable</option>
        </Select>
        <Input label="Sales price (INR)" required inputMode="decimal" value={sales} onChange={e => setSales(e.target.value)} />
        <Input label="Cost price (INR)" required inputMode="decimal" value={cost} onChange={e => setCost(e.target.value)} />
      </div>
      <Input label="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
      {variants.length > 0 && (
        <fieldset className="border border-slate-200 rounded-md p-3">
          <legend className="px-1 text-sm font-medium text-slate-800">Variants</legend>
          {variants.map((v, i) => (
            <div key={v.id} className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
              <Input label="Attribute" value={v.attribute_name} onChange={e => setVariants(variants.map((x, j) => j === i ? { ...x, attribute_name: e.target.value } : x))} />
              <Input label="Option" value={v.option_name} onChange={e => setVariants(variants.map((x, j) => j === i ? { ...x, option_name: e.target.value } : x))} />
              <Input label="Price extra" inputMode="decimal" value={v.price_extra} onChange={e => setVariants(variants.map((x, j) => j === i ? { ...x, price_extra: e.target.value } : x))} />
            </div>
          ))}
        </fieldset>
      )}
      <Checkbox label="Active (inactive products cannot be added to new subscriptions)" checked={active} onChange={e => setActive(e.target.checked)} />
    </EditorShell>
  );
};

// ---- Plan -----------------------------------------------------------------------------------------

export const EditPlanModal: React.FC<EditorProps<Plan>> = ({ item, onClose, onSaved }) => {
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(amountText(item.price));
  const [minQty, setMinQty] = useState(String(item.min_quantity));
  const [start, setStart] = useState(item.start_date ?? '');
  const [end, setEnd] = useState(item.end_date ?? '');
  const [autoClose, setAutoClose] = useState(!!item.auto_close);
  const [closeEarly, setCloseEarly] = useState(item.can_close_early !== 0);
  const [canPause, setCanPause] = useState(!!item.can_pause);
  const [canRenew, setCanRenew] = useState(!!item.can_renew);
  const [active, setActive] = useState(item.is_active !== 0);
  const { saving, error, run } = useSave(onSaved);

  return (
    <EditorShell
      title={`Edit plan ${item.name}`} formId="edit-plan" saving={saving} error={error} onClose={onClose}
      note="The billing cadence cannot be changed, so existing billing cycles stay intact. Create a new plan for a different cadence."
      onSubmit={e => run(e, () => api.updatePlan(item.id, {
        name, price, min_quantity: Number(minQty), start_date: start || null, end_date: end || null,
        auto_close: autoClose, can_close_early: closeEarly, can_pause: canPause, can_renew: canRenew, is_active: active
      }))}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input label="Name" required value={name} onChange={e => setName(e.target.value)} />
        <Input label="Billed" value={item.billing_interval} disabled readOnly />
        <Input label="Plan price (INR)" required inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} />
        <Input label="Minimum quantity" required type="number" min={1} value={minQty} onChange={e => setMinQty(e.target.value)} />
        <Input label="Available from" type="date" value={start} onChange={e => setStart(e.target.value)} />
        <Input label="Available until" type="date" min={start || undefined} value={end} onChange={e => setEnd(e.target.value)} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Checkbox label="Close automatically at expiry" checked={autoClose} onChange={e => setAutoClose(e.target.checked)} />
        <Checkbox label="Customer may close early" checked={closeEarly} onChange={e => setCloseEarly(e.target.checked)} />
        <Checkbox label="Customer may pause" checked={canPause} onChange={e => setCanPause(e.target.checked)} />
        <Checkbox label="Customer may renew" checked={canRenew} onChange={e => setCanRenew(e.target.checked)} />
      </div>
      <Checkbox label="Active (inactive plans cannot be used for new subscriptions)" checked={active} onChange={e => setActive(e.target.checked)} />
    </EditorShell>
  );
};

// ---- Discount -------------------------------------------------------------------------------------

export const EditDiscountModal: React.FC<EditorProps<DiscountRule>> = ({ item, onClose, onSaved }) => {
  const [description, setDescription] = useState(item.description);
  const [value, setValue] = useState(amountText(item.value));
  const [minAmount, setMinAmount] = useState(amountText(item.min_amount));
  const [minQty, setMinQty] = useState(String(item.min_quantity ?? 0));
  const [start, setStart] = useState(item.start_date ?? '');
  const [end, setEnd] = useState(item.end_date ?? '');
  const [maxUses, setMaxUses] = useState(String(item.max_uses ?? 0));
  const [active, setActive] = useState(item.is_active !== 0);
  const { saving, error, run } = useSave(onSaved);

  return (
    <EditorShell
      title={`Edit discount ${item.code}`} formId="edit-discount" saving={saving} error={error} onClose={onClose}
      note="Invoices already issued are unchanged. Turn the rule off to stop it applying to future invoices; it detaches itself automatically when its end date or usage limit is reached."
      onSubmit={e => run(e, () => api.updateDiscount(item.id, {
        description, value, min_amount: minAmount || '0', min_quantity: Number(minQty || 0),
        start_date: start || null, end_date: end || null, max_uses: Number(maxUses || 0), is_active: active
      }))}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input label="Code" value={item.code} disabled readOnly />
        <Input label={item.discount_type === 'percentage' ? 'Percentage off' : 'Amount off (INR)'} required inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} />
        <Input label="Description" required wrapperClassName="sm:col-span-2" value={description} onChange={e => setDescription(e.target.value)} />
        <Input label="Minimum order amount" inputMode="decimal" value={minAmount} onChange={e => setMinAmount(e.target.value)} />
        <Input label="Minimum quantity" type="number" min={0} value={minQty} onChange={e => setMinQty(e.target.value)} />
        <Input label="Valid from" type="date" value={start} onChange={e => setStart(e.target.value)} />
        <Input label="Valid until" type="date" min={start || undefined} value={end} onChange={e => setEnd(e.target.value)} />
        <Input label="Maximum uses (0 = unlimited)" type="number" min={0} value={maxUses} onChange={e => setMaxUses(e.target.value)} hint={`${item.current_uses} used so far`} />
      </div>
      <Checkbox label="Active" checked={active} onChange={e => setActive(e.target.checked)} />
    </EditorShell>
  );
};

// ---- Quotation template ---------------------------------------------------------------------------

export const EditTemplateModal: React.FC<EditorProps<QuotationTemplate>> = ({ item, onClose, onSaved }) => {
  const [name, setName] = useState(item.name);
  const [days, setDays] = useState(String(item.validity_days));
  const [notes, setNotes] = useState(item.notes ?? '');
  const [active, setActive] = useState(item.is_active !== 0);
  const { saving, error, run } = useSave(onSaved);

  return (
    <EditorShell
      title={`Edit template ${item.name}`} formId="edit-template" saving={saving} error={error} onClose={onClose}
      note="Quotations already sent keep the validity they were sent with."
      onSubmit={e => run(e, () => api.updateQuotationTemplate(item.id, { name, validity_days: Number(days), notes, is_active: active }))}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input label="Name" required value={name} onChange={e => setName(e.target.value)} />
        <Input label="Quotation valid for (days)" required type="number" min={1} value={days} onChange={e => setDays(e.target.value)} />
      </div>
      <Input label="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
      <Checkbox label="Active" checked={active} onChange={e => setActive(e.target.checked)} />
    </EditorShell>
  );
};
