import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from './api-client';

/**
 * v2.80 - the biometric lock holds in the API client, not only on screen: a
 * screen that mounts before the lock screen takes over must not fetch data,
 * and must not refresh the stored session to do it.
 */
function client() {
  const tokenStore = {
    getRefreshToken: vi.fn(async () => 'stored-refresh'),
    setRefreshToken: vi.fn(async () => undefined),
  };
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ data: { url } }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return { api: new ApiClient({ baseUrl: 'https://x.test', tokenStore }), fetchMock, tokenStore };
}

afterEach(() => vi.unstubAllGlobals());

describe('the API client behind the lock', () => {
  it('starts locked and fetches no data, and does not touch the stored session', async () => {
    const { api, fetchMock, tokenStore } = client();
    await expect(api.request('/assets')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(tokenStore.getRefreshToken).not.toHaveBeenCalled();
  });

  it('still lets the sign-in endpoints through, so unlocking and signing in work', async () => {
    const { api, fetchMock } = client();
    await api.request('/auth/me');
    expect(fetchMock).toHaveBeenCalledWith('https://x.test/api/v1/auth/me', expect.anything());
  });

  it('fetches normally once unlocked', async () => {
    const { api, fetchMock } = client();
    api.setLocked(false);
    await expect(api.request('/assets')).resolves.toEqual({ url: 'https://x.test/api/v1/assets' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
