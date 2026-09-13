/**
 * Push notification delivery behind a provider interface (spec sections 1, 28).
 *
 * Like every external dependency, push is abstracted so the mock (which records
 * instead of sending) and the real Expo implementation share one contract. A
 * simulated send is flagged and never presented as a real one.
 */

export interface PushMessage {
  /** Push tokens for the recipient's registered devices. */
  tokens: string[];
  title: string;
  body: string;
  /** Deep-link path the app opens on tap. */
  data?: Record<string, string>;
}

export interface PushResult {
  accepted: number;
  simulated: boolean;
  /** Tokens the provider reported as invalid, so they can be pruned. */
  invalidTokens: string[];
}

export abstract class PushProvider {
  abstract readonly name: string;
  abstract send(message: PushMessage): Promise<PushResult>;
}
