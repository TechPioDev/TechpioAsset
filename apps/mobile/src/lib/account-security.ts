import { ApiError } from './api-client';

/**
 * Pure helpers for the phone's security screen: password change and
 * two-factor set-up. The endpoints and messages are the web security page's
 * (apps/web/src/app/(app)/settings/security/page.tsx); nothing here stores,
 * logs or forwards a password or a TOTP secret.
 */

/** Wording the web page shows under the new-password boxes. */
export const PASSWORD_RULES_HINT =
  'At least 12 characters, with an uppercase letter, a lowercase letter and a digit.';

export const PASSWORDS_DO_NOT_MATCH = 'The two passwords do not match.';

/** What the web shows for an API failure: first field error, then detail, then title. */
export function problemMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.problem?.errors?.[0]?.message ?? error.problem?.detail ?? error.problem?.title ?? fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

/** A 6-digit code box: digits only, never longer than six (as the web input). */
export function sanitizeCode(text: string): string {
  return text.replace(/\D/g, '').slice(0, 6);
}

export function isCompleteCode(code: string): boolean {
  return /^\d{6}$/.test(code);
}

/** The web enables "Change password" only with a current password and a matching pair. */
export function canSubmitPasswordChange(current: string, next: string, again: string): boolean {
  return current.length > 0 && next.length > 0 && next === again;
}

/** Show the mismatch message only once the repeat box has something in it. */
export function passwordMismatch(next: string, again: string): boolean {
  return again.length > 0 && next !== again;
}

export interface OtpauthDetails {
  issuer: string | null;
  account: string | null;
}

/**
 * Accepts only a TOTP otpauth URI, so "Open in authenticator app" can never
 * hand the system some other kind of link. Returns the label parts for display
 * (never the secret: that is shown from the enrolment response itself).
 */
export function parseOtpauthUrl(url: unknown): OtpauthDetails | null {
  if (typeof url !== 'string') return null;
  const match = /^otpauth:\/\/totp\/([^?#]*)\?(.*)$/i.exec(url.trim());
  if (!match) return null;
  // Parsed by hand: React Native's URLSearchParams polyfill does not implement get().
  let label = '';
  const params = new Map<string, string>();
  try {
    label = decodeURIComponent(match[1] ?? '');
    for (const pair of (match[2] ?? '').split('&')) {
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const key = decodeURIComponent(pair.slice(0, eq)).toLowerCase();
      if (!params.has(key)) params.set(key, decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' ')));
    }
  } catch {
    return null;
  }
  if (!params.get('secret')) return null;

  const colon = label.indexOf(':');
  const labelIssuer = colon >= 0 ? label.slice(0, colon).trim() : '';
  const account = (colon >= 0 ? label.slice(colon + 1) : label).trim();
  const issuer = params.get('issuer')?.trim() || labelIssuer;
  return { issuer: issuer || null, account: account || null };
}

/** Groups of four, which is how authenticator apps expect a key to be read out. */
export function formatSecret(secret: string): string {
  return secret.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ');
}

interface Requester {
  request<T>(
    path: string,
    options?: { method?: string; body?: unknown; skipRefresh?: boolean },
  ): Promise<T>;
}

/**
 * POSTs a body carrying a password or code exactly once.
 *
 * These endpoints answer a wrong password with 401, and the API client treats
 * any 401 as an expired token: it refreshes and replays the request. That
 * would send the password twice and spend two of the throttle's attempts on
 * one typo. So the session is refreshed first with a harmless read, and the
 * credential-bearing call goes out with replay switched off.
 */
export async function postCredential<T = void>(api: Requester, path: string, body: unknown): Promise<T> {
  await api.request('/auth/me');
  return api.request<T>(path, { method: 'POST', body, skipRefresh: true });
}
