import crypto from 'crypto';
import { HttpError } from '../lib/errors.js';

export interface GatewayOrder {
  id: string;
  amount: number; // paise
  currency: string;
  receipt: string | null;
  status: string;
}

export interface GatewayPayment {
  id: string;
  order_id: string | null;
  amount: number; // paise
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  method?: string;
}

/** The three calls we make to the payment provider. Tests swap in a fake with real signature maths. */
export interface PaymentGateway {
  createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<GatewayOrder>;
  fetchPayment(paymentId: string): Promise<GatewayPayment>;
  capturePayment(paymentId: string, amountPaise: number, currency: string): Promise<GatewayPayment>;
}

const API = 'https://api.razorpay.com/v1';

export function razorpayKeyId(): string | null {
  const id = process.env.RAZORPAY_KEY_ID;
  return id && /^rzp_(test|live)_[A-Za-z0-9]+$/.test(id) ? id : null;
}

function keySecret(): string | null {
  const s = process.env.RAZORPAY_KEY_SECRET;
  return s && s.length >= 8 ? s : null;
}

export function razorpayConfigured(): boolean {
  return razorpayKeyId() !== null && keySecret() !== null;
}

export function razorpayMode(): 'test' | 'live' | null {
  const id = razorpayKeyId();
  return id ? (id.startsWith('rzp_live_') ? 'live' : 'test') : null;
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const id = razorpayKeyId();
  const secret = keySecret();
  if (!id || !secret) throw new HttpError(503, 'Online payments are not configured on this server.');

  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
        'Content-Type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new HttpError(502, 'The payment gateway could not be reached. Please try again.');
  }

  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    const reason = json?.error?.description ? `: ${json.error.description}` : '';
    console.warn(`[razorpay] ${method} ${path} -> ${res.status}${reason}`);
    throw new HttpError(res.status === 401 ? 503 : 502, `The payment gateway rejected the request${reason}`);
  }
  return json as T;
}

let override: PaymentGateway | null = null;
/** Test hook: route all gateway calls to a fake. Pass null to restore the real client. */
export function setGateway(g: PaymentGateway | null): void {
  override = g;
}

export function gateway(): PaymentGateway {
  if (override) return override;
  return {
    createOrder: ({ amountPaise, receipt, notes }) =>
      call<GatewayOrder>('POST', '/orders', { amount: amountPaise, currency: 'INR', receipt, notes }),
    fetchPayment: paymentId => call<GatewayPayment>('GET', `/payments/${encodeURIComponent(paymentId)}`),
    capturePayment: (paymentId, amountPaise, currency) =>
      call<GatewayPayment>('POST', `/payments/${encodeURIComponent(paymentId)}/capture`, { amount: amountPaise, currency })
  };
}

const safeEqualHex = (a: string, b: string) => {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** Checkout signature: HMAC-SHA256(order_id + "|" + payment_id) with the key secret. */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
  const secret = keySecret();
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqualHex(expected, signature);
}

/** Webhook signature: HMAC-SHA256 of the raw request body with the webhook secret. */
export function verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}
