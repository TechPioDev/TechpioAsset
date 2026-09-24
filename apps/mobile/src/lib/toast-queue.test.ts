import { describe, expect, it } from 'vitest';
import {
  DEDUPE_MS,
  MAX_VISIBLE,
  TOAST_MS,
  expireToasts,
  pushToast,
  toneForMessage,
  type Toast,
} from './toast-queue';

const at = (now: number, ...msgs: { tone?: 'success' | 'error' | 'info'; title: string }[]) =>
  msgs.reduce<Toast[]>(
    (q, m) => pushToast(q, { tone: m.tone ?? 'info', title: m.title }, now),
    [],
  );

describe('showing a message', () => {
  it('sets its own end time from its tone', () => {
    const [t] = pushToast([], { tone: 'error', title: 'Could not save' }, 1000);
    expect(t.expiresAt).toBe(1000 + TOAST_MS.error);
    expect(TOAST_MS.error).toBeGreaterThan(TOAST_MS.success);
  });

  it('keeps the newest when more arrive than fit', () => {
    const q = at(0, { title: 'One' }, { title: 'Two' }, { title: 'Three' });
    expect(q).toHaveLength(MAX_VISIBLE);
    expect(q.map((t) => t.title)).toEqual(['Two', 'Three']);
  });

  it('drops ones whose time is up as it goes', () => {
    const first = pushToast([], { tone: 'success', title: 'Saved' }, 0);
    const later = pushToast(first, { tone: 'info', title: 'Something else' }, TOAST_MS.success + 1);
    expect(later.map((t) => t.title)).toEqual(['Something else']);
  });
});

describe('the same message arriving again', () => {
  it('extends it rather than stacking a second copy', () => {
    // The offline scanner re-reads the label in view about once a second and
    // reports the same thing each time. As native alerts they queued up and
    // had to be dismissed one by one.
    const once = pushToast([], { tone: 'error', title: 'No connection' }, 0);
    const twice = pushToast(once, { tone: 'error', title: 'No connection' }, 900);
    expect(twice).toHaveLength(1);
    expect(twice[0].expiresAt).toBe(900 + TOAST_MS.error);
  });

  it('treats it as new once the first is long gone', () => {
    const once = pushToast([], { tone: 'error', title: 'No connection' }, 0);
    const gap = TOAST_MS.error + DEDUPE_MS + 1;
    const again = pushToast(once, { tone: 'error', title: 'No connection' }, gap);
    expect(again).toHaveLength(1);
    expect(again[0].id).not.toBe(once[0].id);
  });

  it('does not merge two messages that only look alike', () => {
    const q = pushToast(
      pushToast([], { tone: 'error', title: 'Could not save', body: 'Check the tag' }, 0),
      { tone: 'error', title: 'Could not save', body: 'Check the serial' },
      100,
    );
    expect(q).toHaveLength(2);
  });
});

describe('expiring', () => {
  it('keeps what is still due and drops what is not', () => {
    const q = at(0, { title: 'One' });
    expect(expireToasts(q, TOAST_MS.info - 1)).toHaveLength(1);
    expect(expireToasts(q, TOAST_MS.info + 1)).toHaveLength(0);
  });
});

describe('reading the tone off the old alert wording', () => {
  it('calls a failure a failure', () => {
    for (const title of [
      'Could not download the report',
      "Couldn't save",
      'Photo not sent',
      'No connection',
      'That failed',
      'Permission denied',
    ]) {
      expect(toneForMessage(title), title).toBe('error');
    }
  });

  it('leaves anything else neutral rather than guessing', () => {
    for (const title of ['Count recorded', 'Request sent', 'Check with Dell']) {
      expect(toneForMessage(title), title).toBe('info');
    }
  });

  it('is not fooled by a word inside another word', () => {
    // "Cannot" matches; "cannoli" must not.
    expect(toneForMessage('Cannoli ordered')).toBe('info');
  });
});
