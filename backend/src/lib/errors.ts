import { Request, Response, NextFunction, RequestHandler } from 'express';

/** An error whose message is safe to show to the client. Anything else becomes a generic 500. */
export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const forbidden = (msg = 'Access denied.') => new HttpError(403, msg);
export const notFound = (msg = 'Resource not found.') => new HttpError(404, msg);
export const conflict = (msg: string) => new HttpError(409, msg);

/** Wraps a route handler so thrown errors (sync or async) reach the central error middleware. */
export function handle(fn: (req: Request, res: Response) => unknown | Promise<unknown>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch(next);
  };
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}
