import type { Request, Response } from 'express';
import { SESSION_MS } from './session.service';

// The __Host- prefix makes browsers insist on Secure, Path=/ and no Domain.
export const SESSION_COOKIE = '__Host-bankapp-session';

/** The session id the request carries, if any. */
export function readSessionId(request: Request): string | undefined {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) return value.join('=') || undefined;
  }
  return undefined;
}

const attributes = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' } as const;

export function setSessionCookie(response: Response, id: string): void {
  response.cookie(SESSION_COOKIE, id, { ...attributes, maxAge: SESSION_MS });
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie(SESSION_COOKIE, attributes);
}
