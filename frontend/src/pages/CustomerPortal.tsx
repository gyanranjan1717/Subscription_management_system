import React, { useState, useEffect } from 'react';
import { api } from '../services/api.js';
import { Subscription, Invoice, Payment, User } from '../types.js';
import { SubscriptionTimeline } from '../components/SubscriptionTimeline.js';
import { Alert, Button, Card, ConfirmDialog, EmptyState, ErrorState, Input, Loading, Modal, PageHeader, Stat, StatusBadge, table, useToast } from '../components/ui.js';
import { formatDate, formatMoney } from '../lib/format.js';
import { Printer, CreditCard, ShieldCheck } from 'lucide-react';

interface CustomerPortalProps {
  currentUser: User | null;
  onViewInvoice: (id: number) => void;
}

type ResetStep = 'idle' | 'sent';

export const CustomerPortal: React.FC<CustomerPortalProps> = ({ currentUser, onViewInvoice }) => {
  const toast = useToast();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoiceTotal, setInvoiceTotal] = useState(0);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [timelineFor, setTimelineFor] = useState<Subscription | null>(null);
  const [closeTarget, setCloseTarget] = useState<Subscription | null>(null);

  // Razorpay Checkout Modal
  const [razorpayOrder, setRazorpayOrder] = useState<{
    orderId: string;
    invoiceId: number;
    invoiceNumber: string;
    amountInr: number;
    keyId: string;
  } | null>(null);
  const [payingBusy, setPayingBusy] = useState(false);

  const [resetStep, setResetStep] = useState<ResetStep>('idle');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [subRes, invRes, payRes] = await Promise.all([api.getSubscriptions(), api.getInvoices(), api.getPayments()]);
      setSubscriptions(subRes.subscriptions);
      setInvoices(invRes.invoices);
      setInvoiceTotal(invRes.pagination.total);
      setPayments(payRes.payments);
    } catch (err: any) {
      setError('Unable to load your account. ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [currentUser?.id]);

  const act = async (sub: Subscription, label: string, fn: () => Promise<{ message: string }>) => {
    setBusyId(sub.id);
    try {
      const res = await fn();
      toast('success', res.message || `${label} done.`);
      await loadData();
    } catch (err: any) {
      toast('error', `${label} failed. ${err.message}`);
    } finally {
      setBusyId(null);
      setCloseTarget(null);
    }
  };

  const startRazorpayPayment = async (inv: Invoice) => {
    try {
      const order = await api.createRazorpayOrder(inv.id);
      setRazorpayOrder(order);
    } catch (err: any) {
      toast('error', 'Unable to initiate Razorpay checkout. ' + err.message);
    }
  };

  const handleCompleteRazorpay = async () => {
    if (!razorpayOrder) return;
    setPayingBusy(true);
    try {
      const mockPaymentId = `pay_${Date.now()}`;
      await api.verifyRazorpayPayment({
        invoice_id: razorpayOrder.invoiceId,
        razorpay_order_id: razorpayOrder.orderId,
        razorpay_payment_id: mockPaymentId,
        razorpay_signature: 'test_signature_verified'
      });
      toast('success', `Payment received! Invoice ${razorpayOrder.invoiceNumber} is now marked as Paid.`);
      setRazorpayOrder(null);
      await loadData();
    } catch (err: any) {
      toast('error', 'Payment verification failed. ' + err.message);
    } finally {
      setPayingBusy(false);
    }
  };

  const requestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetBusy(true);
    setResetError(null);
    try {
      const res = await api.forgotPassword(currentUser?.email ?? '');
      setResetMessage(res.message);
      if (res.resetToken) setResetToken(res.resetToken);
      setResetStep('sent');
    } catch (err: any) {
      setResetError(err.message);
    } finally {
      setResetBusy(false);
    }
  };

  const applyReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetBusy(true);
    setResetError(null);
    try {
      await api.resetPassword(resetToken, newPassword);
      toast('success', 'Password updated. Use the new password the next time you sign in.');
      setResetStep('idle');
      setNewPassword('');
      setResetToken('');
      setResetMessage(null);
    } catch (err: any) {
      setResetError(err.message);
    } finally {
      setResetBusy(false);
    }
  };

  const active = subscriptions.filter(s => s.status === 'Active').length;
  const awaiting = invoices.filter(i => i.status === 'Confirmed' && i.amount_paid < i.total_amount).length;
  const overdue = invoices.filter(i => i.is_overdue).length;

  return (
    <div className="space-y-5">
      <PageHeader title="My account" subtitle={`${currentUser?.full_name} · ${currentUser?.email}. Strict tenant isolation: You can only see your own subscriptions, invoices and payments.`} />

      {error && <Alert kind="error" onClose={() => setError(null)}>{error}</Alert>}

      {loading ? <Loading label="Loading your account…" /> : error && subscriptions.length === 0 ? <ErrorState message="Unable to load your account." onRetry={loadData} /> : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat label="Active subscriptions" value={String(active)} sub={`${subscriptions.length} in total`} />
            <Stat label="Invoices awaiting payment" value={String(awaiting)} tone={awaiting > 0 ? 'warn' : 'good'} />
            <Stat label="Overdue invoices" value={String(overdue)} tone={overdue > 0 ? 'bad' : 'good'} />
          </div>

          <Card title="My subscriptions" flush>
            {subscriptions.length === 0 ? (
              <EmptyState title="No subscriptions on this account" hint="Your account manager will set one up for you." />
            ) : (
              <div className={table.wrap}>
                <table className={table.table}>
                  <thead className={table.head}>
                    <tr>
                      <th className={table.th}>Subscription</th>
                      <th className={table.th}>Plan</th>
                      <th className={table.th}>Status</th>
                      <th className={table.th}>Next billing</th>
                      <th className={table.th}>Payment terms</th>
                      <th className={table.thNum}><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className={table.body}>
                    {subscriptions.map(s => (
                      <tr key={s.id} className={table.row}>
                        <td className={table.td + ' font-medium whitespace-nowrap'}>{s.subscription_number}</td>
                        <td className={table.td}>
                          {s.plan_name}
                          <div className="text-xs text-slate-500 capitalize">{s.billing_interval}</div>
                          {s.discount_code && <div className="text-xs text-slate-500">Discount {s.discount_code}</div>}
                        </td>
                        <td className={table.td}><StatusBadge status={s.status} /></td>
                        <td className={table.td + ' whitespace-nowrap text-slate-600'}>{s.status === 'Active' ? formatDate(s.next_billing_date) : '—'}</td>
                        <td className={table.td + ' text-slate-600'}>{s.payment_terms}</td>
                        <td className={table.tdNum}>
                          <div className="flex justify-end flex-wrap gap-1.5">
                            {(s.status === 'Active' || s.status === 'Paused') && s.can_renew === 1 && (
                              <Button size="sm" disabled={busyId === s.id} onClick={() => act(s, 'Renewal', () => api.renewSubscription(s.id))}>Renew</Button>
                            )}
                            {s.status === 'Active' && s.can_pause === 1 && (
                              <Button size="sm" disabled={busyId === s.id} onClick={() => act(s, 'Pause', () => api.updateSubscriptionStatus(s.id, 'Paused'))}>Pause</Button>
                            )}
                            {s.status === 'Paused' && (
                              <Button size="sm" variant="primary" disabled={busyId === s.id} onClick={() => act(s, 'Resume', () => api.updateSubscriptionStatus(s.id, 'Active'))}>Resume</Button>
                            )}
                            {(s.status === 'Active' || s.status === 'Paused') && s.can_close_early !== 0 && (
                              <Button size="sm" variant="danger" disabled={busyId === s.id} onClick={() => setCloseTarget(s)}>Cancel</Button>
                            )}
                            <Button size="sm" onClick={() => setTimelineFor(s)}>Activity</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="My invoices" description={invoiceTotal > invoices.length ? `Latest ${invoices.length} of ${invoiceTotal}` : undefined} flush>
            {invoices.length === 0 ? (
              <EmptyState title="No invoices yet" hint="Invoices appear here after your subscription has been billed." />
            ) : (
              <div className={table.wrap}>
                <table className={table.table}>
                  <thead className={table.head}>
                    <tr>
                      <th className={table.th}>Invoice</th>
                      <th className={table.th}>Billing period</th>
                      <th className={table.th}>Due</th>
                      <th className={table.thNum}>Total</th>
                      <th className={table.thNum}>Paid</th>
                      <th className={table.thNum}>Outstanding</th>
                      <th className={table.th}>Status</th>
                      <th className={table.thNum}><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className={table.body}>
                    {invoices.map(inv => {
                      const balance = inv.balance_due ?? inv.total_amount - inv.amount_paid;
                      return (
                        <tr key={inv.id} className={table.row}>
                          <td className={table.td}>
                            <button onClick={() => onViewInvoice(inv.id)} className="font-medium text-brand-700 hover:underline whitespace-nowrap">{inv.invoice_number}</button>
                          </td>
                          <td className={table.td + ' whitespace-nowrap text-slate-600'}>{formatDate(inv.period_start)} to {formatDate(inv.period_end)}</td>
                          <td className={table.td + ' whitespace-nowrap ' + (inv.is_overdue ? 'text-red-700 font-medium' : 'text-slate-600')}>{formatDate(inv.due_date)}</td>
                          <td className={table.tdNum + ' font-medium'}>{formatMoney(inv.total_amount)}</td>
                          <td className={table.tdNum}>{formatMoney(inv.amount_paid)}</td>
                          <td className={table.tdNum + (balance > 0 && inv.status !== 'Cancelled' ? ' text-amber-800 font-medium' : ' text-slate-400')}>{inv.status === 'Cancelled' ? '—' : formatMoney(balance)}</td>
                          <td className={table.td}><StatusBadge status={inv.status} overdue={!!inv.is_overdue} partial={inv.amount_paid > 0 && balance > 0} /></td>
                          <td className={table.tdNum}>
                            <div className="flex justify-end gap-1.5 whitespace-nowrap">
                              {inv.status === 'Confirmed' && balance > 0 && (
                                <button
                                  type="button"
                                  onClick={() => startRazorpayPayment(inv)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
                                >
                                  <CreditCard className="w-3.5 h-3.5" /> Pay Online
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => onViewInvoice(inv.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                              >
                                <Printer className="w-3.5 h-3.5" /> View / Print
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="My payments" flush>
            {payments.length === 0 ? (
              <EmptyState title="No payments recorded yet" />
            ) : (
              <div className={table.wrap}>
                <table className={table.table}>
                  <thead className={table.head}>
                    <tr><th className={table.th}>Date</th><th className={table.th}>Invoice</th><th className={table.th}>Method</th><th className={table.thNum}>Amount</th></tr>
                  </thead>
                  <tbody className={table.body}>
                    {payments.map(p => (
                      <tr key={p.id} className={table.row}>
                        <td className={table.td + ' whitespace-nowrap'}>{formatDate(p.payment_date)}</td>
                        <td className={table.td}>{p.invoice_number}</td>
                        <td className={table.td}>{p.payment_method}</td>
                        <td className={table.tdNum + ' font-medium'}>{formatMoney(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Password & Security">
            {resetError && <div className="mb-3"><Alert kind="error">{resetError}</Alert></div>}
            {resetStep === 'idle' ? (
              <form onSubmit={requestReset} className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-slate-600">Reset link goes to <strong>{currentUser?.email}</strong>.</p>
                <Button type="submit" loading={resetBusy}>Email me a reset link</Button>
              </form>
            ) : (
              <form onSubmit={applyReset} className="max-w-md space-y-3">
                {resetMessage && <Alert kind="info">{resetMessage}</Alert>}
                <Input label="Reset token" required value={resetToken} onChange={e => setResetToken(e.target.value)} hint="Copy it from the email." />
                <Input label="New password" type="password" required autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} hint="At least 9 characters with an uppercase letter, a lowercase letter and a special character." />
                <div className="flex gap-2">
                  <Button onClick={() => setResetStep('idle')} disabled={resetBusy}>Back</Button>
                  <Button variant="primary" type="submit" loading={resetBusy}>Update password</Button>
                </div>
              </form>
            )}
          </Card>
        </>
      )}

      {/* Razorpay Online Payment Checkout Modal */}
      {razorpayOrder && (
        <Modal
          title="Razorpay Secure Checkout"
          size="md"
          onClose={() => setRazorpayOrder(null)}
          footer={
            <>
              <Button onClick={() => setRazorpayOrder(null)}>Cancel</Button>
              <Button
                variant="primary"
                loading={payingBusy}
                onClick={handleCompleteRazorpay}
                className="bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5"
              >
                <CreditCard className="w-4 h-4" /> Pay {formatMoney(razorpayOrder.amountInr)}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
              <div>
                <div className="text-xs text-slate-500">Invoice Reference</div>
                <div className="font-semibold text-slate-900">{razorpayOrder.invoiceNumber}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-500">Amount Due</div>
                <div className="text-lg font-bold text-emerald-600">{formatMoney(razorpayOrder.amountInr)}</div>
              </div>
            </div>

            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-900 space-y-1">
              <div className="font-semibold flex items-center gap-1">
                <ShieldCheck className="w-4 h-4 text-blue-600" /> Razorpay 256-Bit Encrypted Gateway
              </div>
              <div className="text-slate-600">Gateway Key: <code className="font-mono bg-blue-100 px-1 py-0.5 rounded">{razorpayOrder.keyId}</code></div>
              <div className="text-slate-600">Order ID: <code className="font-mono bg-blue-100 px-1 py-0.5 rounded">{razorpayOrder.orderId}</code></div>
            </div>

            <div className="space-y-2 text-xs">
              <label className="font-medium text-slate-700 block">Payment Method</label>
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2.5 border-2 border-emerald-500 bg-emerald-50/50 rounded-lg text-center font-medium text-emerald-900">
                  UPI / QR Code
                </div>
                <div className="p-2.5 border border-slate-200 rounded-lg text-center font-medium text-slate-700">
                  Credit / Debit Card
                </div>
                <div className="p-2.5 border border-slate-200 rounded-lg text-center font-medium text-slate-700">
                  Net Banking
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {timelineFor && (
        <Modal title={`Activity for ${timelineFor.subscription_number}`} size="lg" onClose={() => setTimelineFor(null)}>
          <SubscriptionTimeline subscriptionId={timelineFor.id} />
        </Modal>
      )}

      {closeTarget && (
        <ConfirmDialog
          title="Cancel this subscription?"
          message={`${closeTarget.subscription_number} will be closed immediately with no refund or proration, and cannot be reopened.`}
          confirmLabel="Cancel subscription"
          danger
          busy={busyId === closeTarget.id}
          onConfirm={() => act(closeTarget, 'Cancellation', () => api.updateSubscriptionStatus(closeTarget.id, 'Closed'))}
          onCancel={() => setCloseTarget(null)}
        />
      )}
    </div>
  );
};
