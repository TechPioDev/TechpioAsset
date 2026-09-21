/**
 * "Update available" (0.3.29).
 *
 * The app ships as a sideloaded APK with no expo-updates, so a phone never
 * learns a newer build exists unless somebody tells its owner. The server
 * already publishes what the web login page reads to label its download link -
 * `/downloads/techpioasset.json` beside `/downloads/techpioasset.apk` - so the
 * app reads the same file and compares build numbers.
 *
 * Everything here is pure or takes its `fetch` as an argument, so it runs in
 * vitest without the React Native runtime. The banner that shows the result is
 * `src/components/update-banner.tsx`.
 *
 * The rule for every failure - offline, a timeout, a proxy's HTML error page,
 * a manifest missing a field - is silence. A nag about updating that itself
 * errors is worse than no nag.
 */

export interface UpdateManifest {
  /** The human version, e.g. "0.3.28". Shown, never compared. */
  version: string;
  /** Android's build number. The only thing compared: it always goes up. */
  versionCode: number;
  /** APK size, when the server states it. */
  sizeBytes: number | null;
  publishedAt: string | null;
}

const MANIFEST_PATH = '/downloads/techpioasset.json';
const APK_PATH = '/downloads/techpioasset.apk';

/** Short, because this runs beside the Home screen's own loading and must never be felt. */
export const UPDATE_CHECK_TIMEOUT_MS = 6000;

/**
 * The scheme-and-host part of the configured API address.
 *
 * `/downloads/` is served from the root of the host, not under `/api/v1`, and
 * the configured address may one day carry a path or a trailing slash. Taken
 * apart by pattern rather than `new URL()`: React Native's URL leaves `origin`
 * and `host` unimplemented, and throws when they are read.
 */
export function originOf(apiUrl: string): string | null {
  const match = /^(https?:\/\/[^/?#\s]+)/i.exec(apiUrl.trim());
  return match ? match[1]! : null;
}

/**
 * Where the manifest and the APK live, from the API address this build was
 * configured with - so a build pointed at piotask.com or a staging host asks
 * that host, rather than every build asking pioassets.com.
 */
export function manifestUrl(apiUrl: string): string | null {
  const origin = originOf(apiUrl);
  return origin ? `${origin}${MANIFEST_PATH}` : null;
}

export function apkUrl(apiUrl: string): string | null {
  const origin = originOf(apiUrl);
  return origin ? `${origin}${APK_PATH}` : null;
}

/**
 * The manifest, or null when it is not one. Strict about the two fields the
 * decision rests on and forgiving about the rest: a manifest without a size
 * still makes a useful banner, one without a build number makes none.
 */
export function parseUpdateManifest(raw: unknown): UpdateManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const version = typeof data.version === 'string' ? data.version.trim() : '';
  const versionCode = data.versionCode;
  if (!version) return null;
  if (typeof versionCode !== 'number' || !Number.isInteger(versionCode) || versionCode <= 0) {
    return null;
  }
  const size = data.sizeBytes;
  return {
    version,
    versionCode,
    sizeBytes: typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : null,
    publishedAt: typeof data.publishedAt === 'string' ? data.publishedAt : null,
  };
}

/**
 * Is the published build newer than the one installed?
 *
 * An unknown installed build answers no. A dev client or the browser build has
 * no Android build number, and telling those to "update" to the production APK
 * would be wrong every time.
 */
export function isNewerBuild(
  manifest: UpdateManifest,
  installedVersionCode: number | null | undefined,
): boolean {
  if (typeof installedVersionCode !== 'number' || !Number.isFinite(installedVersionCode)) {
    return false;
  }
  return manifest.versionCode > installedVersionCode;
}

/** "54 MB". Whole megabytes: nobody decides whether to update on the decimals. */
export function formatApkSize(sizeBytes: number | null | undefined): string | null {
  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return null;
  const mb = sizeBytes / (1024 * 1024);
  return mb < 1 ? 'under 1 MB' : `${Math.round(mb)} MB`;
}

/** The banner's one line: "Update available — version 0.3.29 (54 MB)". */
export function updateBannerText(manifest: UpdateManifest): string {
  const size = formatApkSize(manifest.sizeBytes);
  return `Update available — version ${manifest.version}${size ? ` (${size})` : ''}`;
}

type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/**
 * Fetches the manifest and answers with it only when it is newer than the
 * installed build. Null for everything else, failures included.
 *
 * No sign-in header is sent: the file is public, and it is fetched with the
 * bare `fetch` rather than the API client so a 401 here can never be mistaken
 * for an expired session and sign the person out.
 */
export async function checkForUpdate(options: {
  apiUrl: string;
  installedVersionCode: number | null | undefined;
  fetchImpl: FetchLike;
  timeoutMs?: number;
}): Promise<UpdateManifest | null> {
  const url = manifestUrl(options.apiUrl);
  if (!url) return null;
  // Nothing to compare with, so do not spend the request.
  if (typeof options.installedVersionCode !== 'number') return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? UPDATE_CHECK_TIMEOUT_MS);
  try {
    const response = await options.fetchImpl(url, {
      signal: controller.signal,
      // A cached manifest would hide a new build for as long as the cache lives.
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!response.ok) return null;
    const manifest = parseUpdateManifest(await response.json());
    if (!manifest) return null;
    return isNewerBuild(manifest, options.installedVersionCode) ? manifest : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Once per app session (0.3.29).
 *
 * Home regains focus every time somebody comes back to it, and asking the
 * server on each of those would be traffic for nothing. Module state rather
 * than storage on purpose: "Later" is meant to last until the app is next
 * opened, and a module lives exactly that long.
 */
export interface UpdateSession {
  /** True the first time only. */
  claimCheck(): boolean;
  /** What the check found, kept so Home shows it again after a tab switch. */
  found: UpdateManifest | null;
  /** "Later" was pressed. */
  dismissed: boolean;
}

export function createUpdateSession(): UpdateSession {
  let checked = false;
  return {
    claimCheck() {
      if (checked) return false;
      checked = true;
      return true;
    },
    found: null,
    dismissed: false,
  };
}
