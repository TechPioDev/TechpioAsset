import { describe, expect, it } from 'vitest';
import { ApiError } from './api-client';
import {
  canSubmitPasswordChange,
  formatSecret,
  isCompleteCode,
  parseOtpauthUrl,
  passwordMismatch,
  postCredential,
  problemMessage,
  sanitizeCode,
} from './account-security';

describe('otpauth URI handling', () => {
  it('reads issuer and account from a TOTP URI', () => {
    expect(
      parseOtpauthUrl('otpauth://totp/PioAssets:jo%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=PioAssets'),
    ).toEqual({ issuer: 'PioAssets', account: 'jo@example.com' });
  });

  it('falls back to the label issuer when the parameter is missing', () => {
    expect(parseOtpauthUrl('otpauth://totp/Acme:jo?secret=ABC')).toEqual({ issuer: 'Acme', account: 'jo' });
  });

  it('refuses anything that is not a TOTP otpauth link with a secret', () => {
    expect(parseOtpauthUrl('https://evil.example/otpauth://totp/x?secret=A')).toBeNull();
    expect(parseOtpauthUrl('otpauth://hotp/x?secret=A&counter=1')).toBeNull();
    expect(parseOtpauthUrl('otpauth://totp/x?issuer=A')).toBeNull();
    expect(parseOtpauthUrl('otpauth://totp/%E0%A4%A?secret=A')).toBeNull();
    expect(parseOtpauthUrl(undefined)).toBeNull();
  });

  it('never returns the secret itself', () => {
    const details = parseOtpauthUrl('otpauth://totp/A:b?secret=SUPERSECRET');
    expect(JSON.stringify(details)).not.toContain('SUPERSECRET');
  });

  it('formats the manual key in groups of four', () => {
    expect(formatSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
    expect(formatSecret('ABCDE')).toBe('ABCD E');
    expect(formatSecret('AB CD')).toBe('ABCD');
  });
});

describe('code and password inputs', () => {
  it('keeps only six digits in a code box', () => {
    expect(sanitizeCode('12 34-56 78')).toBe('123456');
    expect(isCompleteCode('123456')).toBe(true);
    expect(isCompleteCode('12345')).toBe(false);
  });

  it('enables change password only with a current password and a matching pair', () => {
    expect(canSubmitPasswordChange('', 'Abcdefghijk1', 'Abcdefghijk1')).toBe(false);
    expect(canSubmitPasswordChange('old', '', '')).toBe(false);
    expect(canSubmitPasswordChange('old', 'Abcdefghijk1', 'Abcdefghijk2')).toBe(false);
    expect(canSubmitPasswordChange('old', 'Abcdefghijk1', 'Abcdefghijk1')).toBe(true);
  });

  it('shows the mismatch message only once the repeat box has text', () => {
    expect(passwordMismatch('abc', '')).toBe(false);
    expect(passwordMismatch('abc', 'ab')).toBe(true);
    expect(passwordMismatch('abc', 'abc')).toBe(false);
  });
});

describe('problemMessage', () => {
  it('prefers the first field error, then detail, then title - as the web does', () => {
    const fieldError = new ApiError(
      {
        type: 'about:blank',
        title: 'Validation failed',
        status: 400,
        detail: 'Bad',
        errors: [{ path: 'newPassword', message: 'Password must contain a digit' }],
      } as never,
      400,
    );
    expect(problemMessage(fieldError, 'x')).toBe('Password must contain a digit');
    expect(problemMessage(new ApiError({ title: 'T', detail: 'Password is incorrect' } as never, 401), 'x')).toBe(
      'Password is incorrect',
    );
    expect(problemMessage(new ApiError(null, 500), 'fallback')).toBe('fallback');
    expect(problemMessage('weird', 'fallback')).toBe('fallback');
  });
});

describe('postCredential', () => {
  it('refreshes first, then sends the secret exactly once with replay switched off', async () => {
    const calls: { path: string; options?: { method?: string; body?: unknown; skipRefresh?: boolean } }[] = [];
    const api = {
      async request<T>(path: string, options?: { method?: string; body?: unknown; skipRefresh?: boolean }) {
        calls.push({ path, options });
        if (path === '/auth/confirm-password') throw new ApiError({ detail: 'Password is incorrect' } as never, 401);
        return undefined as T;
      },
    };

    await expect(postCredential(api, '/auth/confirm-password', { password: 'pw' })).rejects.toThrow(
      'Password is incorrect',
    );
    expect(calls.map((c) => c.path)).toEqual(['/auth/me', '/auth/confirm-password']);
    expect(calls[0]!.options?.body).toBeUndefined();
    expect(calls[1]!.options).toEqual({ method: 'POST', body: { password: 'pw' }, skipRefresh: true });
    expect(calls.filter((c) => JSON.stringify(c.options?.body ?? null).includes('pw'))).toHaveLength(1);
  });
});
