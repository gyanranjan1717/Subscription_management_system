import { execute } from '../db/database.js';

export function audit(
  eventType: string,
  description: string,
  userId: number | null | undefined,
  metadata: unknown,
  refs: { subscriptionId?: number; invoiceId?: number } = {}
): void {
  execute(
    'INSERT INTO audit_logs (event_type, description, user_id, subscription_id, invoice_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?)',
    [
      eventType,
      description,
      userId ?? null,
      refs.subscriptionId ?? null,
      refs.invoiceId ?? null,
      metadata === undefined ? null : JSON.stringify(metadata)
    ]
  );
}
