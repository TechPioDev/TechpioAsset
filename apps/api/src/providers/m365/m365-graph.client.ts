import { Injectable } from '@nestjs/common';
import type { GraphCompanySubscription, GraphSubscribedSku } from '@techpioasset/domain';

/**
 * Reads a tenant's Microsoft 365 subscriptions from Microsoft Graph (v3.12).
 *
 * Deliberately thin: it fetches the two lists and says clearly why it could
 * not. What the lists MEAN - which rows are licences, which date matters - is
 * decided in packages/domain/src/m365-licenses.ts, where it can be tested
 * without a tenant.
 *
 * HONEST LIMIT: written against the documented Graph v1.0 API. The sign-in
 * REFUSAL path has run against Microsoft's live service (a made-up tenant,
 * 8 Oct 2026) and reads as intended. A successful read has not: there is no
 * live tenant in this environment, so the two list calls are exercised only
 * through a fake. The first real sync is the first real test of those, which
 * is why every failure is reported in words a person can act on and nothing
 * is ever written from a partial read.
 */

export interface M365Credentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface M365SubscriptionData {
  skus: GraphSubscribedSku[];
  subscriptions: GraphCompanySubscription[];
}

/** A failure the person who set up the connection can do something about. */
export class M365ConnectionError extends Error {
  constructor(
    message: string,
    /** What kind of fix it needs, so the screen can say where to look. */
    readonly kind: 'credentials' | 'permission' | 'unreachable' | 'unexpected',
  ) {
    super(message);
    this.name = 'M365ConnectionError';
  }
}

export abstract class M365GraphClient {
  abstract fetchSubscriptions(credentials: M365Credentials): Promise<M365SubscriptionData>;
}

const GRAPH = 'https://graph.microsoft.com/v1.0';

@Injectable()
export class HttpM365GraphClient extends M365GraphClient {
  async fetchSubscriptions(credentials: M365Credentials): Promise<M365SubscriptionData> {
    const token = await this.acquireToken(credentials);
    // Both lists, or neither. A sync from one list alone would record seats
    // with no renewal dates and look like a successful read.
    const [skus, subscriptions] = await Promise.all([
      this.readAll<GraphSubscribedSku>(`${GRAPH}/subscribedSkus`, token),
      this.readAll<GraphCompanySubscription>(`${GRAPH}/directory/subscriptions`, token),
    ]);
    return { skus, subscriptions };
  }

  private async acquireToken({ tenantId, clientId, clientSecret }: M365Credentials) {
    let res: Response;
    try {
      res = await fetch(
        `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            scope: 'https://graph.microsoft.com/.default',
          }),
        },
      );
    } catch {
      throw new M365ConnectionError(
        'Could not reach Microsoft to sign in. Check the server has internet access and try again.',
        'unreachable',
      );
    }

    if (!res.ok) {
      // Entra explains itself in `error_description`; the first sentence is the
      // useful part and the rest is trace ids nobody reading a settings screen
      // can use. The secret is never echoed back by Microsoft, so quoting this
      // cannot leak it.
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        error_description?: string;
      };
      // Seen against the live service: the description arrives as ONE line
      // with "Trace ID: ... Correlation ID: ... Timestamp: ..." run on to the
      // end of it, so cutting at the first line break kept all of it.
      const detail = (body.error_description ?? '')
        .split(/\r?\n/)[0]!
        .split(/\s*Trace ID:/i)[0]!
        .trim();
      const hint =
        body.error === 'invalid_client'
          ? 'The client secret is wrong or has expired.'
          : body.error === 'unauthorized_client' || body.error === 'invalid_request'
            ? 'The tenant ID or client ID does not match an app registration.'
            : 'Microsoft refused the sign-in.';
      throw new M365ConnectionError(
        detail ? `${hint} Microsoft said: ${detail}` : hint,
        'credentials',
      );
    }

    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) {
      throw new M365ConnectionError('Microsoft signed in but returned no token.', 'unexpected');
    }
    return body.access_token;
  }

  /** Follows @odata.nextLink to the end, so a large tenant is read whole. */
  private async readAll<T>(firstUrl: string, token: string): Promise<T[]> {
    const rows: T[] = [];
    let url: string | undefined = firstUrl;
    // A guard, not a limit anyone should meet: a tenant has tens of
    // subscriptions, and a nextLink that loops must not spin forever.
    for (let page = 0; url && page < 50; page += 1) {
      let res: Response;
      try {
        res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      } catch {
        throw new M365ConnectionError(
          'Signed in, but could not reach Microsoft Graph to read the subscriptions.',
          'unreachable',
        );
      }
      if (res.status === 401 || res.status === 403) {
        throw new M365ConnectionError(
          'Signed in, but the app registration is not allowed to read subscriptions. ' +
            'Add the application permission Organization.Read.All in Microsoft Entra and grant admin consent.',
          'permission',
        );
      }
      if (!res.ok) {
        throw new M365ConnectionError(
          `Microsoft Graph answered ${res.status} when reading the subscriptions.`,
          'unexpected',
        );
      }
      const body = (await res.json()) as { value?: T[]; '@odata.nextLink'?: string };
      rows.push(...(body.value ?? []));
      url = body['@odata.nextLink'];
    }
    return rows;
  }
}
