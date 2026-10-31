export interface User {
  id: number;
  email: string;
  full_name: string;
  role: 'admin' | 'staff' | 'customer';
  phone?: string;
  company_name?: string;
}

export interface ProductVariant {
  id: number;
  product_id: number;
  attribute_name: string;
  option_name: string;
  price_extra: number;
}

export interface Product {
  id: number;
  name: string;
  type: 'service' | 'software' | 'addon' | 'consumable';
  sales_price: number;
  cost_price: number;
  notes?: string;
  is_active: number;
  variants?: ProductVariant[];
}

export interface Plan {
  id: number;
  name: string;
  billing_interval: 'daily' | 'weekly' | 'monthly' | 'yearly';
  price: number;
  min_quantity: number;
  start_date?: string;
  end_date?: string;
  auto_close: number;
  can_pause: number;
  can_renew: number;
  can_close_early?: number;
  is_active: number;
}

export interface TaxRule {
  id: number;
  name: string;
  rate_percentage: number;
  is_default: number;
  is_active: number;
}

export interface DiscountRule {
  id: number;
  code: string;
  description: string;
  discount_type: 'fixed' | 'percentage';
  value: number;
  min_amount: number;
  min_quantity: number;
  start_date?: string;
  end_date?: string;
  max_uses: number;
  current_uses: number;
  applies_to: 'all' | 'product' | 'subscription';
  target_product_id?: number;
  target_product_name?: string;
  is_active: number;
}

export interface QuotationTemplateLine {
  id: number;
  template_id: number;
  product_id: number;
  variant_id?: number;
  default_quantity: number;
  product_name: string;
  sales_price: number;
  attribute_name?: string;
  option_name?: string;
  price_extra?: number;
}

export interface QuotationTemplate {
  id: number;
  name: string;
  plan_id: number;
  plan_name: string;
  billing_interval: string;
  plan_price: number;
  validity_days: number;
  notes?: string;
  lines: QuotationTemplateLine[];
}

export interface SubscriptionLine {
  id: number;
  subscription_id: number;
  product_id: number;
  variant_id?: number;
  quantity: number;
  unit_price: number;
  tax_id?: number;
  line_amount: number;
  product_name: string;
  attribute_name?: string;
  option_name?: string;
  price_extra?: number;
  tax_name?: string;
  tax_rate?: number;
}

export interface Subscription {
  id: number;
  subscription_number: string;
  customer_id: number;
  customer_name: string;
  customer_email: string;
  company_name?: string;
  customer_phone?: string;
  plan_id: number;
  plan_name: string;
  billing_interval: 'daily' | 'weekly' | 'monthly' | 'yearly';
  plan_price: number;
  can_pause: number;
  can_renew: number;
  can_close_early?: number;
  auto_close: number;
  status: 'Draft' | 'Quotation' | 'Confirmed' | 'Active' | 'Paused' | 'Closed';
  start_date: string;
  expiry_date?: string;
  next_billing_date: string;
  payment_terms: string;
  discount_rule_id?: number;
  discount_code?: string;
  discount_value?: number;
  discount_type?: 'fixed' | 'percentage';
  notes?: string;
  created_at: string;
  lines?: SubscriptionLine[];
  invoices?: Invoice[];
}

export interface InvoiceLine {
  id: number;
  invoice_id: number;
  gross_amount?: number;
  net_amount?: number;
  tax_name?: string;
  tax_rate?: number;
  product_id: number | null;
  variant_id?: number;
  description: string;
  quantity: number;
  unit_price: number;
  tax_amount: number;
  discount_amount: number;
  line_total: number;
}

export interface Payment {
  id: number;
  invoice_id: number;
  amount: number;
  payment_method: 'Bank Transfer' | 'Credit Card' | 'UPI' | 'Cash' | 'Cheque';
  payment_date: string;
  reference?: string;
  note?: string;
  created_at: string;
  invoice_number?: string;
  customer_name?: string;
  invoice_total?: number;
}

export interface Invoice {
  id: number;
  invoice_number: string;
  subscription_id: number;
  subscription_number?: string;
  customer_id: number;
  customer_name?: string;
  customer_email?: string;
  company_name?: string;
  customer_phone?: string;
  period_start: string;
  period_end: string;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  total_amount: number;
  amount_paid: number;
  status: 'Draft' | 'Confirmed' | 'Paid' | 'Cancelled';
  issue_date: string;
  due_date: string;
  balance_due?: number;
  is_overdue?: number;
  created_at: string;
  lines?: InvoiceLine[];
  discounts?: Array<{ code: string; applies_to: string; amount: number }>;
  payments?: Payment[];
}

export interface DashboardMetrics {
  subscriptions: {
    total: number;
    active: number;
    draft: number;
    quotation: number;
    confirmed: number;
    paused: number;
    closed: number;
  };
  recurringRevenue: {
    mrr: number;
    arr: number;
  };
  financials: {
    totalInvoiced: number;
    totalCollected: number;
    totalOwed: number;
    overdueCount: number;
    overdueAmount: number;
  };
  period?: { from: string | null; to: string | null; paymentsCount: number };
  performance: {
    queryExecutionTimeMs: number;
    slaMet: boolean;
  };
}

export interface TimelineEvent {
  id: string;
  type: 'status_change' | 'renewal' | 'invoice' | 'invoice_status' | 'payment' | 'other';
  title: string;
  description: string;
  timestamp: string;
  amount?: number;
  from?: string;
  to?: string;
}
