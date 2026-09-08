import { randomInt } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Changing what identifies a device has to leave a trace (v2.40).
 *
 * `AUDITED_FIELDS` listed serialNumber but not brand, model, imei, macAddress
 * or specs, and `recordChange` returns early when none of the listed fields
 * moved. So fifteen brand corrections were applied to production and left no
 * audit entry whatsoever, and an IMEI written to a phone the day before was
 * recorded only because the serial number happened to change in the same call.
 *
 * On a register whose purpose is saying which device is which - and which gets
 * produced as evidence when one goes missing - the numbers that identify a
 * phone must be as traceable as the number that identifies a laptop.
 */

let app: INestApplication;
let s: Record<AccountKey, Session>;

beforeAll(async () => {
  app = await createTestApp();
  s = await loginAll(app);
});

afterAll(async () => {
  await app?.close();
});

/**
 * The audit entry recording a specific change, found by the value it carries.
 *
 * Not "the newest entry for this asset": these tests share seeded assets with
 * the rest of the suite, and another file touching the same asset makes the
 * newest entry somebody else's. That passed in isolation and failed in a full
 * run - the same trap as the queued-extraction tests earlier in v2.39.
 */
async function entryRecording(assetId: string, field: string, value: string) {
  const res = await api(app)
    .get(`/api/v1/audit?entityType=Asset&entityId=${assetId}&pageSize=25`)
    .set(auth(s.superAdmin));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const match = res.body.data.find(
    (e: { newValues?: Record<string, unknown> }) => e.newValues?.[field] === value,
  );
  expect(match, `no audit entry recording ${field}=${value}`).toBeTruthy();
  return match;
}

async function anAsset() {
  const res = await api(app).get('/api/v1/assets?pageSize=1').set(auth(s.superAdmin));
  const asset = res.body.data[0];
  expect(asset, 'the seed should provide at least one asset').toBeTruthy();
  return asset;
}

describe('identifier changes are recorded', () => {
  it('records a brand correction', async () => {
    const asset = await anAsset();
    const brand = `Brand-${Date.now()}`;

    const patch = await api(app)
      .patch(`/api/v1/assets/${asset.id}`)
      .set(auth(s.superAdmin))
      .send({ brand });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);

    const entry = await entryRecording(asset.id, 'brand', brand);
    expect(entry.action).toBe('ASSET_UPDATED');
    // The previous value matters as much as the new one: an audit trail that
    // says only what a field became cannot show what was overwritten.
    expect(entry.previousValues).toHaveProperty('brand');
  });

  it('records an IMEI change, which used to be silent', async () => {
    const asset = await anAsset();
    const imei = String(Date.now()).padStart(15, '3').slice(0, 15);

    const patch = await api(app)
      .patch(`/api/v1/assets/${asset.id}`)
      .set(auth(s.superAdmin))
      .send({ imei });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);

    await entryRecording(asset.id, 'imei', imei);
  });

  it('records a MAC address change', async () => {
    const asset = await anAsset();
    // Three random octets, not a slice of the clock.
    //
    // This drew its last octet from `Date.now() % 90 + 10`, which is ninety
    // values, and (companyId, macAddress) is unique. Every run left an asset
    // holding one of the ninety for good, so the odds of a clash rose with
    // every run until the PATCH started coming back a conflict - thirty of the
    // ninety were taken when this was found, and the test was failing about a
    // third of the time. Sixteen million values do not fill up.
    const octet = () =>
      randomInt(256)
        .toString(16)
        .padStart(2, '0')
        .toUpperCase();
    const mac = `AC:D6:18:${octet()}:${octet()}:${octet()}`;

    const patch = await api(app)
      .patch(`/api/v1/assets/${asset.id}`)
      .set(auth(s.superAdmin))
      .send({ macAddress: mac });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);

    await entryRecording(asset.id, 'macAddress', mac.toUpperCase());
  });

  it('still writes nothing when nothing actually changed', async () => {
    // The early return is deliberate and worth keeping: re-saving an unchanged
    // asset should not fill the trail with entries that record no change.
    const asset = await anAsset();
    const brand = `Stable-${Date.now()}`;
    await api(app).patch(`/api/v1/assets/${asset.id}`).set(auth(s.superAdmin)).send({ brand });
    const before = await entryRecording(asset.id, 'brand', brand);

    await api(app).patch(`/api/v1/assets/${asset.id}`).set(auth(s.superAdmin)).send({ brand });
    const after = await entryRecording(asset.id, 'brand', brand);

    // Re-saving an unchanged value writes nothing, so the same entry is found.
    expect(after.id).toBe(before.id);
  });
});
