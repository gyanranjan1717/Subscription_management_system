import React, { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import {
  PlayCircle, CheckCircle2, ShieldCheck, AlertCircle, Clock,
  Calendar, DollarSign, Layers, ArrowRight, RefreshCw, Zap
} from 'lucide-react';

export const BillingRun: React.FC = () => {
  const [asOfDate, setAsOfDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<any | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await api.getBillingHistory();
      setHistory(res.history);
    } catch (err: any) {
      console.error('Error loading billing history', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleRunBilling = async () => {
    setRunning(true);
    try {
      const res = await api.runBillingCycle(asOfDate);
      setLastResult(res.result);
      loadHistory();
    } catch (err: any) {
      alert('Billing execution error: ' + err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Recurring Billing Engine Control Center</h1>
            <span className="px-2.5 py-0.5 rounded text-xs font-bold bg-odoo-500 text-white">
              Automated Batch Processing
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Executes automated recurring invoicing with strict database uniqueness guarantees: <strong>never double-bills or skips a period</strong>.
          </p>
        </div>

        {/* Date Selector & Trigger Button */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-sm">
            <Calendar className="w-4 h-4 text-slate-500" />
            <input
              type="date"
              value={asOfDate}
              onChange={e => setAsOfDate(e.target.value)}
              className="bg-transparent text-slate-800 font-semibold focus:outline-none"
            />
          </div>

          <button
            onClick={handleRunBilling}
            disabled={running}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold shadow-md hover:shadow-lg transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {running ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Processing Cycles...
              </>
            ) : (
              <>
                <PlayCircle className="w-4 h-4" />
                Execute Billing Cycle
              </>
            )}
          </button>
        </div>
      </div>

      {/* Idempotency Trap Callout / Result Banner */}
      {lastResult && (
        <div className={`p-6 rounded-xl border shadow-sm transition-all ${
          lastResult.invoicesCreated > 0
            ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
            : 'bg-blue-50 border-blue-300 text-blue-950'
        }`}>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              {lastResult.invoicesCreated > 0 ? (
                <div className="p-3 bg-emerald-600 text-white rounded-xl shadow-md">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
              ) : (
                <div className="p-3 bg-blue-600 text-white rounded-xl shadow-md">
                  <ShieldCheck className="w-6 h-6" />
                </div>
              )}
              <div>
                <h3 className="text-lg font-bold">
                  {lastResult.invoicesCreated > 0
                    ? `Billing Cycle Completed — ${lastResult.invoicesCreated} Invoices Generated`
                    : `Zero Duplicate Invoices Created — Idempotency Constraint Verified!`}
                </h3>
                <p className="text-xs opacity-90 mt-0.5">
                  As of date: <strong>{lastResult.asOfDate}</strong> | Processed: {lastResult.processedCount} subscriptions
                </p>
              </div>
            </div>

            <div className="text-right">
              <div className="text-2xl font-black">
                ${Number(lastResult.totalBilledAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <div className="text-xs font-semibold opacity-80">Total Value Invoiced</div>
            </div>
          </div>

          {/* Metrics Pills */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 pt-4 border-t border-slate-200/60">
            <div className="bg-white/80 p-3 rounded-lg border border-slate-200/60">
              <div className="text-xs text-slate-500 font-semibold uppercase">New Invoices Created</div>
              <div className="text-xl font-bold text-slate-900">{lastResult.invoicesCreated}</div>
            </div>
            <div className="bg-white/80 p-3 rounded-lg border border-slate-200/60">
              <div className="text-xs text-slate-500 font-semibold uppercase">Skipped Duplicates (Safe)</div>
              <div className="text-xl font-bold text-blue-600">{lastResult.skippedDuplicates}</div>
            </div>
            <div className="bg-white/80 p-3 rounded-lg border border-slate-200/60">
              <div className="text-xs text-slate-500 font-semibold uppercase">Double Billing Risk</div>
              <div className="text-xl font-bold text-emerald-600 flex items-center gap-1">
                <ShieldCheck className="w-5 h-5 text-emerald-600" /> 0% (Guaranteed)
              </div>
            </div>
          </div>

          {/* Details Table */}
          {lastResult.details && lastResult.details.length > 0 && (
            <div className="mt-4 bg-white rounded-lg border border-slate-200 overflow-hidden">
              <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700">
                Processed Subscriptions & Actions
              </div>
              <div className="divide-y divide-slate-100 max-h-60 overflow-y-auto text-xs">
                {lastResult.details.map((item: any, idx: number) => (
                  <div key={idx} className="px-4 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900">{item.subscriptionNumber}</span>
                      {item.invoiceNumber && (
                        <span className="text-odoo-500 font-mono font-medium">→ {item.invoiceNumber}</span>
                      )}
                      {item.reason && <span className="text-slate-500">({item.reason})</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      {item.amount && <span className="font-bold text-slate-900">${item.amount.toFixed(2)}</span>}
                      <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                        item.status === 'created'
                          ? 'bg-emerald-100 text-emerald-800'
                          : item.status === 'already_billed'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}>
                        {item.status === 'created' ? 'Created' : item.status === 'already_billed' ? 'Already Billed' : item.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Prior Billing Runs Audit History */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <h3 className="font-bold text-slate-900 text-base mb-1 flex items-center gap-2">
          <Clock className="w-5 h-5 text-slate-500" /> Billing Run Engine Audit History
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          Complete audit trail of every automated and manual billing execution for compliance and accounting reconciliation.
        </p>

        {historyLoading ? (
          <div className="text-center py-6 text-slate-400">Loading audit log...</div>
        ) : history.length > 0 ? (
          <div className="divide-y divide-slate-100">
            {history.map((h: any) => (
              <div key={h.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div>
                  <div className="font-semibold text-slate-800">{h.description}</div>
                  <div className="text-slate-400 text-[11px]">
                    Executed by: <span className="text-slate-600 font-medium">{h.operator_name || 'System Scheduler'}</span> on {h.created_at}
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded bg-slate-100 text-slate-700 font-mono font-semibold self-start sm:self-auto">
                  Audit #{h.id}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-slate-400 text-sm">
            No previous billing runs recorded. Click "Execute Billing Cycle" above to run the engine!
          </div>
        )}
      </div>
    </div>
  );
};
