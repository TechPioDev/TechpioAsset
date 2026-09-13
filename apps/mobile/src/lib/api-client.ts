import type { ProblemDetails } from '@techpioasset/contracts';

/**
 * Mobile API client.
 *
 * Mirrors the web client's contract — in-memory access token, refresh on 401,
 * problem+json errors — but tokens persist through expo-secure-store rather than
 * an httpOnly cookie, because a native app has no cookie jar. SecureStore keeps
 * the refresh token in the platform keychain/keystore, not in plain
 * AsyncStorage.
 *
 * The token store is injected so this module stays free of the React Native
 * runtime and can be exercised in tests.
 */

export interface TokenStore {
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(token: string | null): Promise<void>;
}

export class ApiError extends Error {
  constructor(
    readonly problem: ProblemDetails | null,
    readonly status: number,
  ) {
    super(problem?.detail ?? problem?.title ?? `Request failed (${status})`);
    this.name = 'ApiError';
  }

  get code(): string | undefined {
    return this.problem?.code;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  tokenStore: TokenStore;
  /** Called when the session cannot be refreshed, so the app can route to login. */
  onUnauthenticated?: () => void;
}

export class ApiClient {
  private accessToken: string | null = null;
  private refreshInFlight: Promise<boolean> | null = null;

  constructor(private readonly options: ApiClientOptions) {}

  private get base(): string {
    return `${this.options.baseUrl}/api/v1`;
  }

  /**
   * The full address of an API path, for handing to something outside the app
   * - the system browser opening a signed download link. Everything else goes
   * through request(), which adds the sign-in header this cannot.
   */
  absoluteUrl(path: string): string {
    return `${this.base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  /**
   * A source for React Native's <Image> that carries the bearer token (v2.33).
   *
   * Condition photos sit behind the same auth as everything else, so a bare uri
   * renders a broken image. RN's Image takes headers directly, which is the one
   * place mobile has it easier than the web - there the bytes have to be
   * fetched and turned into an object URL.
   *
   * The token is read at call time rather than captured, so a source built
   * before a refresh still carries the current one.
   */
  imageSource(path: string): { uri: string; headers: Record<string, string> } {
    return {
      uri: `${this.base}${path}`,
      headers: this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {},
    };
  }

  /**
   * Refreshes the session using the stored refresh token, de-duplicating
   * concurrent attempts so a screen firing several requests at once does not
   * present the rotated token more than once (which the server would treat as
   * replay and revoke the whole family).
   */
  private async refresh(): Promise<boolean> {
    this.refreshInFlight ??= (async () => {
      try {
        const stored = await this.options.tokenStore.getRefreshToken();
        if (!stored) return false;
        const response = await fetch(`${this.base}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Refresh-Token': stored },
        });
        if (!response.ok) return false;
        const payload = (await response.json()) as {
          data: { accessToken: string };
        };
        this.accessToken = payload.data.accessToken;
        const rotated = response.headers.get('X-Refresh-Token');
        if (rotated) await this.options.tokenStore.setRefreshToken(rotated);
        return true;
      } catch {
        return false;
      } finally {
        queueMicrotask(() => {
          this.refreshInFlight = null;
        });
      }
    })();
    return this.refreshInFlight;
  }

  async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      /** Multipart body for file uploads; Content-Type is left unset so the
       * runtime writes the correct boundary. */
      formData?: FormData;
      skipRefresh?: boolean;
      /**
       * Send the stored refresh token, identifying which session is this one.
       * Only for the two endpoints that need it - listing sessions, and signing
       * the others out - because it is a long-lived credential and has no
       * business travelling with every request.
       */
      identifySession?: boolean;
    } = {},
  ): Promise<T> {
    const sessionToken = options.identifySession ? await this.options.tokenStore.getRefreshToken() : null;
    const response = await fetch(`${this.base}${path}`, {
      method: options.method ?? (options.formData ? 'POST' : 'GET'),
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
        ...(sessionToken ? { 'X-Refresh-Token': sessionToken } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.formData ? { body: options.formData } : {}),
    });

    if (response.status === 401 && !options.skipRefresh) {
      if (await this.refresh()) {
        return this.request<T>(path, { ...options, skipRefresh: true });
      }
      this.accessToken = null;
      this.options.onUnauthenticated?.();
    }

    if (!response.ok) {
      const problem = (await response.json().catch(() => null)) as ProblemDetails | null;
      throw new ApiError(problem, response.status);
    }

    if (response.status === 204) return undefined as T;
    const payload = (await response.json()) as { data: T };
    return payload.data;
  }
}
