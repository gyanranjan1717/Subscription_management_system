import React, { useState, useEffect } from 'react';
import { api, IntegrityReport } from '../services/api.js';
import { Alert, EmptyState, Loading } from '../components/ui.js';
import { formatMoney, today } from '../lib/format.js';
import { PlayCircle, ShieldCheck, ShieldAlert, Clock, Calendar, RefreshCw, Eye, CheckCheck } from 'lucide-react';

interface RunRecord {
  n: number;
  at: string;
  asOf: string;
  created: number;
  already: number;
  errors: number;
  total: number;
}

const DETAIL_ROWS_SHOWN = 100;

export const BillingRun: React.FC = () => {
  const [asOfDate, setAsOfDate] = useState<string>(today());
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [busy, setBusy] = useState<null | 'run' | 'dry' | 'confirm' | 'integrity'>(null);
  const [lastResult, setLastResult] = useState<any | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      setHistory((await api.getBillingHistory()).history);
    } catch (err: any) {
      setError('Could not load billing history: ' + err.message);
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadIntegrity = async () => {
    setBusy(b => b ?? 'integrity');
    try {
      setIntegrity((await api.getIntegrityReport()).report);
    } catch (err: any) {
      setError('Could not load the integrity report: ' + err.message);
    } finally {
      setBusy(b => (b === 'integrity' ? null : b));
    }
  };

  useEffect(() => {
    loadHistory();
    loadIntegrity();
  }, []);

  const execute = async (dryRun: boolean) => {
    setError(null);
    setNotice(null);
    setBusy(dryRun ? 'dry' : 'run');
    try {
      const { result } = await api.runBillingCycle({ as_of_date: asOfDate, dry_run: dryRun, auto_confirm: autoConfirm });
      setLastResult(result);
      if (!dryRun) {
        setRuns(prev => [
          ...prev,
          {
            n: prev.length + 1,
            at: new Date().toLocaleTimeString(),
            asOf: result.asOfDate,
            created: result.invoicesCreated,
            already: result.skippedDuplicates,
            errors: result.errors,
            total: result.totalBilledAmount
          }
        ]);
        loadHistory();
        loadIntegrity();
      }
    } catch (err: any) {
      setError('Billing failed: ' + err.message);
    } finally {
      setBusy(null);
    }
  };

  const confirmDrafts = async () => {
    if (!window.confirm('Confirm every Draft invoice? Confirmed invoices can be sent and paid.')) return;
    setBusy('confirm');
    setError(null);
    try {
      const r = await api.confirmDraftInvoices();
      setNotice(`${r.confirmed} draft invoice(s) confirmed.`);
    } catch (err: any) {
      setError('Could not confirm drafts: ' + err.message);
    } finally {
      setBusy(null);
    }
  };

  const integrityCards: Array<[string, number]> = integrity
    ? [
        ['Duplicate periods', integrity.duplicatePeriods],
        ['Missing periods', integrity.missingPeriods],
        ['Invoice total mismatches', integrity.inconsistentInvoiceTotals],
        ['Payment mismatches', integrity.inconsistentPayments],
        ['Invalid references', integrity.invalidReferences]
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Billing Run</h1>
          <p className="text-sm text-slate-500 mt-1">
            Every due period of every Active subscription is invoiced exactly once. Run it twice: the second run creates 0 invoices.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-sm">
            <Calendar className="w-4 h-4 text-slate-500" />
            <span className="text-slate-500 text-xs">Bill as of</span>
            <input
              type="date"
              value={asOfDate}
              onChange={e => setAsOfDate(e.target.value)}
              className="bg-transparent text-slate-800 font-semibold focus:outline-none"
            />
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={autoConfirm} onChange={e => setAutoConfirm(e.target.checked)} />
            Create invoices as Confirmed
          </label>

          <button
            onClick={() => execute(true)}
            disabled={busy !== null || !asOfDate}
            className="px-4 py-2 border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 rounded-lg text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
          >
            <Eye className="w-4 h-4" /> {busy === 'dry' ? 'Previewing…' : 'Preview (saves nothing)'}
          </button>

          <button
            onClick={() => execute(false)}
            disabled={busy !== null || !asOfDate}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold shadow-sm flex items-center gap-2 disabled:opacity-50"
          >
            {busy === 'run' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            {busy === 'run' ? 'Billing…' : 'Run billing'}
          </button>

          <button
            onClick={confirmDrafts}
            disabled={busy !== null}
            className="px-4 py-2 border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-800 rounded-lg text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
          >
            <CheckCheck className="w-4 h-4" /> Confirm all drafts
          </button>
        </div>
      </div>

      {error && <Alert kind="error" onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert kind="success" onClose={() => setNotice(null)}>{notice}</Alert>}

      {/* Run comparison: first run vs repeat run */}
      {runs.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-6">
          <h2 className="font-bold text-slate-900 text-base mb-3">Runs in this session</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {runs.map(r => (
              <div
                key={r.n}
                className={`rounded-lg border p-4 ${r.created > 0 ? 'bg-emerald-50 border-emerald-300' : 'bg-blue-50 border-blue-300'}`}
              >
                <div className="text-xs font-semibold text-slate-500">
                  Run {r.n} · {r.at} · as of {r.asOf}
                </div>
                <div className="text-3xl font-black text-slate-900 mt-1">{r.created}</div>
                <div className="text-sm font-semibold text-slate-700">invoices created</div>
                <div className="text-xs text-slate-600 mt-2">
                  Already billed (skipped): <strong>{r.already}</strong> · Errors: <strong>{r.errors}</strong> · Value:{' '}
                  <strong>{formatMoney(r.total)}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Latest result details */}
      {lastResult && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className={`px-4 sm:px-6 py-3 text-sm font-bold ${lastResult.dryRun ? 'bg-amber-100 text-amber-900' : 'bg-slate-900 text-white'}`}>
            {lastResult.dryRun ? 'PREVIEW — nothing was saved' : 'Latest run'} · as of {lastResult.asOfDate} · {lastResult.processedCount} due subscription(s) ·{' '}
            {lastResult.invoicesCreated} invoice(s) · {formatMoney(lastResult.totalBilledAmount)}
          </div>
          {lastResult.details.length === 0 ? (
            <EmptyState title="Nothing was due" hint="Every Active subscription is already billed up to this date." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2">Subscription</th>
                    <th className="px-4 py-2">Period start</th>
                    <th className="px-4 py-2">Invoice</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lastResult.details.slice(0, DETAIL_ROWS_SHOWN).map((d: any, i: number) => (
                    <tr key={i}>
                      <td className="px-4 py-2 font-semibold">{d.subscriptionNumber}</td>
                      <td className="px-4 py-2 font-mono">{d.periodStart ?? '—'}</td>
                      <td className="px-4 py-2 font-mono">{d.invoiceNumber ?? '—'}</td>
                      <td className="px-4 py-2 text-right font-mono">{d.amount !== undefined ? formatMoney(d.amount) : '—'}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`px-2 py-0.5 rounded font-semibold ${
                            d.status === 'created' ? 'bg-emerald-100 text-emerald-800'
                            : d.status === 'already_billed' ? 'bg-blue-100 text-blue-800'
                            : d.status === 'error' ? 'bg-red-100 text-red-800'
                            : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {d.status === 'created' ? 'Created' : d.status === 'already_billed' ? 'Already billed' : d.status === 'auto_closed' ? 'Auto-closed' : 'Error'}
                        </span>
                        {d.reason && <span className="ml-2 text-slate-500">{d.reason}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {lastResult.details.length > DETAIL_ROWS_SHOWN && (
                <div className="px-4 py-2 text-xs text-slate-500 border-t border-slate-100">
                  Showing the first {DETAIL_ROWS_SHOWN} of {lastResult.details.length} rows.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Integrity report: live from the database */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="font-bold text-slate-900 text-base flex items-center gap-2">
            {integrity?.ok === false ? <ShieldAlert className="w-5 h-5 text-red-600" /> : <ShieldCheck className="w-5 h-5 text-emerald-600" />}
            Billing integrity report
          </h2>
          <button
            onClick={loadIntegrity}
            disabled={busy !== null}
            className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === 'integrity' ? 'Checking…' : 'Re-check now'}
          </button>
        </div>
        {!integrity ? (
          <Loading label="Checking the ledger…" />
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {integrityCards.map(([label, n]) => (
                <div key={label} className={`rounded-lg border p-3 ${n === 0 ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50'}`}>
                  <div className="text-[11px] font-semibold uppercase text-slate-500">{label}</div>
                  <div className={`text-2xl font-black ${n === 0 ? 'text-emerald-700' : 'text-red-700'}`}>{n}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-3">
              {integrity.ok ? 'Ledger is consistent. ' : 'Problems found — see the counts above. '}
              Checked {new Date(integrity.generatedAt).toLocaleString()} against the live database.
            </p>
          </>
        )}
      </div>

      {/* Audit history */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-6">
        <h2 className="font-bold text-slate-900 text-base mb-3 flex items-center gap-2">
          <Clock className="w-5 h-5 text-slate-500" /> Billing run history
        </h2>
        {historyLoading ? (
          <Loading label="Loading history…" />
        ) : history.length > 0 ? (
          <div className="divide-y divide-slate-100">
            {history.map((h: any) => (
              <div key={h.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
                <div>
                  <div className="font-semibold text-slate-800">{h.description}</div>
                  <div className="text-slate-400">
                    By {h.operator_name || 'System'} · {h.created_at}
                  </div>
                </div>
                <span className="px-2 py-1 rounded bg-slate-100 text-slate-700 font-mono font-semibold self-start">Audit #{h.id}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No billing runs yet" hint="Use Run billing above to create the first invoices." />
        )}
      </div>
    </div>
  );
};
