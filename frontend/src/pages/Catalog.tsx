import React, { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import { Product, Plan, TaxRule, DiscountRule, QuotationTemplate, User } from '../types.js';
import {
  Package, Tag, Percent, Receipt, FileText, Plus,
  CheckCircle, AlertCircle, Sparkles, Layers, ShieldCheck
} from 'lucide-react';

interface CatalogProps {
  currentUser: User | null;
  onSelectTemplate?: (templateId: number) => void;
}

export const Catalog: React.FC<CatalogProps> = ({ currentUser, onSelectTemplate }) => {
  const [activeTab, setActiveTab] = useState<'products' | 'plans' | 'taxes' | 'discounts' | 'templates'>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [taxes, setTaxes] = useState<TaxRule[]>([]);
  const [discounts, setDiscounts] = useState<DiscountRule[]>([]);
  const [templates, setTemplates] = useState<QuotationTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  // Creation modal states
  const [showProductModal, setShowProductModal] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [showTaxModal, setShowTaxModal] = useState(false);

  // Form states
  const [newProdName, setNewProdName] = useState('');
  const [newProdType, setNewProdType] = useState<'software' | 'service' | 'addon'>('software');
  const [newProdSalesPrice, setNewProdSalesPrice] = useState(1200);
  const [newProdCostPrice, setNewProdCostPrice] = useState(300);
  const [newProdVariantName, setNewProdVariantName] = useState('Odoo Enterprise Edition');
  const [newProdVariantExtra, setNewProdVariantExtra] = useState(560);

  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanInterval, setNewPlanInterval] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('monthly');
  const [newPlanPrice, setNewPlanPrice] = useState(1200);
  const [newPlanAutoClose, setNewPlanAutoClose] = useState(false);

  const [newTaxName, setNewTaxName] = useState('');
  const [newTaxRate, setNewTaxRate] = useState(18);

  const [newDiscCode, setNewDiscCode] = useState('');
  const [newDiscDesc, setNewDiscDesc] = useState('');
  const [newDiscType, setNewDiscType] = useState<'percentage' | 'fixed'>('percentage');
  const [newDiscVal, setNewDiscVal] = useState(15);
  const [newDiscMinAmount, setNewDiscMinAmount] = useState(0);
  const [newDiscMaxUses, setNewDiscMaxUses] = useState(50);

  const loadData = async () => {
    setLoading(true);
    try {
      const [prodRes, planRes, taxRes, discRes, tplRes] = await Promise.all([
        api.getProducts(),
        api.getPlans(),
        api.getTaxes(),
        api.getDiscounts(),
        api.getQuotationTemplates()
      ]);
      setProducts(prodRes.products);
      setPlans(planRes.plans);
      setTaxes(taxRes.taxes);
      setDiscounts(discRes.discounts);
      setTemplates(tplRes.templates);
    } catch (err: any) {
      alert('Error loading catalog: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createProduct({
        name: newProdName,
        type: newProdType,
        sales_price: Number(newProdSalesPrice),
        cost_price: Number(newProdCostPrice),
        variants: newProdVariantName ? [
          { attribute_name: 'Brand', option_name: 'Standard', price_extra: 0 },
          { attribute_name: 'Brand', option_name: newProdVariantName, price_extra: Number(newProdVariantExtra) }
        ] : []
      });
      setShowProductModal(false);
      loadData();
    } catch (err: any) {
      alert('Failed: ' + err.message);
    }
  };

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createPlan({
        name: newPlanName,
        billing_interval: newPlanInterval,
        price: Number(newPlanPrice),
        auto_close: newPlanAutoClose ? 1 : 0
      });
      setShowPlanModal(false);
      loadData();
    } catch (err: any) {
      alert('Failed: ' + err.message);
    }
  };

  const handleCreateTax = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createTax({
        name: newTaxName,
        rate_percentage: Number(newTaxRate),
        is_default: 0
      });
      setShowTaxModal(false);
      loadData();
    } catch (err: any) {
      alert('Failed: ' + err.message);
    }
  };

  const handleCreateDiscount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createDiscount({
        code: newDiscCode,
        description: newDiscDesc,
        discount_type: newDiscType,
        value: Number(newDiscVal),
        min_amount: Number(newDiscMinAmount),
        max_uses: Number(newDiscMaxUses),
        applies_to: 'all'
      });
      setShowDiscountModal(false);
      loadData();
    } catch (err: any) {
      alert('Failed: ' + err.message);
    }
  };

  const isAdmin = currentUser?.role === 'admin';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Catalog & Commercial Rules Master</h1>
          <p className="text-sm text-slate-500 mt-1">
            Admin configuration for Products, Brand Variants, Subscription Plans, Tax Rules, and Discount Engines.
          </p>
        </div>

        {isAdmin ? (
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 bg-purple-100 text-odoo-500 rounded text-xs font-bold">
              Admin Authoring Enabled
            </span>
          </div>
        ) : (
          <div className="text-xs text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200">
            Read-only mode (Only Admin can add/modify master catalog & discount rules)
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('products')}
          className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 ${
            activeTab === 'products' ? 'bg-odoo-500 text-white shadow-sm' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Package className="w-4 h-4" /> Products & Variants ({products.length})
        </button>

        <button
          onClick={() => setActiveTab('plans')}
          className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 ${
            activeTab === 'plans' ? 'bg-odoo-500 text-white shadow-sm' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Layers className="w-4 h-4" /> Billing Plans ({plans.length})
        </button>

        <button
          onClick={() => setActiveTab('templates')}
          className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 ${
            activeTab === 'templates' ? 'bg-odoo-500 text-white shadow-sm' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <FileText className="w-4 h-4" /> Quotation Templates ({templates.length})
        </button>

        <button
          onClick={() => setActiveTab('taxes')}
          className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 ${
            activeTab === 'taxes' ? 'bg-odoo-500 text-white shadow-sm' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Receipt className="w-4 h-4" /> Tax Rules ({taxes.length})
        </button>

        <button
          onClick={() => setActiveTab('discounts')}
          className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 ${
            activeTab === 'discounts' ? 'bg-odoo-500 text-white shadow-sm' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Percent className="w-4 h-4" /> Discount Rules ({discounts.length})
        </button>
      </div>

      {/* Tab 1: Products & Variants */}
      {activeTab === 'products' && (
        <div className="space-y-4">
          {isAdmin && (
            <div className="flex justify-end">
              <button
                onClick={() => setShowProductModal(true)}
                className="px-3.5 py-1.5 bg-odoo-500 hover:bg-odoo-600 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm"
              >
                <Plus className="w-4 h-4" /> Add Product with Variants
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {products.map(p => (
              <div key={p.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">{p.name}</h3>
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 uppercase font-semibold">
                      {p.type}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-black text-slate-900">${p.sales_price.toFixed(2)}</div>
                    <div className="text-xs text-slate-400">Cost: ${p.cost_price.toFixed(2)}</div>
                  </div>
                </div>

                {p.notes && <p className="text-xs text-slate-500">{p.notes}</p>}

                {/* Variants Badge List */}
                <div className="border-t border-slate-100 pt-3">
                  <div className="text-xs font-bold text-slate-700 mb-2">Configured Variants:</div>
                  {p.variants && p.variants.length > 0 ? (
                    <div className="space-y-1.5">
                      {p.variants.map(v => (
                        <div key={v.id} className="flex justify-between items-center text-xs p-2 bg-slate-50 rounded border border-slate-100">
                          <div>
                            <span className="font-medium text-slate-800">{v.option_name}</span>
                            <span className="text-slate-400 text-[11px] ml-1">({v.attribute_name})</span>
                          </div>
                          <span className={`font-mono font-bold ${v.price_extra > 0 ? 'text-odoo-500' : 'text-slate-600'}`}>
                            {v.price_extra > 0 ? `+$${v.price_extra.toFixed(2)}` : 'Base price ($0.00)'}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">Standard single SKU (no variant adjustments)</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 2: Plans */}
      {activeTab === 'plans' && (
        <div className="space-y-4">
          {isAdmin && (
            <div className="flex justify-end">
              <button
                onClick={() => setShowPlanModal(true)}
                className="px-3.5 py-1.5 bg-odoo-500 hover:bg-odoo-600 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm"
              >
                <Plus className="w-4 h-4" /> Add Plan
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {plans.map(p => (
              <div key={p.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs uppercase font-bold text-slate-500 tracking-wider">{p.billing_interval}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">Active</span>
                  </div>
                  <h3 className="font-bold text-slate-900 text-lg mt-2">{p.name}</h3>
                  <div className="text-2xl font-black text-odoo-500 mt-1">
                    ${p.price.toFixed(2)}
                    <span className="text-xs text-slate-400 font-normal"> / {p.billing_interval}</span>
                  </div>
                </div>

                <div className="text-xs space-y-1.5 border-t border-slate-100 pt-3">
                  <div className="flex justify-between text-slate-600">
                    <span>Min Quantity:</span>
                    <span className="font-bold text-slate-800">{p.min_quantity}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Auto-close on end:</span>
                    <span className="font-bold text-slate-800">{p.auto_close ? 'Yes' : 'No'}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Can pause early:</span>
                    <span className="font-bold text-slate-800">{p.can_pause ? 'Yes' : 'No'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 3: Quotation Templates */}
      {activeTab === 'templates' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {templates.map(t => (
              <div key={t.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">{t.name}</h3>
                    <div className="text-xs text-odoo-500 font-medium">Plan: {t.plan_name} ({t.billing_interval})</div>
                  </div>
                  <span className="px-2.5 py-0.5 bg-blue-100 text-blue-800 text-xs font-bold rounded">
                    Valid for {t.validity_days} days
                  </span>
                </div>

                {t.notes && <p className="text-xs text-slate-500">{t.notes}</p>}

                <div className="border-t border-slate-100 pt-3">
                  <div className="text-xs font-bold text-slate-700 mb-2">Pre-Configured Lines:</div>
                  <div className="space-y-1 text-xs">
                    {t.lines.map(l => (
                      <div key={l.id} className="p-2 bg-slate-50 rounded flex justify-between items-center">
                        <div>
                          <span className="font-semibold text-slate-800">{l.product_name}</span>
                          {l.option_name && <span className="text-odoo-500 ml-1">({l.option_name})</span>}
                          <span className="text-slate-400 ml-2">Qty: {l.default_quantity}</span>
                        </div>
                        <span className="font-mono text-slate-700 font-semibold">${l.sales_price.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 4: Tax Rules */}
      {activeTab === 'taxes' && (
        <div className="space-y-4">
          {isAdmin && (
            <div className="flex justify-end">
              <button
                onClick={() => setShowTaxModal(true)}
                className="px-3.5 py-1.5 bg-odoo-500 hover:bg-odoo-600 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm"
              >
                <Plus className="w-4 h-4" /> Add Tax Rule
              </button>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Tax Rule Name</th>
                  <th className="px-4 py-3">Rate</th>
                  <th className="px-4 py-3">Default Tax Rule</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {taxes.map(t => (
                  <tr key={t.id}>
                    <td className="px-4 py-3 font-semibold text-slate-800">{t.name}</td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-900">{t.rate_percentage.toFixed(1)}%</td>
                    <td className="px-4 py-3">
                      {t.is_default ? (
                        <span className="px-2 py-0.5 rounded text-xs font-bold bg-purple-100 text-odoo-500">Default Applied</span>
                      ) : (
                        <span className="text-xs text-slate-400">Secondary</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800">Active</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 5: Discount Rules */}
      {activeTab === 'discounts' && (
        <div className="space-y-4">
          {isAdmin && (
            <div className="flex justify-end">
              <button
                onClick={() => setShowDiscountModal(true)}
                className="px-3.5 py-1.5 bg-odoo-500 hover:bg-odoo-600 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm"
              >
                <Plus className="w-4 h-4" /> Add Discount Rule
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {discounts.map(d => (
              <div key={d.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="font-mono text-base font-black text-odoo-500 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                      {d.code}
                    </span>
                    <p className="text-xs text-slate-600 mt-2 font-medium">{d.description}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-xl font-black text-slate-900">
                      {d.value}{d.discount_type === 'percentage' ? '%' : '$'} OFF
                    </span>
                    <div className="text-[11px] text-slate-400 uppercase font-semibold">{d.discount_type} discount</div>
                  </div>
                </div>

                <div className="text-xs space-y-1.5 border-t border-slate-100 pt-3">
                  <div className="flex justify-between text-slate-600">
                    <span>Usage Count / Cap:</span>
                    <span className="font-bold text-slate-900">
                      {d.current_uses} / {d.max_uses > 0 ? d.max_uses : 'Unlimited'}
                    </span>
                  </div>
                  {d.min_amount > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>Min Purchase:</span>
                      <span className="font-bold text-slate-900">${d.min_amount}</span>
                    </div>
                  )}
                  {d.min_quantity > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>Min Quantity:</span>
                      <span className="font-bold text-slate-900">{d.min_quantity} seats</span>
                    </div>
                  )}
                  <div className="flex justify-between text-slate-600">
                    <span>Validity Window:</span>
                    <span className="text-slate-800 font-mono text-[11px]">
                      {d.start_date || 'Evergreen'} → {d.end_date || 'Evergreen'}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Applies To:</span>
                    <span className="font-semibold text-slate-800 capitalize">
                      {d.applies_to} {d.target_product_name ? `(${d.target_product_name})` : ''}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal: Add Product */}
      {showProductModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-slate-200">
            <h3 className="font-bold text-slate-900 text-lg mb-4">Add Product with Variant</h3>
            <form onSubmit={handleCreateProduct} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Product Name</label>
                <input required type="text" value={newProdName} onChange={e => setNewProdName(e.target.value)} className="w-full border p-2 rounded" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Sales Price ($)</label>
                  <input required type="number" value={newProdSalesPrice} onChange={e => setNewProdSalesPrice(Number(e.target.value))} className="w-full border p-2 rounded" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Cost Price ($)</label>
                  <input required type="number" value={newProdCostPrice} onChange={e => setNewProdCostPrice(Number(e.target.value))} className="w-full border p-2 rounded" />
                </div>
              </div>
              <div className="border-t pt-3">
                <span className="text-xs font-bold text-slate-700 block mb-2">Variant Config (e.g. Odoo Edition +560)</span>
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" placeholder="Option Name" value={newProdVariantName} onChange={e => setNewProdVariantName(e.target.value)} className="border p-2 rounded text-xs" />
                  <input type="number" placeholder="Extra $" value={newProdVariantExtra} onChange={e => setNewProdVariantExtra(Number(e.target.value))} className="border p-2 rounded text-xs" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button type="button" onClick={() => setShowProductModal(false)} className="px-3 py-1.5 border rounded">Cancel</button>
                <button type="submit" className="px-4 py-1.5 bg-odoo-500 text-white rounded font-bold">Save Product</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Plan */}
      {showPlanModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-slate-200">
            <h3 className="font-bold text-slate-900 text-lg mb-4">Add Subscription Plan</h3>
            <form onSubmit={handleCreatePlan} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Plan Name</label>
                <input required type="text" value={newPlanName} onChange={e => setNewPlanName(e.target.value)} className="w-full border p-2 rounded" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Billing Interval</label>
                  <select value={newPlanInterval} onChange={e => setNewPlanInterval(e.target.value as any)} className="w-full border p-2 rounded bg-white">
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Base Price ($)</label>
                  <input required type="number" value={newPlanPrice} onChange={e => setNewPlanPrice(Number(e.target.value))} className="w-full border p-2 rounded" />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <input type="checkbox" id="autoclose" checked={newPlanAutoClose} onChange={e => setNewPlanAutoClose(e.target.checked)} />
                <label htmlFor="autoclose" className="text-xs font-medium text-slate-700">Auto-close when plan expires</label>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button type="button" onClick={() => setShowPlanModal(false)} className="px-3 py-1.5 border rounded">Cancel</button>
                <button type="submit" className="px-4 py-1.5 bg-odoo-500 text-white rounded font-bold">Save Plan</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Tax */}
      {showTaxModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-slate-200">
            <h3 className="font-bold text-slate-900 text-lg mb-4">Add Tax Rule</h3>
            <form onSubmit={handleCreateTax} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Tax Rule Name</label>
                <input required type="text" value={newTaxName} onChange={e => setNewTaxName(e.target.value)} placeholder="e.g. State Sales Tax (8%)" className="w-full border p-2 rounded" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Rate Percentage (%)</label>
                <input required type="number" step="0.1" value={newTaxRate} onChange={e => setNewTaxRate(Number(e.target.value))} className="w-full border p-2 rounded" />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button type="button" onClick={() => setShowTaxModal(false)} className="px-3 py-1.5 border rounded">Cancel</button>
                <button type="submit" className="px-4 py-1.5 bg-odoo-500 text-white rounded font-bold">Save Tax</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Discount Rule */}
      {showDiscountModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-slate-200">
            <h3 className="font-bold text-slate-900 text-lg mb-4">Add Discount Rule (Admin Only)</h3>
            <form onSubmit={handleCreateDiscount} className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Code</label>
                <input required type="text" value={newDiscCode} onChange={e => setNewDiscCode(e.target.value.toUpperCase())} placeholder="e.g. FLASH25" className="w-full border p-2 rounded font-mono uppercase" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Description</label>
                <input required type="text" value={newDiscDesc} onChange={e => setNewDiscDesc(e.target.value)} placeholder="e.g. 25% off annual volume tier" className="w-full border p-2 rounded" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Type</label>
                  <select value={newDiscType} onChange={e => setNewDiscType(e.target.value as any)} className="w-full border p-2 rounded bg-white">
                    <option value="percentage">Percentage (%)</option>
                    <option value="fixed">Fixed ($)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Value</label>
                  <input required type="number" value={newDiscVal} onChange={e => setNewDiscVal(Number(e.target.value))} className="w-full border p-2 rounded" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Min Order ($)</label>
                  <input type="number" value={newDiscMinAmount} onChange={e => setNewDiscMinAmount(Number(e.target.value))} className="w-full border p-2 rounded" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Max Uses Cap</label>
                  <input type="number" value={newDiscMaxUses} onChange={e => setNewDiscMaxUses(Number(e.target.value))} className="w-full border p-2 rounded" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button type="button" onClick={() => setShowDiscountModal(false)} className="px-3 py-1.5 border rounded">Cancel</button>
                <button type="submit" className="px-4 py-1.5 bg-odoo-500 text-white rounded font-bold">Save Discount</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
