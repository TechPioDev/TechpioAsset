import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { api, auth, createTestApp, login, type Session } from './harness.js';

/**
 * v2.10 S5 — what a big export costs in memory.
 *
 * The acceptance criterion is deliberately not "it did not crash once". A
 * 100,000-row export that happens to fit today crashes on the tenant that is
 * 20% larger, and nobody learns anything from the run that survived. So this
 * samples the heap while the export runs and records the high-water mark.
 *
 * The download is consumed with a raw HTTP client that COUNTS bytes and throws
 * them away. supertest buffers the whole body into `res.text`, which in an
 * in-process test lands in the very heap being measured — so the first version
 * of this was partly measuring its own client. The figure below is the server's
 * cost.
 *
 * Manual lane — see `vitest.perf.config.ts`. Needs the load tenant.
 */

let app: INestApplication;
let rig: Session;
let port: number;

/**
 * Fetch a URL and discard the body, returning only its size. Nothing about the
 * payload is retained, so what the sampler sees is the server's memory.
 */
function drain(path: string, token: string): Promise<{ status: number; bytes: number; rows: number }> {
  return new Promise((resolve, reject) => {
    http
      .get({ port, path, headers: { Authorization: `Bearer ${token}` } }, (res) => {
        let bytes = 0;
        let rows = 0;
        let tail = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          bytes += Buffer.byteLength(chunk);
          // Count line breaks as they pass; never hold the document.
          const text = tail + chunk;
          rows += (text.match(/\r\n/g) ?? []).length;
          tail = text.slice(-1);
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, bytes, rows }));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

const RIG_EMAIL = 'load1@load.invalid';

beforeAll(async () => {
  app = await createTestApp();
  rig = await login(app, RIG_EMAIL);
  // A real socket, so the response actually leaves the process rather than
  // being assembled in it. The harness already listens, so take the port it
  // bound - calling listen again on a listening server throws.
  port = (app.getHttpServer().address() as AddressInfo).port;
});

afterAll(async () => {
  await app?.close();
});

/**
 * Peak RETAINED heap while `fn` runs.
 *
 * Each sample forces a collection first. Without that, the figure is dominated
 * by garbage the collector had not got to yet: identical runs of the same export
 * reported 86 MB and 108 MB, which says nothing about whether anything is being
 * held. Forcing GC turns "what did we allocate" into "what are we still
 * holding", which is the question.
 */
async function peakHeapDuringMb<T>(fn: () => Promise<T>): Promise<{ result: T; peakMb: number; ms: number }> {
  if (!global.gc) throw new Error('run this lane with --expose-gc (see vitest.perf.config.ts)');
  global.gc();
  const start = process.memoryUsage().heapUsed;
  let peak = start;
  const sampler = setInterval(() => {
    global.gc?.();
    const used = process.memoryUsage().heapUsed;
    if (used > peak) peak = used;
  }, 100);
  const began = Date.now();
  try {
    const result = await fn();
    return { result, peakMb: (peak - start) / 1024 / 1024, ms: Date.now() - began };
  } finally {
    clearInterval(sampler);
  }
}

describe('exporting a large report', () => {
  it('streams a large CSV while the buffered path holds the whole thing', async () => {
    const assets = await api(app).get('/api/v1/assets?pageSize=1').set(auth(rig));
    const total = assets.body.meta.page.totalItems as number;
    // Only a sanity check that the rig is present. The threshold is deliberately
    // low: the export is measured at more than one tenant size, because
    // "bounded" means the memory does NOT grow with the row count.
    expect(total, 'the load tenant must be generated first').toBeGreaterThan(10_000);

    // The A/B. Same rows, same data, same process, same metric:
    //   CSV  -> the streamed path, one page held at a time
    //   JSON -> `build()`, which still assembles every row before responding
    // JSON is not a regression left behind; it is the screen's own payload and
    // it is what streaming is being compared against.
    const buffered = await peakHeapDuringMb(() =>
      drain('/api/v1/reports?type=ASSET_INVENTORY&format=JSON', rig.token),
    );
    const { result, peakMb, ms } = await peakHeapDuringMb(() =>
      drain('/api/v1/reports?type=ASSET_INVENTORY&format=CSV', rig.token),
    );

    expect(result.status).toBe(200);
    expect(buffered.result.status).toBe(200);
    const { bytes, rows } = result;

    const label = process.env.PERF_LABEL ?? 'run';
    const report = {
      label,
      takenAt: new Date().toISOString(),
      assetsInTenant: total,
      rowsExported: rows,
      bytes,
      peakHeapMb: Number(peakMb.toFixed(1)),
      ms,
      bufferedPeakHeapMb: Number(buffered.peakMb.toFixed(1)),
      bufferedMs: buffered.ms,
    };
    // eslint-disable-next-line no-console
    console.log(
      `\nExport — ${rows.toLocaleString()} rows, ${(bytes / 1024 / 1024).toFixed(1)} MB payload` +
        `\n  streamed (CSV):  peak retained +${peakMb.toFixed(1)} MB, ${(ms / 1000).toFixed(2)}s` +
        `\n  buffered (JSON): peak retained +${buffered.peakMb.toFixed(1)} MB, ${(buffered.ms / 1000).toFixed(2)}s\n`,
    );

    const dir = path.resolve(import.meta.dirname, '../../../perf/baselines');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `export-${label}.json`), `${JSON.stringify(report, null, 2)}\n`);

    // Every row in the tenant must be present: a streaming export that silently
    // stops early would look excellent on every metric here.
    expect(rows).toBe(total);
    // The point of the workstream, as a check rather than a claim.
    expect(peakMb).toBeLessThan(buffered.peakMb);
  });
});
