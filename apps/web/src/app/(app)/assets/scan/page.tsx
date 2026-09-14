'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Camera, CameraOff, ScanLine } from 'lucide-react';
import { apiFetch, apiFetchPage, ApiError } from '@/lib/api-client';
import { parseScanValue } from '@/lib/qr';
import { useAuth } from '@/providers/auth-provider';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { Button, Card, Field, Input } from '@/components/ui';

/**
 * Scan an asset's QR label with the laptop or phone-browser camera.
 *
 * The phone app has had this since spec section 15; the web only had the page a
 * label's address lands on (/assets/scan/[token]). This is the other half: point
 * the camera at the label and open the device.
 *
 * Resolution is the mobile scanner's, unchanged: the label encodes an address,
 * `parseScanValue` takes the token out of it, and `/assets/by-qr/:token` - which
 * honours permission and scope - turns it into the asset. A code for somebody
 * else's device misses here exactly as it does on the phone.
 *
 * Decoding uses the browser's own BarcodeDetector, so there is no library to
 * ship. Chrome, Edge and Android have it; Firefox and desktop Safari do not, and
 * for those the page says so plainly and offers the typed box instead - which is
 * also the way in for anyone reading the asset tag off the label.
 */

// BarcodeDetector is not in TypeScript's DOM lib yet; this is the slice used.
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

type CameraState =
  | 'checking'
  | 'unsupported'
  | 'starting'
  | 'scanning'
  | 'denied'
  | 'failed';

const SCAN_INTERVAL_MS = 250;

