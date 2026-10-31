import React, { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import { DashboardMetrics } from '../types.js';
import {
  TrendingUp, Users, DollarSign, AlertTriangle, Clock,
  CheckCircle2, ArrowUpRight, Zap, RefreshCw, Send, ShieldAlert
} from 'lucide-react';

interface DashboardProps {
  onNavigateToInvoice: (invoiceId: number) => void;
  onNavigateToBilling: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onNavigateToInvoice, onNavigateToBilling }) => {
  const [data, setData] = useState<{
    metrics: DashboardMetrics;
    planBreakdown: any[];
    overdueInvoices: any[];
    recentEvents: any[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getSummary();
      setData(res);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSendReminder = async (invoiceId: number) => {
    try {
      const res = await api.sendInvoice(invoiceId);
      setActionMessage(res.message);
      setTimeout(() => setActionMessage(null), 4000);
      loadData();
    } catch (err: any) {
      alert('Error sending invoice reminder: ' + err.message);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-96">
        <RefreshCw className="w-8 h-8 animate-spin text-odoo-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-800 m-6">
        <h3 className="font-bold flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600" /> Unable to load dashboard metrics
        </h3>
        <p className="text-sm mt-1">{error}</p>
        <button onClick={loadData} className="mt-3 px-3 py-1.5 bg-red-600 text-white rounded text-sm font-medium">
          Retry
        </button>
      </div>
    );
  }

  const metrics = data?.metrics;

  return (
    <div className="space-y-6">
      {/* Top Header & Sub-2-Second Performance SLA Callout */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Executive Finance & Subscriptions Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            Real-time financial telemetry for Brightloop Software across all subscription tiers & recurring billing runs.
          </p>
        </div>

        {/* SLA & Performance Pill */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-3.5 py-2 rounded-lg text-xs font-medium flex items-center gap-2">
            <Zap className="w-4 h-4 text-emerald-600 animate-pulse" />
            <div>
              <span className="font-bold">Sub-2-Second SLA: </span>
              <span className="text-emerald-950 font-bold">{metrics?.performance.queryExecutionTimeMs} ms</span>
              <span className="text-slate-500 ml-1">(Tested on 1,000+ subs)</span>
            </div>
          </div>

          <button
            onClick={() => window.open('/api/analytics/export/invoices', '_blank')}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-semibold border border-slate-300 transition-all flex items-center gap-1.5"
            title="Download CSV for Excel / Accounting"
          >
            <TrendingUp className="w-4 h-4 text-slate-500" /> Export CSV
          </button>

          <button
            onClick={onNavigateToBilling}
            className="px-4 py-2 bg-odoo-500 hover:bg-odoo-600 text-white rounded-lg text-sm font-semibold shadow-sm transition-all flex items-center gap-1.5"
          >
            <Clock className="w-4 h-4" /> Run Billing Cycle
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="bg-emerald-50 border border-emerald-300 text-emerald-800 px-4 py-3 rounded-lg text-sm flex items-center justify-between shadow-sm">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" /> {actionMessage}
          </span>
          <button onClick={() => setActionMessage(null)} className="text-emerald-700 hover:text-emerald-900 font-bold">×</button>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* MRR & ARR */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Monthly Recurring (MRR)</span>
            <div className="p-2 bg-purple-50 text-odoo-500 rounded-lg">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-slate-900">
              ${(metrics?.recurringRevenue.mrr || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
            <div className="text-xs text-slate-500 mt-1 flex items-center gap-1">
              <span>Annualized ARR:</span>
              <span className="font-semibold text-slate-700">
                ${(metrics?.recurringRevenue.arr || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        </div>

        {/* Active Subscriptions */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Subscriptions</span>
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-slate-900">{metrics?.subscriptions.active || 0}</div>
            <div className="text-xs text-slate-500 mt-1">
              Across {metrics?.subscriptions.total || 0} total registered contracts
            </div>
          </div>
        </div>

        {/* Cash Collected vs Owed */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Cash Collected</span>
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-emerald-700">
              ${(metrics?.financials.totalCollected || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Outstanding Owed: <span className="font-semibold text-amber-700">${(metrics?.financials.totalOwed || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>

        {/* Overdue Invoices Alert */}
        <div className="bg-white p-5 rounded-xl border border-amber-200 bg-amber-50/20 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-800 uppercase tracking-wider">Overdue to Chase</span>
            <div className="p-2 bg-amber-100 text-amber-700 rounded-lg">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-amber-900">
              ${(metrics?.financials.overdueAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
            <div className="text-xs text-amber-700 font-medium mt-1">
              {metrics?.financials.overdueCount || 0} invoices past payment due date
            </div>
          </div>
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Columns: Overdue Invoices to Chase */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
            <div>
              <h2 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-600" />
                Overdue Invoices Requiring Chase
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Immediate collection list for accounts receivable to prevent revenue loss.
              </p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full">
              {data?.overdueInvoices.length || 0} overdue
            </span>
          </div>

          <div className="overflow-x-auto flex-1">
            {data?.overdueInvoices && data.overdueInvoices.length > 0 ? (
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Invoice</th>
                    <th className="px-4 py-3">Customer / Company</th>
                    <th className="px-4 py-3">Due Date</th>
                    <th className="px-4 py-3 text-right">Balance Due</th>
                    <th className="px-4 py-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.overdueInvoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3 font-semibold text-odoo-500 cursor-pointer" onClick={() => onNavigateToInvoice(inv.id)}>
                        {inv.invoice_number}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{inv.customer_name}</div>
                        <div className="text-xs text-slate-500">{inv.company_name || inv.customer_email}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-red-600 font-medium">
                        {inv.due_date} (Overdue)
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900">
                        ${Number(inv.balance_due).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleSendReminder(inv.id)}
                          title="Dispatch Reminder Email"
                          className="px-2.5 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors inline-flex items-center gap-1"
                        >
                          <Send className="w-3 h-3 text-slate-500" /> Chase
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-8 text-center text-slate-500 text-sm">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                No overdue invoices! All receivables are in good standing.
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Plan Breakdown & Subscription Status Distribution */}
        <div className="space-y-6">
          {/* Subscriptions by Status */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-slate-900 text-sm mb-3">Subscriptions Lifecycle Breakdown</h3>
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Active</span>
                <span className="font-bold text-slate-700">{metrics?.subscriptions.active}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span> Confirmed</span>
                <span className="font-bold text-slate-700">{metrics?.subscriptions.confirmed}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span> Quotation</span>
                <span className="font-bold text-slate-700">{metrics?.subscriptions.quotation}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span> Paused</span>
                <span className="font-bold text-slate-700">{metrics?.subscriptions.paused}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-slate-400"></span> Draft</span>
                <span className="font-bold text-slate-700">{metrics?.subscriptions.draft}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-red-400"></span> Closed</span>
                <span className="font-bold text-slate-700">{metrics?.subscriptions.closed}</span>
              </div>
            </div>
          </div>

          {/* Subscriptions by Plan */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-slate-900 text-sm mb-3">Subscriptions by Plan</h3>
            <div className="space-y-2 text-xs">
              {data?.planBreakdown.map((p, idx) => (
                <div key={idx} className="flex justify-between items-center py-1 border-b border-slate-100 last:border-0">
                  <div>
                    <span className="font-medium text-slate-800">{p.name}</span>
                    <span className="text-[10px] text-slate-400 ml-1">({p.billing_interval})</span>
                  </div>
                  <span className="font-bold bg-slate-100 px-2 py-0.5 rounded text-slate-700">{p.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Audit Log / Event Feed */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <h3 className="font-bold text-slate-900 text-sm mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4 text-slate-500" />
          Recent Engine & Audit Activity Log
        </h3>
        <div className="divide-y divide-slate-100 text-xs">
          {data?.recentEvents && data.recentEvents.length > 0 ? (
            data.recentEvents.map(evt => (
              <div key={evt.id} className="py-2.5 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <span className="font-mono text-[11px] px-2 py-0.5 bg-slate-100 text-slate-700 rounded font-semibold">
                    {evt.event_type}
                  </span>
                  <span className="text-slate-800 font-medium">{evt.description}</span>
                </div>
                <span className="text-slate-400 text-[11px]">{evt.created_at}</span>
              </div>
            ))
          ) : (
            <div className="py-4 text-center text-slate-400">No events logged yet.</div>
          )}
        </div>
      </div>
    </div>
  );
};
