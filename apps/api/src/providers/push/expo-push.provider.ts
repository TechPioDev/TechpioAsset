import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../config/config.module.js';
import { PushProvider, type PushMessage, type PushResult } from './push.provider.js';

/**
 * Expo push delivery (spec section 1).
 *
 * Sends through Expo's push service, which fans out to FCM on Android and APNs
 * on iOS. Two things about that service shape this implementation:
 *
 *  - It accepts at most 100 messages per request, so tokens are chunked.
 *  - It answers with a *ticket* per message, in request order. A ticket says
 *    the message was accepted for delivery, not that it arrived; final delivery
 *    is reported later through receipts.
 *
 * Receipts are deliberately NOT polled here, despite being the obvious place
 * for it. Expo does not have them ready for several minutes, so an inline poll
 * would block the queue job to almost always read "not ready yet" - the loop
 * would cost real time and teach us nothing. Tickets already carry
 * DeviceNotRegistered for tokens the push services have dropped, which is the
 * case worth acting on, and acting on it here keeps dead tokens from being
 * retried nightly. The residual gap is a token that only fails at receipt time;
 * it stays until its next send fails at ticket level.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo rejects a request carrying more than this many messages. */
const MAX_PER_REQUEST = 100;
/** Both spellings are issued by Expo; anything else is not a push token. */
const TOKEN_SHAPE = /^Expo(nent)?PushToken\[[^\]]+\]$/;

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

@Injectable()
export class ExpoPushProvider extends PushProvider {
  readonly name = 'expo';
  private readonly logger = new Logger(ExpoPushProvider.name);
  private readonly accessToken: string | undefined;

  constructor(config: AppConfig) {
    super();
    this.accessToken = config.get('EXPO_ACCESS_TOKEN');
  }

  async send(message: PushMessage): Promise<PushResult> {
    // A malformed token would be rejected per-message rather than failing the
    // batch, but it can never succeed, so it is reported as invalid up front and
    // pruned like any other dead token instead of being retried forever.
    const invalidTokens: string[] = [];
    const deliverable: string[] = [];
    for (const token of message.tokens) {
      (TOKEN_SHAPE.test(token) ? deliverable : invalidTokens).push(token);
    }
    if (invalidTokens.length > 0) {
      this.logger.warn(`Discarding ${invalidTokens.length} token(s) that are not Expo push tokens`);
    }
    if (deliverable.length === 0) {
      return { accepted: 0, simulated: false, invalidTokens };
    }

    let accepted = 0;
    for (const batch of chunk(deliverable, MAX_PER_REQUEST)) {
      const tickets = await this.postBatch(batch, message);

      // Tickets come back positionally. If the count does not match, the
      // mapping from ticket to token is guesswork - and guessing here would
      // revoke a live device's token, silencing it for good. Count what was
      // accepted and prune nothing.
      if (tickets.length !== batch.length) {
        this.logger.error(
          `Expo returned ${tickets.length} tickets for ${batch.length} messages; ` +
            'skipping token pruning for this batch',
        );
        accepted += tickets.filter((t) => t.status === 'ok').length;
        continue;
      }

      tickets.forEach((ticket, index) => {
        if (ticket.status === 'ok') {
          accepted += 1;
          return;
        }
        const reason = ticket.details?.error;
        if (reason === 'DeviceNotRegistered') {
          // The app was uninstalled, or the token was reissued. Expected.
          invalidTokens.push(batch[index]!);
          return;
        }
        // Everything else is an operator problem, not a device one, so it is
        // named rather than folded into a count. InvalidCredentials in
        // particular means the FCM key on the Expo project is missing or wrong,
        // and no device will ever receive anything until that is fixed.
        this.logger.error(
          `Expo rejected a push (${reason ?? 'unknown'}): ${ticket.message ?? 'no message'}`,
        );
      });
    }

    return { accepted, simulated: false, invalidTokens };
  }

  private async postBatch(tokens: string[], message: PushMessage): Promise<ExpoTicket[]> {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify(
        tokens.map((to) => ({
          to,
          title: message.title,
          body: message.body,
          ...(message.data ? { data: message.data } : {}),
          ...(message.categoryId ? { categoryId: message.categoryId } : {}),
        })),
      ),
    });

    if (!response.ok) {
      // Thrown, not swallowed: the queue job should fail and retry rather than
      // report a delivery that never left the building.
      const detail = await response.text().catch(() => '');
      throw new Error(`Expo push failed: ${response.status} ${detail.slice(0, 200)}`);
    }

    const payload = (await response.json()) as { data?: ExpoTicket[] };
    return payload.data ?? [];
  }
}
