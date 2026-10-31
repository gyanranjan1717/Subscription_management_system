import {
  User, Product, Plan, TaxRule, DiscountRule, QuotationTemplate,
  Subscription, Invoice, Payment, DashboardMetrics
} from '../types.js';

const API_BASE = '/api';

export const DEMO_USERS = {
  admin: { email: 'admin@brightloop.com', password: 'Brightloop#2026', label: '👑 Admin (Alex Mercer)' },
  staff: { email: 'staff@brightloop.com', password: 'Brightloop#2026', label: '💼 Staff (Sarah Jenkins)' },
  customer1: { email: 'acme@corp.com', password: 'Customer#2026', label: '🏢 Customer 1 (Acme Corp)' },
  customer2: { email: 'globex@biz.com', password: 'Customer#2026', label: '🌐 Customer 2 (Globex Inc)' }
};

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

  async register(body: { email: string; password: string; full_name: string; phone?: string; company_name?: string }): Promise<any> {
    return request('/auth/register', { method: 'POST', body: JSON.stringify(body) });
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
  async getSubscriptions(params?: { status?: string; customer_id?: number }): Promise<{ subscriptions: Subscription[] }> {
    const qs = new URLSearchParams();
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

  // Billing
  async runBillingCycle(as_of_date?: string): Promise<{ result: any }> {
    return request('/billing/run', { method: 'POST', body: JSON.stringify({ as_of_date }) });
  },

  async getBillingHistory(): Promise<{ history: any[] }> {
    return request('/billing/history');
  },

  async getInvoices(params?: { status?: string; overdue?: boolean }): Promise<{ invoices: Invoice[] }> {
    const qs = new URLSearchParams();
    if (params?.status && params.status !== 'All') qs.append('status', params.status);
    if (params?.overdue) qs.append('overdue', 'true');
    const url = `/billing/invoices${qs.toString() ? '?' + qs.toString() : ''}`;
    return request(url);
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
  async getPayments(invoice_id?: number): Promise<{ payments: Payment[] }> {
    const url = invoice_id ? `/payments?invoice_id=${invoice_id}` : '/payments';
    return request(url);
  },

  async recordPayment(body: { invoice_id: number; amount: number; payment_method: string; payment_date?: string; reference?: string; note?: string }): Promise<any> {
    return request('/payments', { method: 'POST', body: JSON.stringify(body) });
  },

  // Analytics
  async getSummary(): Promise<{ metrics: DashboardMetrics; planBreakdown: any[]; overdueInvoices: any[]; recentEvents: any[] }> {
    return request('/analytics/summary');
  },

  async getBenchmark(): Promise<any> {
    return request('/analytics/benchmark');
  }
};
