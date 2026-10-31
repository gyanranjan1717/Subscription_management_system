import React, { useState, useEffect } from 'react';
import { api, IntegrityReport } from '../services/api.js';
import { Alert, Button, Card, Checkbox, ConfirmDialog, EmptyState, Input, Loading, PageHeader, table, useToast } from '../components/ui.js';
import { formatDate, formatDateTime, formatMoney, today } from '../lib/format.js';
import { CheckCircle2, Eye, PlayCircle, RefreshCw, ShieldAlert } from 'lucide-react';

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

export const BillingRun: React.FC<{ onOpenInvoices?: () => void }> = ({ onOpenInvoices }) => {
  const toast = useToast();
  const [asOfDate, setAsOfDate] = useState<string>(today());
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [busy, setBusy] = useState<null | 'run' | 'dry' | 'confirm' | 'integrity'>(null);
  const [lastResult, setLastResult] = useState<any | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDrafts, setConfirmDrafts] = useState(false);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      setHistory((await api.getBillingHistory()).history);
    } catch (err: any) {
      setError('Unable to load billing history. ' + err.message);
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadIntegrity = async () => {
    setBusy(b => b ?? 'integrity');
    try {
      setIntegrity((await api.getIntegrityReport()).report);
    } catch (err: any) {
      setError('Unable to load the integrity report. ' + err.message);
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
    setBusy(dryRun ? 'dry' : 'run');
    try {
      const { result } = await api.runBillingCycle({ as_of_date: asOfDate, dry_run: dryRun, auto_confirm: autoConfirm });
      setLastResult(result);
      if (dryRun) {
        toast('success', `Preview only: ${result.invoicesCreated} invoice(s) would be created. Nothing was saved.`);
      } else {
        setRuns(prev => [
          ...prev,
          { n: prev.length + 1, at: new Date().toLocaleTimeString(), asOf: result.asOfDate, created: result.invoicesCreated, already: result.skippedDuplicates, errors: result.errors, total: result.totalBilledAmount }
        ]);
        toast('success', `${result.invoicesCreated} invoice(s) created for ${formatMoney(result.totalBilledAmount)}.`);
        loadHistory();
        loadIntegrity();
      }
    } catch (err: any) {
      setError('Billing could not run. ' + err.message);
    } finally {
      setBusy(null);
    }
  };

  const doConfirmDrafts = async () => {
    setBusy('confirm');
    try {
      const r = await api.confirmDraftInvoices();
      toast('success', `${r.confirmed} draft invoice(s) confirmed.`);
      setConfirmDrafts(false);
    } catch (err: any) {
      setConfirmDrafts(false);
      setError('Unable to confirm drafts. ' + err.message);
    } finally {
      setBusy(null);
    }
  };

  const integrityRows: Array<[string, number]> = integrity
    ? [
        ['Duplicate billing periods', integrity.duplicatePeriods],
        ['Missing billing periods', integrity.missingPeriods],
        ['Invoice total mismatches', integrity.inconsistentInvoiceTotals],
        ['Payment mismatches', integrity.inconsistentPayments],
        ['Invalid references', integrity.invalidReferences]
      ]
    : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Billing run"
        subtitle="Create invoices for every subscription period that is due"
        actions={onOpenInvoices && <Button onClick={onOpenInvoices}>View invoices</Button>}
      />

      {error && <Alert kind="error" onClose={() => setError(null)}>{error}</Alert>}

      <Card title="Run billing">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <Input label="Bill as of" type="date" required value={asOfDate} onChange={e => setAsOfDate(e.target.value)} wrapperClassName="w-44" />
          <Checkbox label="Create invoices as Confirmed" checked={autoConfirm} onChange={e => setAutoConfirm(e.target.checked)} className="mb-2" />
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-md border border-slate-200 p-3 flex flex-col">
            <div className="text-sm font-medium text-slate-900">1. Preview</div>
            <p className="text-xs text-slate-600 mt-1 flex-1">Calculates what would be billed and shows it below. Saves nothing.</p>
            <Button className="mt-3" onClick={() => execute(true)} loading={busy === 'dry'} disabled={busy !== null || !asOfDate}>
              <Eye className="w-3.5 h-3.5" aria-hidden="true" /> Preview
            </Button>
          </div>
          <div className="rounded-md border border-slate-200 p-3 flex flex-col">
            <div className="text-sm font-medium text-slate-900">2. Run billing</div>
            <p className="text-xs text-slate-600 mt-1 flex-1">Creates the invoices, including every missed earlier period (catch-up). Safe to repeat: a period is never invoiced twice.</p>
            <Button className="mt-3" variant="primary" onClick={() => execute(false)} loading={busy === 'run'} disabled={busy !== null || !asOfDate}>
              <PlayCircle className="w-3.5 h-3.5" aria-hidden="true" /> {busy === 'run' ? 'Billing in progress…' : 'Run billing'}
            </Button>
          </div>
          <div className="rounded-md border border-slate-200 p-3 flex flex-col">
            <div className="text-sm font-medium text-slate-900">3. Confirm drafts</div>
            <p className="text-xs text-slate-600 mt-1 flex-1">Moves every Draft invoice to Confirmed so it can be sent and paid.</p>
            <Button className="mt-3" onClick={() => setConfirmDrafts(true)} disabled={busy !== null}>
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Confirm all drafts
            </Button>
          </div>
        </div>
      </Card>

      {runs.length > 0 && (
        <Card title="Runs in this session" description="Run it again to see that nothing is billed twice" flush>
          <div className={table.wrap}>
            <table className={table.table}>
              <thead className={table.head}>
                <tr>
                  <th className={table.th}>Run</th>
                  <th className={table.th}>Time</th>
                  <th className={table.th}>Bill as of</th>
                  <th className={table.thNum}>Invoices created</th>
                  <th className={table.thNum}>Already billed</th>
                  <th className={table.thNum}>Errors</th>
                  <th className={table.thNum}>Value</th>
                </tr>
              </thead>
              <tbody className={table.body}>
                {runs.map(r => (
                  <tr key={r.n} className={table.row}>
                    <td className={table.td + ' font-medium'}>Run {r.n}</td>
                    <td className={table.td}>{r.at}</td>
                    <td className={table.td}>{formatDate(r.asOf)}</td>
                    <td className={table.tdNum + ' font-semibold ' + (r.created === 0 ? 'text-slate-500' : 'text-emerald-700')}>{r.created}</td>
                    <td className={table.tdNum}>{r.already}</td>
                    <td className={table.tdNum + (r.errors ? ' text-red-700 font-medium' : '')}>{r.errors}</td>
                    <td className={table.tdNum}>{formatMoney(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {lastResult && (
        <Card
          title={lastResult.dryRun ? 'Preview result (nothing saved)' : 'Latest run result'}
          description={`Billed as of ${formatDate(lastResult.asOfDate)} · ${lastResult.processedCount} due subscription(s) · ${lastResult.invoicesCreated} invoice(s) · ${formatMoney(lastResult.totalBilledAmount)}`}
          flush
        >
          {lastResult.details.length === 0 ? (
            <EmptyState title="Nothing was due" hint="Every Active subscription is already billed up to this date." />
          ) : (
            <div className={table.wrap}>
              <table className={table.table}>
                <thead className={table.head}>
                  <tr>
                    <th className={table.th}>Subscription</th>
                    <th className={table.th}>Period start</th>
                    <th className={table.th}>Invoice</th>
                    <th className={table.thNum}>Amount</th>
                    <th className={table.th}>Result</th>
                  </tr>
                </thead>
                <tbody className={table.body}>
                  {lastResult.details.slice(0, DETAIL_ROWS_SHOWN).map((d: any, i: number) => (
                    <tr key={i} className={table.row}>
                      <td className={table.td + ' font-medium whitespace-nowrap'}>{d.subscriptionNumber}</td>
                      <td className={table.td + ' whitespace-nowrap'}>{formatDate(d.periodStart)}</td>
                      <td className={table.td + ' whitespace-nowrap'}>{d.invoiceNumber ?? '—'}</td>
                      <td className={table.tdNum}>{d.amount !== undefined ? formatMoney(d.amount) : '—'}</td>
                      <td className={table.td}>
                        <span className={d.status === 'error' ? 'text-red-700 font-medium' : d.status === 'created' ? 'text-emerald-700 font-medium' : 'text-slate-600'}>
                          {d.status === 'created' ? 'Created' : d.status === 'already_billed' ? 'Already billed' : d.status === 'auto_closed' ? 'Auto-closed' : 'Error'}
                        </span>
                        {d.reason && <span className="text-xs text-slate-500"> · {d.reason}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {lastResult.details.length > DETAIL_ROWS_SHOWN && (
                <div className="px-4 py-2 text-xs text-slate-500 border-t border-slate-100">
                  First {DETAIL_ROWS_SHOWN} of {lastResult.details.length} rows shown.
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      <Card
        title="Billing integrity"
        description="Checked against the live database. Zero means healthy."
        actions={<Button size="sm" onClick={loadIntegrity} loading={busy === 'integrity'} disabled={busy !== null}><RefreshCw className="w-3 h-3" aria-hidden="true" /> Re-check</Button>}
        flush
      >
        {!integrity ? (
          <Loading label="Checking ledger…" />
        ) : (
          <>
            <table className={table.table}>
              <tbody className={table.body}>
                {integrityRows.map(([label, n]) => (
                  <tr key={label}>
                    <td className={table.td}>{label}</td>
                    <td className={table.tdNum + ' w-24 font-semibold ' + (n === 0 ? 'text-emerald-700' : 'text-red-700')}>{n}</td>
                    <td className={table.td + ' w-28 text-xs ' + (n === 0 ? 'text-emerald-700' : 'text-red-700')}>{n === 0 ? 'OK' : 'Needs review'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2.5 text-xs text-slate-500 border-t border-slate-100 flex items-center gap-1.5">
              {integrity.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" /> : <ShieldAlert className="w-3.5 h-3.5 text-red-600" aria-hidden="true" />}
              {integrity.ok ? 'Ledger is consistent.' : 'Inconsistencies found.'} Checked {formatDateTime(integrity.generatedAt.replace('T', ' ').slice(0, 16))}.
            </div>
          </>
        )}
      </Card>

      <Card title="Billing run history" flush>
        {historyLoading ? (
          <Loading label="Loading history…" />
        ) : history.length > 0 ? (
          <ul className="divide-y divide-slate-100 text-sm">
            {history.map((h: any) => (
              <li key={h.id} className="px-4 py-2.5 flex flex-col sm:flex-row sm:justify-between gap-0.5">
                <span className="text-slate-800">{h.description}</span>
                <span className="text-xs text-slate-500 whitespace-nowrap">{h.operator_name || 'System'} · {formatDateTime(h.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No billing runs yet" hint="Use Run billing above to create the first invoices." />
        )}
      </Card>

      {confirmDrafts && (
        <ConfirmDialog
          title="Confirm all draft invoices?"
          message="Every invoice currently in Draft becomes Confirmed. Confirmed invoices can be sent to customers and receive payments."
          confirmLabel="Confirm drafts"
          busy={busy === 'confirm'}
          onConfirm={doConfirmDrafts}
          onCancel={() => setConfirmDrafts(false)}
        />
      )}
    </div>
  );
};
