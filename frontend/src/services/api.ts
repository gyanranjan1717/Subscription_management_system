import {
  User, Product, Plan, TaxRule, DiscountRule, QuotationTemplate,
  Subscription, Invoice, Payment, DashboardMetrics, TimelineEvent
} from '../types.js';

import type { PageInfo } from '../components/Pager.js';

export interface IntegrityReport {
  generatedAt: string;
  ok: boolean;
  duplicatePeriods: number;
  missingPeriods: number;
  inconsistentInvoiceTotals: number;
  inconsistentPayments: number;
  invalidReferences: number;
}

const API_BASE = '/api';


let currentToken: string | null = localStorage.getItem('brightloop_token');
let currentUser: User | null = localStorage.getItem('brightloop_user')
  ? JSON.parse(localStorage.getItem('brightloop_user')!)
  : null;

export function getToken(): string | null {
  return currentToken;
}

export function getCurrentUser(): User | null {
  return currentUser;
}

export function setSession(token: string | null, user: User | null): void {
  currentToken = token;
  currentUser = user;
  if (token && user) {
    localStorage.setItem('brightloop_token', token);
    localStorage.setItem('brightloop_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('brightloop_token');
    localStorage.removeItem('brightloop_user');
  }
}

async function request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {})
  };

  if (currentToken) {
    headers['Authorization'] = `Bearer ${currentToken}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || data.message || `Request failed with status ${response.status}`);
  }

  return data;
}

export const api = {
  // Auth
  async login(email: string, password: string): Promise<{ user: User; token: string }> {
    const data = await request<{ user: User; token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    setSession(data.token, data.user);
    return data;
  },

  async me(): Promise<{ user: User }> {
    return request('/auth/me');
  },

  async sendOtp(email: string): Promise<{ success: boolean; message: string; otpPreview?: string }> {
    return request('/auth/send-otp', { method: 'POST', body: JSON.stringify({ email }) });
  },

  async verifyOtp(email: string, otp: string): Promise<{ success: boolean; message: string }> {
    return request('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email, otp }) });
  },

  async register(body: { email: string; password: string; full_name: string; phone?: string; company_name?: string; otp?: string; admin_key?: string }): Promise<any> {
    const data = await request('/auth/register', { method: 'POST', body: JSON.stringify(body) });
    if (data.token && data.user) {
      setSession(data.token, data.user);
    }
    return data;
  },

  async forgotPassword(email: string): Promise<{ success: boolean; resetToken: string; resetUrl: string; message: string }> {
    return request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
  },

  async resetPassword(token: string, new_password: string): Promise<any> {
    return request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, new_password }) });
  },

  async createStaff(body: { email: string; password: string; full_name: string; phone?: string }): Promise<any> {
    return request('/auth/staff', { method: 'POST', body: JSON.stringify(body) });
  },

  async getCustomers(q?: string): Promise<{ customers: Array<{ id: number; email: string; full_name: string; company_name: string | null }> }> {
    return request(`/auth/customers${q ? '?q=' + encodeURIComponent(q) : ''}`);
  },

  async getStaff(): Promise<{ staff: any[] }> {
    return request('/auth/staff');
  },

  // Catalog
  async getProducts(): Promise<{ products: Product[] }> {
    return request('/catalog/products');
  },

  async createProduct(body: any): Promise<any> {
    return request('/catalog/products', { method: 'POST', body: JSON.stringify(body) });
  },

  async getPlans(): Promise<{ plans: Plan[] }> {
    return request('/catalog/plans');
  },

  async createPlan(body: any): Promise<any> {
    return request('/catalog/plans', { method: 'POST', body: JSON.stringify(body) });
  },

  async getTaxes(): Promise<{ taxes: TaxRule[] }> {
    return request('/catalog/taxes');
  },

  async createTax(body: any): Promise<any> {
    return request('/catalog/taxes', { method: 'POST', body: JSON.stringify(body) });
  },

  async getDiscounts(): Promise<{ discounts: DiscountRule[] }> {
    return request('/catalog/discounts');
  },

  async createDiscount(body: any): Promise<any> {
    return request('/catalog/discounts', { method: 'POST', body: JSON.stringify(body) });
  },

  async getQuotationTemplates(): Promise<{ templates: QuotationTemplate[] }> {
    return request('/catalog/quotation-templates');
  },

  async createQuotationTemplate(body: any): Promise<any> {
    return request('/catalog/quotation-templates', { method: 'POST', body: JSON.stringify(body) });
  },

  // Subscriptions
  async getSubscriptions(params?: { status?: string; customer_id?: number; page?: number; q?: string }): Promise<{ subscriptions: Subscription[]; pagination: PageInfo }> {
    const qs = new URLSearchParams();
    if (params?.page) qs.append('page', String(params.page));
    if (params?.q) qs.append('q', params.q);
    if (params?.status && params.status !== 'All') qs.append('status', params.status);
    if (params?.customer_id) qs.append('customer_id', String(params.customer_id));
    const url = `/subscriptions${qs.toString() ? '?' + qs.toString() : ''}`;
    return request(url);
  },

  async getSubscription(id: number): Promise<{ subscription: Subscription }> {
    return request(`/subscriptions/${id}`);
  },

  async createSubscription(body: any): Promise<{ subscription: any }> {
    return request('/subscriptions', { method: 'POST', body: JSON.stringify(body) });
  },

  async updateSubscriptionStatus(id: number, status: string): Promise<any> {
    return request(`/subscriptions/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  },

  async renewSubscription(id: number): Promise<any> {
    return request(`/subscriptions/${id}/renew`, { method: 'POST' });
  },

  async getSubscriptionTimeline(id: number): Promise<{ subscription_number: string; timeline: TimelineEvent[] }> {
    return request(`/subscriptions/${id}/timeline`);
  },

  // Billing
  async runBillingCycle(opts: { as_of_date?: string; dry_run?: boolean; auto_confirm?: boolean } = {}): Promise<{ result: any }> {
    return request('/billing/run', { method: 'POST', body: JSON.stringify(opts) });
  },

  async getIntegrityReport(): Promise<{ report: IntegrityReport }> {
    return request('/billing/integrity');
  },

  async confirmDraftInvoices(): Promise<{ confirmed: number }> {
    return request('/billing/invoices/confirm-drafts', { method: 'POST' });
  },

  async getBillingHistory(): Promise<{ history: any[] }> {
    return request('/billing/history');
  },

  async getInvoices(params?: { status?: string; overdue?: boolean; page?: number; q?: string; from?: string; to?: string }): Promise<{ invoices: Invoice[]; pagination: PageInfo }> {
    const qs = new URLSearchParams();
    if (params?.page) qs.append('page', String(params.page));
    if (params?.status && params.status !== 'All') qs.append('status', params.status);
    if (params?.overdue) qs.append('overdue', 'true');
    if (params?.q) qs.append('q', params.q);
    if (params?.from) qs.append('from', params.from);
    if (params?.to) qs.append('to', params.to);
    return request(`/billing/invoices${qs.toString() ? '?' + qs.toString() : ''}`);
  },

  async getInvoice(id: number): Promise<{ invoice: Invoice }> {
    return request(`/billing/invoices/${id}`);
  },

  async updateInvoiceStatus(id: number, status: string): Promise<any> {
    return request(`/billing/invoices/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  },

  async sendInvoice(id: number): Promise<any> {
    return request(`/billing/invoices/${id}/send`, { method: 'POST' });
  },

  // Payments
  async getPayments(params?: { invoice_id?: number; page?: number }): Promise<{ payments: Payment[]; pagination: PageInfo }> {
    const qs = new URLSearchParams();
    if (params?.invoice_id) qs.append('invoice_id', String(params.invoice_id));
    if (params?.page) qs.append('page', String(params.page));
    return request(`/payments${qs.toString() ? '?' + qs.toString() : ''}`);
  },

  async recordPayment(body: { invoice_id: number; amount: number | string; payment_method: string; payment_date?: string; reference?: string; note?: string }): Promise<any> {
    return request('/payments', { method: 'POST', body: JSON.stringify(body) });
  },

  // Analytics
  async getSummary(range?: { from?: string; to?: string }): Promise<{ metrics: DashboardMetrics; planBreakdown: any[]; overdueInvoices: any[]; recentEvents: any[] }> {
    const qs = new URLSearchParams();
    if (range?.from) qs.append('from', range.from);
    if (range?.to) qs.append('to', range.to);
    return request(`/analytics/summary${qs.toString() ? '?' + qs.toString() : ''}`);
  },

  /** Authenticated CSV download (a plain link would not carry the bearer token). */
  async downloadCsv(kind: 'invoices' | 'subscriptions'): Promise<void> {
    const response = await fetch(`${API_BASE}/analytics/export/${kind}`, {
      headers: currentToken ? { Authorization: `Bearer ${currentToken}` } : {}
    });
    if (!response.ok) throw new Error(`Export failed (${response.status})`);
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `brightloop_${kind}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },

  async getBenchmark(): Promise<any> {
    return request('/analytics/benchmark');
  }
};