export default function AssetQrScanPage() {
  const router = useRouter();
  const { user } = useAuth();
  // An OWN-scope holder cannot open the /assets list, so "back" and "search"
  // point at their own equipment instead - the same rule the asset page uses.
  const listHref = user?.scope === 'OWN' ? '/my-assets' : '/assets';
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  // One physical scan is reported frame after frame; only the first counts.
  const handling = useRef(false);
  const mounted = useRef(true);
  // Bumped whenever the page lets go of the camera, so a start still waiting on
  // the permission prompt knows its stream is no longer wanted (React's dev
  // double-mount would otherwise leave a second stream running).
  const generation = useRef(0);

  const [camera, setCamera] = useState<CameraState>('checking');
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  const stopCamera = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  /**
   * Turn a read or typed value into an asset id, or a sentence saying why not.
   *
   * A label address can only be a token. Free text is tried as a token first
   * (a hand-made label carries a bare one), then - for typed input only - as an
   * asset tag through the ordinary scoped list, where only an exact tag match
   * counts so a partial string never opens the wrong device.
   */
  const resolve = useCallback(
    async (raw: string, source: 'camera' | 'typed'): Promise<{ id: string } | { error: string }> => {
      const parsed = parseScanValue(raw);
      if (parsed.kind === 'empty') {
        return {
          error:
            source === 'camera'
              ? 'Nothing was read from that code. Try again.'
              : 'Enter an asset tag or paste the QR link.',
        };
      }
      const token = parsed.kind === 'label' ? parsed.token : parsed.value;
      try {
        const asset = await apiFetch<{ id: string }>(`/assets/by-qr/${encodeURIComponent(token)}`);
        return { id: asset.id };
      } catch (caught) {
        if (!(caught instanceof ApiError) || caught.status !== 404) {
          return {
            error:
              caught instanceof ApiError
                ? (caught.problem.detail ?? caught.problem.title)
                : 'Could not look that code up. Check your connection and try again.',
          };
        }
      }
      if (parsed.kind === 'text' && source === 'typed') {
        try {
          const page = await apiFetchPage<{ id: string; assetTag: string }>(
            `/assets?q=${encodeURIComponent(parsed.value)}&pageSize=25`,
          );
          const wanted = parsed.value.toLowerCase();
          const match = page.data.find((a) => a.assetTag.toLowerCase() === wanted);
          if (match) return { id: match.id };
        } catch {
          // Fall through to the not-found sentence: the reader cannot act on
          // the difference, and the token lookup already said "no such code".
        }
        return { error: 'No asset you can access has that tag or code.' };
      }
      return { error: 'That code does not match an asset you can access.' };
    },
    [],
  );

  const onDetected = useCallback(
    async (raw: string) => {
      if (handling.current) return;
      handling.current = true;
      setError(null);
      const result = await resolve(raw, 'camera');
      if (!mounted.current) return;
      if ('id' in result) {
        stopCamera();
        router.push(`/assets/${result.id}`);
        return;
      }
      setError(result.error);
      // Allow another attempt after a short pause, as the phone does.
      setTimeout(() => {
        handling.current = false;
      }, 1500);
    },
    [resolve, router, stopCamera],
  );

  const startCamera = useCallback(async () => {
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setCamera('unsupported');
      return;
    }
    const gen = ++generation.current;
    const alive = () => mounted.current && generation.current === gen;
    setError(null);
    setCamera('starting');
    try {
      if (Detector.getSupportedFormats) {
        const formats = await Detector.getSupportedFormats();
        if (!formats.includes('qr_code')) {
          if (alive()) setCamera('unsupported');
          return;
        }
      }
      detectorRef.current = new Detector({ formats: ['qr_code'] });
      const stream = await navigator.mediaDevices.getUserMedia({
        // The rear camera on a phone; a laptop simply has the one.
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      if (!alive()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stopCamera();
        return;
      }
      video.srcObject = stream;
      await video.play();
      if (!alive()) return;
      handling.current = false;
      setCamera('scanning');
      timerRef.current = setInterval(() => {
        const v = videoRef.current;
        const detector = detectorRef.current;
        if (!v || !detector || handling.current || v.readyState < 2) return;
        detector
          .detect(v)
          .then((codes) => {
            const first = codes.find((c) => c.rawValue);
            if (first) void onDetected(first.rawValue);
          })
          .catch(() => {
            // A single frame failing to decode is normal; keep scanning.
          });
      }, SCAN_INTERVAL_MS);
    } catch (caught) {
      // A superseded start must not tear down the stream that replaced it.
      if (!alive()) return;
      stopCamera();
      const name = (caught as { name?: string } | null)?.name;
      setCamera(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'failed');
    }
  }, [onDetected, stopCamera]);

  // Start once on arrival; always release the camera on the way out, or the
  // light stays on after the page is gone.
  useEffect(() => {
    mounted.current = true;
    void startCamera();
    return () => {
      mounted.current = false;
      generation.current += 1;
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  async function submitManual(event: React.FormEvent) {
    event.preventDefault();
    setManualError(null);
    setResolving(true);
    const result = await resolve(manual, 'typed');
    if (!mounted.current) return;
    setResolving(false);
    if ('id' in result) {
      stopCamera();
      router.push(`/assets/${result.id}`);
    } else {
      setManualError(result.error);
    }
  }

  const showVideo = camera === 'starting' || camera === 'scanning';

  return (
    <div className="mx-auto grid max-w-xl gap-4">
      <div>
        <Breadcrumbs
          items={[
            { label: listHref === '/assets' ? 'Assets' : 'My assets', href: listHref },
            { label: 'Scan QR' },
          ]}
        />
        <h1 className="mt-2 text-xl font-semibold tracking-tight">Scan QR</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Hold the asset’s QR label up to the camera to open the device.
        </p>
      </div>

      <Card className="grid gap-3 p-4">
        {/* The video element is always mounted so the stream has somewhere to
            attach the moment permission is granted. */}
        <div
          className={`relative overflow-hidden rounded-[var(--radius-control)] bg-black ${showVideo ? '' : 'hidden'}`}
        >
          <video
            ref={videoRef}
            className="aspect-[4/3] w-full object-cover"
            muted
            playsInline
            aria-label="Camera preview"
          />
          <ScanLine
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 size-40 -translate-x-1/2 -translate-y-1/2 text-white/60"
          />
          {camera === 'starting' ? (
            <p className="absolute inset-x-0 bottom-3 text-center text-sm text-white">
              Starting camera…
            </p>
          ) : null}
        </div>

        {camera === 'scanning' ? (
          <p className="text-sm text-[var(--color-content-muted)]" aria-live="polite">
            Looking for a QR code…
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-[var(--tone-critical-fg)]">
            {error}
          </p>
        ) : null}

        {camera === 'checking' ? (
          <p className="text-sm text-[var(--color-content-muted)]">Checking for a camera…</p>
        ) : null}

        {camera === 'unsupported' ? (
          <Notice
            title="This browser cannot read QR codes from the camera"
            body="Camera scanning works in Chrome and Edge, and in Chrome on Android. In this browser, type the asset tag or paste the QR link below instead."
          />
        ) : null}

        {camera === 'denied' ? (
          <>
            <Notice
              title="Camera access was blocked"
              body="Allow camera access for this site in the browser’s address bar, then try again - or type the asset tag below."
            />
            <Button variant="secondary" className="w-fit" onClick={() => void startCamera()}>
              <Camera aria-hidden="true" className="mr-1.5 size-4" />
              Try again
            </Button>
          </>
        ) : null}

        {camera === 'failed' ? (
          <>
            <Notice
              title="The camera could not be started"
              body="No camera was found, or another app is using it. You can try again, or type the asset tag below."
            />
            <Button variant="secondary" className="w-fit" onClick={() => void startCamera()}>
              <Camera aria-hidden="true" className="mr-1.5 size-4" />
              Try again
            </Button>
          </>
        ) : null}
      </Card>

      <Card className="p-4">
        <form onSubmit={submitManual} className="grid gap-3">
          <Field
            label="Asset tag or QR link"
            htmlFor="scan-manual"
            hint="The tag printed beside the code, or the link a phone camera shows for it."
            error={manualError ?? undefined}
          >
            <Input
              id="scan-manual"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="e.g. MOH-LAP-0042"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={resolving}>
              Open asset
            </Button>
            <Link href={listHref} className="text-sm text-[var(--color-brand)] hover:underline">
              Search assets instead
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="flex gap-2.5 rounded-[var(--radius-control)] border px-3 py-2.5"
      style={{
        color: 'var(--tone-warning-fg)',
        backgroundColor: 'var(--tone-warning-bg)',
        borderColor: 'var(--tone-warning-border)',
      }}
    >
      <CameraOff aria-hidden="true" className="mt-0.5 size-4 flex-none" />
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs">{body}</p>
      </div>
    </div>
  );
}
