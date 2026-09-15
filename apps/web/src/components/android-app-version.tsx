'use client';

import { useEffect, useState } from 'react';

/**
 * The version of the Android app currently on the download link (v2.58).
 *
 * Read from /downloads/techpioasset.json, which the APK build writes beside the
 * file it publishes - so this can only ever name the version actually there,
 * never one somebody remembered to type. Asked for on every visit (the server
 * sends it no-store), because being out of date is the one thing it must not be.
 *
 * Renders nothing until it knows, and nothing at all where the file is absent -
 * a dev machine, or before the first build writes one - rather than a guess.
 */

export interface AndroidAppManifest {
  version: string;
  versionCode: number;
  publishedAt: string;
}

export function parseAndroidManifest(value: unknown): AndroidAppManifest | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.version !== 'string' || !/^\d+(\.\d+){1,3}$/.test(v.version)) return null;
  if (typeof v.versionCode !== 'number' || typeof v.publishedAt !== 'string') return null;
  if (Number.isNaN(Date.parse(v.publishedAt))) return null;
  return { version: v.version, versionCode: v.versionCode, publishedAt: v.publishedAt };
}

export function describeAndroidManifest(m: AndroidAppManifest): string {
  const date = new Date(m.publishedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `Version ${m.version} · updated ${date}`;
}

export function AndroidAppVersion({ className }: { className?: string }) {
  const [manifest, setManifest] = useState<AndroidAppManifest | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/downloads/techpioasset.json', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: unknown) => {
        if (!cancelled) setManifest(parseAndroidManifest(json));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!manifest) return null;
  return <span className={className}>{describeAndroidManifest(manifest)}</span>;
}
