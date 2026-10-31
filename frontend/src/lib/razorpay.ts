import { RazorpayOrder } from '../types.js';

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

interface CheckoutSuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface CheckoutOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: { name: string; email: string };
  theme: { color: string };
  handler: (response: CheckoutSuccess) => void;
  modal: { ondismiss: () => void };
}

interface RazorpayInstance {
  open(): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: CheckoutOptions) => RazorpayInstance;
  }
}

let loading: Promise<void> | null = null;

/** Loads Razorpay's hosted checkout script once. */
export function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = CHECKOUT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        loading = null;
        script.remove();
        reject(new Error('Could not load the Razorpay checkout. Check your connection and try again.'));
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}

/**
 * Opens Razorpay Checkout for an order created by our server. Resolves with the signed payment
 * details (to be verified server-side), or rejects if the customer closes it or the payment fails.
 */
export async function payWithRazorpay(order: RazorpayOrder): Promise<CheckoutSuccess> {
  await loadCheckout();
  const Razorpay = window.Razorpay;
  if (!Razorpay) throw new Error('Razorpay checkout is unavailable.');

  return new Promise<CheckoutSuccess>((resolve, reject) => {
    const rzp = new Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amountPaise,
      currency: order.currency,
      name: 'Brightloop Software',
      description: `Invoice ${order.invoiceNumber}`,
      prefill: order.prefill,
      theme: { color: '#714b67' },
      handler: resolve,
      modal: { ondismiss: () => reject(new Error('Payment cancelled. You have not been charged.')) }
    });
    rzp.open();
  });
}
