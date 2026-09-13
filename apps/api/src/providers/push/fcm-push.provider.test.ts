import { generateKeyPairSync, createVerify } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FcmPushProvider, readServiceAccount } from './fcm-push.provider.js';

/**
 * Direct FCM delivery (v2.56).
 *
 * As with Expo, the expensive mistake is pruning a token that was fine - that
 * silences a real person's phone for good - so the pruning rules are pinned as
 * tightly as the happy path. The payload shape is pinned too: it is what makes
 * the phone draw the alert and carry the link through a tap.
 */

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = {
  project_id: 'pioassets-test',
  client_email: 'push@pioassets-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  token_uri: 'https://oauth2.googleapis.com/token',
};

const message = {
  tokens: ['fcm-token-1'],
  title: 'Offer rejected',
  body: 'Your Dell Latitude offer needs changes',
  data: { linkPath: '/catalogue/abc' },
};

type Reply = { status: number; body?: unknown };

/** Answers the OAuth exchange, then each send in turn from `replies`. */
function fakeGoogle(replies: Reply[] | ((token: string) => Reply)) {
  let n = 0;
  return vi.fn(async (url: string, init: { body: string }) => {
    if (url === account.token_uri) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.x', expires_in: 3600 }) };
    }
    const token = (JSON.parse(init.body) as { message: { token: string } }).message.token;
    const reply = typeof replies === 'function' ? replies(token) : replies[n++]!;
    return {
      ok: reply.status < 300,
      status: reply.status,
      json: async () => reply.body ?? {},
      text: async () => JSON.stringify(reply.body ?? {}),
    };
  });
}

const fcmError = (status: string, errorCode: string, text = 'failed') => ({
  error: {
    status,
    message: text,
    details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode }],
  },
});

afterEach(() => vi.unstubAllGlobals());

