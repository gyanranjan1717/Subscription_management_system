import React, { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import { Subscription, Invoice, Payment, User } from '../types.js';
import { Alert, EmptyState, Loading, StatusBadge } from '../components/ui.js';
import { formatMoney } from '../lib/format.js';
import {
  ShieldCheck, Eye, KeyRound, AlertCircle, CheckCircle2,
  Lock, RefreshCw, Printer, XCircle, PauseCircle, PlayCircle, History
} from 'lucide-react';
import { SubscriptionTimeline } from '../components/SubscriptionTimeline.js';

interface CustomerPortalProps {
  currentUser: User | null;
  onViewInvoice: (id: number) => void;
}

export const CustomerPortal: React.FC<CustomerPortalProps> = ({ currentUser, onViewInvoice }) => {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [timelineSubId, setTimelineSubId] = useState<number | null>(null);

  // Password reset testing
  const [resetEmail, setResetEmail] = useState(currentUser?.email || '');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetStep, setResetStep] = useState<'request' | 'reset'>('request');
  const [resetResult, setResetResult] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [subRes, invRes, payRes] = await Promise.all([
        api.getSubscriptions(),
        api.getInvoices(),
        api.getPayments()
      ]);
      setSubscriptions(subRes.subscriptions);
      setInvoices(invRes.invoices);
      setPayments(payRes.payments);
      setError(null);
      if (currentUser?.email) {
        setResetEmail(currentUser.email);
      }
    } catch (err: any) {
      setError('Could not load your account data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [currentUser]);

  const handlePause = async (id: number) => {
    try {
      const res = await api.updateSubscriptionStatus(id, 'Paused');
      setActionNotice(res.message);
      setTimeout(() => setActionNotice(null), 4000);
      loadData();
    } catch (err: any) {
      setError('Cannot pause: ' + err.message);
    }
  };

  const handleResume = async (id: number) => {
    try {
      const res = await api.updateSubscriptionStatus(id, 'Active');
      setActionNotice(res.message);
      setTimeout(() => setActionNotice(null), 4000);
      loadData();
    } catch (err: any) {
      setError('Cannot resume: ' + err.message);
    }
  };

  const handleRenew = async (id: number) => {
    try {
      const res = await api.renewSubscription(id);
      setActionNotice(res.message);
      setTimeout(() => setActionNotice(null), 4000);
      loadData();
    } catch (err: any) {
      setError('Renewal failed: ' + err.message);
    }
  };

  const handleClose = async (id: number) => {
    if (!confirm('Are you sure you want to cancel this subscription?')) return;
    try {
      const res = await api.updateSubscriptionStatus(id, 'Closed');
      setActionNotice(res.message);
      setTimeout(() => setActionNotice(null), 4000);
      loadData();
    } catch (err: any) {
      setError('Cannot cancel: ' + err.message);
    }
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.forgotPassword(resetEmail);
      setError(null);
      setResetStep('reset');
      if (res.resetToken) {
        setResetToken(res.resetToken);
        setResetResult(`A reset link was sent to ${resetEmail} (development mode shows the token here so you can paste it below).`);
      } else {
        setResetResult(`If ${resetEmail} is registered, a reset link has been sent to it. Paste the token from that email below.`);
      }
    } catch (err: any) {
      setError('Reset request failed: ' + err.message);
    }
  };

  const handleExecuteReset = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.resetPassword(resetToken, newPassword);
      setError(null);
      setResetResult('Password updated. You can now log in with the new password.');
      setNewPassword('');
    } catch (err: any) {
      setError('Password reset failed: ' + err.message);
    }
  };

  const isCustomerRole = currentUser?.role === 'customer';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Customer Self-Service Portal</h1>
            <span className="px-2.5 py-0.5 rounded text-xs font-bold bg-odoo-teal text-white flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Isolated Tenant View
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Logged in as: <strong className="text-slate-800">{currentUser?.full_name} ({currentUser?.email})</strong>.
            Database query guarantees you see <strong>ONLY</strong> records belonging to your account.
          </p>
        </div>

        {isCustomerRole ? (
          <div className="text-xs bg-emerald-50 text-emerald-900 border border-emerald-200 px-3 py-1.5 rounded-lg">
            Account <strong>{currentUser?.email}</strong>: {subscriptions.length} subscription(s), {invoices.length} invoice(s), {payments.length} payment(s)
          </div>
        ) : (
          <div className="text-xs bg-amber-50 text-amber-900 border border-amber-200 px-3 py-1.5 rounded-lg">
            Viewing as {currentUser?.role}. Switch to a customer persona to see the isolated portal.
          </div>
        )}
      </div>

      {error && <Alert kind="error" onClose={() => setError(null)}>{error}</Alert>}
      {actionNotice && <Alert kind="success" onClose={() => setActionNotice(null)}>{actionNotice}</Alert>}
      {loading && <Loading label="Loading your account…" />}

      {/* Customer Subscriptions */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden p-6 space-y-4">
        <div className="flex justify-between items-center border-b border-slate-100 pb-3">
          <h2 className="font-bold text-slate-900 text-base">Your Subscriptions</h2>
          <span className="text-xs font-semibold px-2.5 py-0.5 bg-slate-100 text-slate-700 rounded-full">
            {subscriptions.length} on your account
          </span>
        </div>

        {subscriptions.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {subscriptions.map(s => (
              <div key={s.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="font-mono font-bold text-odoo-500 text-sm">{s.subscription_number}</span>
                    <h3 className="font-bold text-slate-900 text-base">{s.plan_name}</h3>
                    <div className="text-xs text-slate-400 capitalize">{s.billing_interval} interval</div>
                  </div>
                  <StatusBadge status={s.status} />
                </div>

                <div className="text-xs space-y-1 text-slate-600 border-t border-slate-200/60 pt-2">
                  <div className="flex justify-between">
                    <span>Next Renewal Date:</span>
                    <span className="font-mono font-bold text-slate-800">{s.next_billing_date}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Payment Terms:</span>
                    <span className="font-medium text-slate-800">{s.payment_terms}</span>
                  </div>
                  {s.discount_code && (
                    <div className="flex justify-between text-purple-700 font-medium">
                      <span>Discount Benefit:</span>
                      <span>{s.discount_code} ({s.discount_type === 'percentage' ? `${s.discount_value}%` : formatMoney(s.discount_value)} off)</span>
                    </div>
                  )}
                </div>

                {/* Self-service actions */}
                <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200/60">
                  {s.can_renew === 1 && s.status !== 'Closed' && (
                    <button
                      onClick={() => handleRenew(s.id)}
                      className="px-3 py-1 bg-purple-50 hover:bg-purple-100 text-odoo-500 rounded text-xs font-semibold flex items-center gap-1"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Renew ({s.billing_interval})
                    </button>
                  )}
                  {s.status === 'Active' && s.can_pause === 1 && (
                    <button
                      onClick={() => handlePause(s.id)}
                      className="px-3 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded text-xs font-semibold flex items-center gap-1"
                    >
                      <PauseCircle className="w-3.5 h-3.5" /> Pause
                    </button>
                  )}
                  {s.status === 'Paused' && (
                    <button
                      onClick={() => handleResume(s.id)}
                      className="px-3 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded text-xs font-semibold flex items-center gap-1"
                    >
                      <PlayCircle className="w-3.5 h-3.5" /> Resume Subscription
                    </button>
                  )}
                  <button
                    onClick={() => setTimelineSubId(timelineSubId === s.id ? null : s.id)}
                    className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold flex items-center gap-1"
                  >
                    <History className="w-3.5 h-3.5" /> {timelineSubId === s.id ? 'Hide Activity' : 'Activity'}
                  </button>
                  {s.status !== 'Closed' && s.can_close_early !== 0 && (
                    <button
                      onClick={() => handleClose(s.id)}
                      className="px-3 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded text-xs font-semibold flex items-center gap-1 ml-auto"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Cancel Contract
                    </button>
                  )}
                </div>

                {timelineSubId === s.id && (
                  <SubscriptionTimeline
                    key={`${s.id}-${s.status}-${s.expiry_date}`}
                    subscriptionId={s.id}
                    subscriptionNumber={s.subscription_number}
                    onClose={() => setTimelineSubId(null)}
                  />
                )}
              </div>
            ))}
          </div>
        ) : (
          !loading && <EmptyState title="No subscriptions on this account" hint="Your sales contact will set one up for you." />
        )}
      </div>

      {/* Customer Invoices */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div className="flex justify-between items-center border-b border-slate-100 pb-3">
          <h2 className="font-bold text-slate-900 text-base">Your Invoices & Receipts</h2>
          <span className="text-xs font-semibold px-2.5 py-0.5 bg-slate-100 text-slate-700 rounded-full">
            {invoices.length} invoices
          </span>
        </div>

        {invoices.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Invoice #</th>
                  <th className="px-4 py-3">Period</th>
                  <th className="px-4 py-3">Due Date</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3 text-right">Outstanding</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {invoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-odoo-500 font-mono">{inv.invoice_number}</td>
                    <td className="px-4 py-3 font-mono">{inv.period_start} → {inv.period_end}</td>
                    <td className="px-4 py-3 text-slate-600">{inv.due_date}</td>
                    <td className="px-4 py-3 text-right font-bold font-mono text-slate-900">{formatMoney(inv.total_amount)}</td>
                    <td className="px-4 py-3 text-right font-mono text-emerald-700">{formatMoney(inv.amount_paid)}</td>
                    <td className="px-4 py-3 text-right font-mono text-amber-700">{inv.status === 'Cancelled' ? '—' : formatMoney(inv.balance_due ?? inv.total_amount - inv.amount_paid)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={inv.status} overdue={!!inv.is_overdue} partial={inv.amount_paid > 0 && inv.amount_paid < inv.total_amount} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => onViewInvoice(inv.id)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold inline-flex items-center gap-1"
                      >
                        <Printer className="w-3 h-3" /> View / Print
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !loading && <EmptyState title="No invoices yet" hint="Invoices appear after your subscription is billed." />
        )}
      </div>

      {/* Customer Payments */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div className="flex justify-between items-center border-b border-slate-100 pb-3">
          <h2 className="font-bold text-slate-900 text-base">Your Payments</h2>
          <span className="text-xs font-semibold px-2.5 py-0.5 bg-slate-100 text-slate-700 rounded-full">{payments.length} payments</span>
        </div>
        {payments.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Invoice</th>
                  <th className="px-4 py-2">Method</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map(p => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 font-mono">{p.payment_date}</td>
                    <td className="px-4 py-2 font-mono">{p.invoice_number}</td>
                    <td className="px-4 py-2">{p.payment_method}</td>
                    <td className="px-4 py-2 text-right font-mono font-bold">{formatMoney(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !loading && <EmptyState title="No payments recorded yet" />
        )}
      </div>

      {/* Password Reset Feature Sandbox */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
        <div className="border-b border-slate-100 pb-3">
          <h2 className="font-bold text-slate-900 text-base flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-odoo-500" />
            Password Reset Engine Verification
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Demonstrates requirement: <em>"If they forget it later, a reset link should arrive at their registered email. Password must be more than 8 characters, upper, lower, special."</em>
          </p>
        </div>

        {resetResult && (
          <div className="p-3 bg-purple-50 border border-purple-200 text-purple-900 rounded-lg text-xs font-medium">
            {resetResult}
          </div>
        )}

        {resetStep === 'request' ? (
          <form onSubmit={handleRequestReset} className="max-w-md space-y-3 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Registered Account Email</label>
              <input
                type="email"
                required
                value={resetEmail}
                onChange={e => setResetEmail(e.target.value)}
                className="w-full border border-slate-300 rounded p-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-odoo-500 hover:bg-odoo-600 text-white rounded font-bold text-xs shadow-sm"
            >
              Dispatch Password Reset Link
            </button>
          </form>
        ) : (
          <form onSubmit={handleExecuteReset} className="max-w-md space-y-3 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Received Reset Token</label>
              <input
                type="text"
                required
                value={resetToken}
                onChange={e => setResetToken(e.target.value)}
                className="w-full border border-slate-300 rounded p-2 font-mono text-xs bg-slate-50"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">New Password (Must be &gt;8 chars, Upper, Lower, Special)</label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="e.g. NewSecure#2026"
                className="w-full border border-slate-300 rounded p-2 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setResetStep('request')}
                className="px-3 py-1.5 border rounded text-xs font-semibold"
              >
                Back
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold text-xs shadow-sm"
              >
                Update Password
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
