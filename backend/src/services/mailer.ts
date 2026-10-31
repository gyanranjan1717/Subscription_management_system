import nodemailer, { Transporter } from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import { execute } from '../db/database.js';

// Ensure .env is always loaded with credentials regardless of launch folder
try {
  dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
} catch {
  // fallback
}
dotenv.config();

export type EmailKind = 'RESET' | 'INVOICE' | 'REMINDER' | 'OTP';

export interface QueueEmailInput {
  to: string;
  subject: string;
  text: string;
  kind: EmailKind;
  relatedId?: number | null;
}

/** Public address of the web app, used in emailed links. */
export const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');

/** SMTP is configured only when a real user and password are present (no placeholder values). */
export function smtpConfigured(): boolean {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  return !!user && !!pass && !/your_|changeme|example/i.test(user + pass);
}

/**
 * Brevo (HTTPS API). Use this on hosts that block outbound SMTP, such as Render's free plan.
 * MAIL_FROM must be a sender address verified in Brevo.
 */
export function brevoConfigured(): boolean {
  return !!process.env.BREVO_API_KEY && process.env.BREVO_API_KEY.length > 20 && !!process.env.MAIL_FROM;
}

/** True when some real email channel is available. Otherwise mail is only recorded as "simulated". */
export const emailConfigured = () => brevoConfigured() || smtpConfigured();

/**
 * Local/demo convenience: show OTP codes and reset links on screen instead of by email.
 * Only when no real email channel exists, and in production only if DEMO_MODE=true is set explicitly.
 */
export function showCodesOnScreen(): boolean {
  if (emailConfigured()) return false;
  if (process.env.NODE_ENV === 'production') return process.env.DEMO_MODE === 'true';
  return process.env.EXPOSE_DEV_CODES !== 'false';
}

/** Splits `"Name" <addr@x.com>` or `addr@x.com` into parts for the Brevo API. */
function parseSender(from: string): { name: string; email: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1].trim() || 'Brightloop', email: m[2].trim() } : { name: 'Brightloop', email: from.trim() };
}

async function sendViaBrevo(input: QueueEmailInput): Promise<void> {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY!, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: parseSender(process.env.MAIL_FROM!),
      to: [{ email: input.to }],
      subject: input.subject,
      textContent: input.text,
      htmlContent: renderHtml(input.subject, input.text)
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Brevo ${res.status}: ${detail.slice(0, 200)}`);
  }
}

let transporter: Transporter | null = null;
function getTransporter(): Transporter {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 587);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure: port === 465,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      auth: { user: process.env.SMTP_USER?.trim(), pass: process.env.SMTP_PASS?.replace(/\s+/g, "") }
    });
  }
  return transporter;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function renderHtml(subject: string, text: string): string {
  const body = escapeHtml(text).replace(/\n/g, '<br/>');
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
  <div style="background:#714b67;color:#fff;padding:16px 24px;font-weight:700;font-size:18px">Brightloop</div>
  <div style="padding:24px;color:#0f172a"><h2 style="margin:0 0 12px;font-size:18px">${escapeHtml(subject)}</h2><p style="line-height:1.6;font-size:14px">${body}</p></div>
  <div style="padding:12px 24px;background:#f8fafc;color:#64748b;font-size:12px">This is an automated message from Brightloop Software.</div></div>`;
}

/**
 * Records an email in the outbox and hands it to SMTP in the background.
 * The outbox row is the audit trail either way; `delivery_status` says what actually happened
 * (sent / simulated when SMTP is not configured / failed). The caller never waits on the network.
 */
export function queueEmail(input: QueueEmailInput): number {
  const ins = execute(
    'INSERT INTO email_outbox (to_email, subject, body, kind, related_id, delivery_status) VALUES (?, ?, ?, ?, ?, ?)',
    [input.to, input.subject, input.text, input.kind, input.relatedId ?? null, 'queued']
  );
  const id = Number(ins.lastInsertRowid);

  if (!emailConfigured() || process.env.NODE_ENV === 'test') {
    execute("UPDATE email_outbox SET delivery_status = 'simulated' WHERE id = ?", [id]);
    return id;
  }

  const delivery = brevoConfigured()
    ? sendViaBrevo(input)
    : getTransporter().sendMail({
        from: process.env.MAIL_FROM || `"Brightloop" <${process.env.SMTP_USER}>`,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: renderHtml(input.subject, input.text)
      });

  void delivery
    .then(() => execute("UPDATE email_outbox SET delivery_status = 'sent' WHERE id = ?", [id]))
    .catch((err: Error) => {
      console.warn(`[mailer] delivery to ${input.to} failed: ${err.message}`);
      execute("UPDATE email_outbox SET delivery_status = 'failed', delivery_error = ? WHERE id = ?", [err.message.slice(0, 300), id]);
    });
  return id;
}