describe('sending a push through FCM directly', () => {
  it('signs in with the service account and sends the shape the phone reads', async () => {
    const fetchMock = fakeGoogle([{ status: 200, body: { name: 'projects/x/messages/1' } }]);
    vi.stubGlobal('fetch', fetchMock);

    const result = await new FcmPushProvider(account).send(message);
    expect(result).toEqual({ accepted: 1, simulated: false, invalidTokens: [] });

    // The sign-in assertion is a real RS256 JWT for the messaging scope.
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!;
    expect(tokenUrl).toBe(account.token_uri);
    const assertion = new URLSearchParams(tokenInit.body).get('assertion')!;
    const [header, claims, signature] = assertion.split('.');
    const verified = createVerify('RSA-SHA256')
      .update(`${header}.${claims}`)
      .verify(publicKey, signature!, 'base64url');
    expect(verified).toBe(true);
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toMatchObject({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: account.token_uri,
    });

    const [sendUrl, sendInit] = fetchMock.mock.calls[1]! as unknown as [
      string,
      { body: string; headers: Record<string, string> },
    ];
    expect(sendUrl).toBe('https://fcm.googleapis.com/v1/projects/pioassets-test/messages:send');
    expect(sendInit.headers.authorization).toBe('Bearer ya29.x');
    const sent = JSON.parse(sendInit.body).message;
    // Data-only: a `notification` block would be drawn by Android itself in
    // the background and the tap would arrive without the link.
    expect(sent.notification).toBeUndefined();
    expect(sent).toEqual({
      token: 'fcm-token-1',
      data: {
        title: 'Offer rejected',
        message: 'Your Dell Latitude offer needs changes',
        body: JSON.stringify({ linkPath: '/catalogue/abc' }),
        channelId: 'default',
      },
      android: { priority: 'HIGH' },
    });
    // FCM refuses non-string data values; every one here is a string.
    expect(Object.values(sent.data).every((v) => typeof v === 'string')).toBe(true);
  });

  it('signs in once and reuses the access token across sends', async () => {
    const fetchMock = fakeGoogle(() => ({ status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new FcmPushProvider(account);

    await provider.send({ ...message, tokens: ['a', 'b'] });
    await provider.send(message);

    const signIns = fetchMock.mock.calls.filter(([url]) => url === account.token_uri);
    expect(signIns).toHaveLength(1);
  });

  it('returns tokens FCM says are finished, and keeps the rest', async () => {
    vi.stubGlobal(
      'fetch',
      fakeGoogle((token) =>
        token === 'gone'
          ? { status: 404, body: fcmError('NOT_FOUND', 'UNREGISTERED') }
          : token === 'garbled'
            ? {
                status: 400,
                body: fcmError('INVALID_ARGUMENT', 'INVALID_ARGUMENT', 'The registration token is not a valid FCM registration token'),
              }
            : { status: 200 },
      ),
    );

    const result = await new FcmPushProvider(account).send({
      ...message,
      tokens: ['live', 'gone', 'garbled'],
    });

    expect(result.accepted).toBe(1);
    expect(result.invalidTokens).toEqual(['gone', 'garbled']);
  });

  it('does not prune when the set-up is wrong rather than the phone', async () => {
    // A mismatched sender or a payload FCM dislikes fails every token alike.
    // Revoking them all would silence the whole fleet over one setting.
    vi.stubGlobal(
      'fetch',
      fakeGoogle([
        { status: 403, body: fcmError('PERMISSION_DENIED', 'SENDER_ID_MISMATCH') },
        { status: 400, body: fcmError('INVALID_ARGUMENT', 'INVALID_ARGUMENT', 'Invalid JSON payload') },
      ]),
    );

    const result = await new FcmPushProvider(account).send({ ...message, tokens: ['a', 'b'] });

    expect(result).toEqual({ accepted: 0, simulated: false, invalidTokens: [] });
  });

  it('throws for a retry when nothing got through for a transient reason', async () => {
    vi.stubGlobal('fetch', fakeGoogle([{ status: 503, body: fcmError('UNAVAILABLE', 'UNAVAILABLE') }]));
    await expect(new FcmPushProvider(account).send(message)).rejects.toThrow(/FCM push failed: 503/);
  });

  it('does not throw after a partial success, so a retry cannot double-notify', async () => {
    vi.stubGlobal(
      'fetch',
      fakeGoogle((token) => (token === 'a' ? { status: 200 } : { status: 500 })),
    );
    const result = await new FcmPushProvider(account).send({ ...message, tokens: ['a', 'b'] });
    expect(result.accepted).toBe(1);
    expect(result.invalidTokens).toEqual([]);
  });

  it('discards Expo-issued tokens without calling Google', async () => {
    const fetchMock = fakeGoogle([]);
    vi.stubGlobal('fetch', fetchMock);

    const result = await new FcmPushProvider(account).send({
      ...message,
      tokens: ['ExponentPushToken[abc]'],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.invalidTokens).toEqual(['ExponentPushToken[abc]']);
  });

  it('sends an empty data object when there is no link', async () => {
    const fetchMock = fakeGoogle([{ status: 200 }]);
    vi.stubGlobal('fetch', fetchMock);
    await new FcmPushProvider(account).send({ tokens: ['a'], title: 't', body: 'b' });
    const sent = JSON.parse((fetchMock.mock.calls[1]![1] as { body: string }).body).message;
    expect(sent.data.body).toBe('{}');
  });
});

describe('reading the service account file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fcm-'));

  it('reads a real key file', () => {
    const path = join(dir, 'ok.json');
    writeFileSync(path, JSON.stringify(account));
    expect(readServiceAccount(path).project_id).toBe('pioassets-test');
  });

  it('refuses the Android google-services.json handed over by mistake', () => {
    // The two Firebase downloads are easy to mix up; this one has no key.
    const path = join(dir, 'google-services.json');
    writeFileSync(path, JSON.stringify({ project_info: { project_id: 'x' }, client: [] }));
    expect(() => readServiceAccount(path)).toThrow(/missing "project_id"/);
  });

  it('names the path when the file is not there', () => {
    expect(() => readServiceAccount(join(dir, 'absent.json'))).toThrow(/absent\.json/);
  });
});
