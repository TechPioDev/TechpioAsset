import { Logger } from '@nestjs/common';
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PushProvider, type PushMessage, type PushResult } from './push.provider.js';

/**
 * Firebase Cloud Messaging delivery, sent directly (v2.56).
 *
 * The Expo provider was the original route, and it never delivered anything in
 * production: a standalone Android build cannot get an Expo push token without
 * an FCM key uploaded to an Expo account, and that account's access token was
 * never on the server either. Going straight to FCM needs Firebase alone, and
 * the one secret - a service-account key - stays on our own server instead of
 * being handed to a second company.
 *
 * The message is data-only, in the shape the app's notification library reads:
 * `title`, `message`, and `body` as a JSON string that becomes the notification's
 * data on the phone. That is also the shape Expo's own service sends, and it is
 * what makes a tap carry the link through. A message with a `notification`
 * block would instead be drawn by Android itself while the app is in the
 * background, bypassing the library - and the tap would arrive with no link.
 *
 * Checked against expo-notifications 0.29 source (NotificationData.kt,
 * RemoteNotificationContent.kt, FirebaseNotificationTrigger.kt), not recalled.
 */

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
/** Must exist on the phone, or Android 8+ files the alert under a fallback. */
export const ANDROID_CHANNEL_ID = 'default';
/** Expo-issued tokens cannot be delivered by FCM directly. */
const EXPO_TOKEN_SHAPE = /^Expo(nent)?PushToken\[[^\]]+\]$/;

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri: string;
}

interface FcmError {
  error?: {
    status?: string;
    message?: string;
    details?: { '@type'?: string; errorCode?: string }[];
  };
}

/** Reads and checks the key once, so a bad file stops the API at boot, loudly. */
export function readServiceAccount(path: string): ServiceAccount {
  let parsed: Partial<ServiceAccount>;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ServiceAccount>;
  } catch (error) {
    throw new Error(
      `FCM_SERVICE_ACCOUNT_FILE could not be read as JSON (${path}): ${(error as Error).message}`,
    );
  }
  for (const key of ['project_id', 'client_email', 'private_key'] as const) {
    if (!parsed[key]) {
      throw new Error(`FCM service account file is missing "${key}" - is it the right file?`);
    }
  }
  return { token_uri: 'https://oauth2.googleapis.com/token', ...parsed } as ServiceAccount;
}

const base64url = (value: string) => Buffer.from(value).toString('base64url');

export class FcmPushProvider extends PushProvider {
  readonly name = 'fcm';
  private readonly logger = new Logger(FcmPushProvider.name);
  private accessToken: { value: string; expiresAt: number } | null = null;
  private signingIn: Promise<string> | null = null;

  constructor(private readonly account: ServiceAccount) {
    super();
  }

  async send(message: PushMessage): Promise<PushResult> {
    const invalidTokens: string[] = [];
    const deliverable: string[] = [];
    for (const token of message.tokens) {
      (EXPO_TOKEN_SHAPE.test(token) ? invalidTokens : deliverable).push(token);
    }
    if (invalidTokens.length > 0) {
      this.logger.warn(`Discarding ${invalidTokens.length} Expo token(s) FCM cannot deliver to`);
    }
    if (deliverable.length === 0) return { accepted: 0, simulated: false, invalidTokens };

    const outcomes = await Promise.all(deliverable.map((token) => this.sendOne(token, message)));

    let accepted = 0;
    let transient: Error | null = null;
    for (const [index, outcome] of outcomes.entries()) {
      if (outcome === 'ok') accepted += 1;
      else if (outcome === 'dead') invalidTokens.push(deliverable[index]!);
      else if (outcome instanceof Error) transient = outcome;
    }

    // Retry only when nothing got through. Throwing after a partial success
    // would make the queue resend to the phones that already have the alert.
    if (transient && accepted === 0) throw transient;
    return { accepted, simulated: false, invalidTokens };
  }

  /** 'ok', 'dead' (prune the token), 'rejected' (logged, kept), or a retryable Error. */
  private async sendOne(
    token: string,
    message: PushMessage,
  ): Promise<'ok' | 'dead' | 'rejected' | Error> {
    const url = `https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.token()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token,
            data: {
              title: message.title,
              message: message.body,
              body: JSON.stringify(message.data ?? {}),
              channelId: ANDROID_CHANNEL_ID,
            },
            // Without high priority a data message waits for the phone to wake
            // on its own schedule, which on a dozing handset can be hours.
            android: { priority: 'HIGH' },
          },
        }),
      });
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }

    if (response.ok) return 'ok';

    const detail = (await response.json().catch(() => ({}))) as FcmError;
    const code = detail.error?.details?.find((d) => d.errorCode)?.errorCode;
    const text = detail.error?.message ?? '';

    // Pruning silences a real person's phone for good, so only the answers that
    // unambiguously mean "this token is finished" count. INVALID_ARGUMENT is
    // also what a malformed payload gets, so it needs the message to name the
    // token before it is treated as one.
    if (code === 'UNREGISTERED' || response.status === 404) return 'dead';
    if (code === 'INVALID_ARGUMENT' && /registration token/i.test(text)) return 'dead';

    if (response.status === 401) this.accessToken = null;
    if (response.status === 401 || response.status === 429 || response.status >= 500) {
      return new Error(`FCM push failed: ${response.status} ${code ?? ''} ${text.slice(0, 200)}`);
    }

    // SENDER_ID_MISMATCH, THIRD_PARTY_AUTH_ERROR, a 403: the Firebase set-up is
    // wrong, not the phone. Named in the log, and the token is kept, because
    // it will work once the set-up is fixed.
    this.logger.error(`FCM rejected a push (${response.status} ${code ?? 'unknown'}): ${text}`);
    return 'rejected';
  }

  /**
   * An OAuth access token from the service account, reused until near expiry.
   * Sends to several phones run at once, so a sign-in already under way is
   * shared rather than started again by each of them.
   */
  private token(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.accessToken && this.accessToken.expiresAt - 60 > now) {
      return Promise.resolve(this.accessToken.value);
    }
    this.signingIn ??= this.signIn(now).finally(() => {
      this.signingIn = null;
    });
    return this.signingIn;
  }

  private async signIn(now: number): Promise<string> {
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(
      JSON.stringify({
        iss: this.account.client_email,
        scope: SCOPE,
        aud: this.account.token_uri,
        iat: now,
        exp: now + 3600,
      }),
    );
    const signature = createSign('RSA-SHA256')
      .update(`${header}.${claims}`)
      .sign(this.account.private_key, 'base64url');

    const response = await fetch(this.account.token_uri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${header}.${claims}.${signature}`,
      }).toString(),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`FCM sign-in failed: ${response.status} ${detail.slice(0, 200)}`);
    }
    const payload = (await response.json()) as { access_token: string; expires_in: number };
    this.accessToken = { value: payload.access_token, expiresAt: now + payload.expires_in };
    return payload.access_token;
  }
}
