import { HttpError, badRequest } from './errors.js';
import { isIsoDate } from './dates.js';
import { parseMoney, Cents } from './money.js';

export type Body = Record<string, unknown>;

export function asBody(raw: unknown): Body {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('Request body must be a JSON object.');
  }
  return raw as Body;
}

export function str(b: Body, key: string, opts: { required?: boolean; max?: number } = {}): string | null {
  const v = b[key];
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw badRequest(`${key} is required.`);
    return null;
  }
  if (typeof v !== 'string') throw badRequest(`${key} must be a string.`);
  const t = v.trim();
  if (opts.required && !t) throw badRequest(`${key} is required.`);
  if (t.length > (opts.max ?? 500)) throw badRequest(`${key} is too long.`);
  return t || null;
}

export function reqStr(b: Body, key: string, max?: number): string {
  return str(b, key, { required: true, max })!;
}

export function int(b: Body, key: string, opts: { min?: number; max?: number; required?: boolean; def?: number } = {}): number {
  const v = b[key];
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw badRequest(`${key} is required.`);
    return opts.def as number;
  }
  const n = typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n)) throw badRequest(`${key} must be a whole number.`);
  if (opts.min !== undefined && n < opts.min) throw badRequest(`${key} must be at least ${opts.min}.`);
  if (opts.max !== undefined && n > opts.max) throw badRequest(`${key} must be at most ${opts.max}.`);
  return n;
}

export function money(b: Body, key: string, opts: { required?: boolean; positive?: boolean; def?: Cents } = {}): Cents {
  const v = b[key];
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw badRequest(`${key} is required.`);
    return opts.def ?? 0;
  }
  const c = parseMoney(v);
  if (c === null) throw badRequest(`${key} must be a non-negative amount with at most 2 decimals.`);
  if (opts.positive && c <= 0) throw badRequest(`${key} must be greater than zero.`);
  return c;
}

export function percent(b: Body, key: string, opts: { required?: boolean } = {}): number {
  const v = b[key];
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw badRequest(`${key} is required.`);
    return 0;
  }
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100 || Math.round(n * 100) / 100 !== n) {
    throw badRequest(`${key} must be a number between 0 and 100 with at most 2 decimals.`);
  }
  return n;
}

export function date(b: Body, key: string, opts: { required?: boolean } = {}): string | null {
  const v = b[key];
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw badRequest(`${key} is required.`);
    return null;
  }
  if (!isIsoDate(v)) throw badRequest(`${key} must be a valid date in YYYY-MM-DD format.`);
  return v;
}

export function oneOf<T extends string>(b: Body, key: string, allowed: readonly T[], opts: { def?: T } = {}): T {
  const v = b[key];
  if (v === undefined || v === null || v === '') {
    if (opts.def !== undefined) return opts.def;
    throw badRequest(`${key} is required (one of: ${allowed.join(', ')}).`);
  }
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    throw badRequest(`${key} must be one of: ${allowed.join(', ')}.`);
  }
  return v as T;
}

export function bool(b: Body, key: string, def: boolean): boolean {
  const v = b[key];
  if (v === undefined || v === null) return def;
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === 0) return v === 1;
  throw badRequest(`${key} must be true or false.`);
}

/** Malformed ids are reported as 404, the same as a missing record. */
export function idParam(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'Resource not found.');
  return n;
}

export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 200;

/** Every list endpoint is paginated: page 1 of 100 rows unless the caller asks otherwise (max 200). */
export function pagination(query: Record<string, unknown>, defaultSize = DEFAULT_PAGE_SIZE, maxSize = MAX_PAGE_SIZE): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1);
  const size = Number.parseInt(String(query.page_size ?? defaultSize), 10) || defaultSize;
  const pageSize = Math.min(maxSize, Math.max(1, size));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function email(b: Body, key = 'email'): string {
  const e = reqStr(b, key, 254).toLowerCase();
  if (!EMAIL_RE.test(e)) throw badRequest('A valid email address is required.');
  return e;
}

/** Quotes a CSV field and neutralises spreadsheet formula injection. */
export function csvField(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Index-friendly prefix search pattern for GLOB (wildcards in user input are removed). */
export function globPrefix(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().replace(/[*?\[\]]/g, '').slice(0, 40);
  return t ? `${t}*` : null;
}

export function pageMeta(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Optional ?from=&to= (YYYY-MM-DD) filter values. */
export function dateRange(query: Record<string, unknown>): { from: string | null; to: string | null } {
  const from = query.from === undefined || query.from === '' ? null : String(query.from);
  const to = query.to === undefined || query.to === '' ? null : String(query.to);
  for (const v of [from, to]) if (v !== null && !isIsoDate(v)) throw badRequest('from / to must be valid dates in YYYY-MM-DD format.');
  if (from && to && to < from) throw badRequest('to cannot be before from.');
  return { from, to };
}
