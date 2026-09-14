import type { INestApplication } from '@nestjs/common';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { api, auth, createTestApp, loginAll, type AccountKey, type Session } from './harness.js';

/**
 * Phase 2c: disposal (spec section 22 - recorded, never a delete).
 *
 * DisposalRecord existed in the schema from v1 and nothing ever wrote one:
 * assets could reach DISPOSED through the generic status endpoint with no
 * method, no recipient, no reason and no proceeds - a terminal state with no
 * story attached. These tests pin the flow that replaces that.
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

const uniq = () => `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 900 + 100)}`;

async function freshAsset(suffix: string, status = 'AVAILABLE') {
  const categories = await api(app).get('/api/v1/categories').set(auth(s.itAdmin));
  const itCategory = categories.body.data.find((c: { key: string }) => c.key === 'it-assets');
  const created = await api(app)
    .post('/api/v1/assets')
    .set(auth(s.itAdmin))
    .send({
      assetTag: `DISP-${suffix}`,
      name: `Disposal test laptop ${suffix}`,
      categoryId: itCategory.id,
      serialNumber: `DISPSN-${suffix}`,
      status,
    });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.data as { id: string; assetTag: string };
}

const disposeBody = (over: Record<string, unknown> = {}) => ({
  method: 'SCRAPPED',
  disposedAt: new Date().toISOString(),
  reason: 'Beyond economical repair after mainboard failure',
  ...over,
});

describe('POST /assets/:id/dispose', () => {
  it('writes the record, moves the asset to DISPOSED, and audits it', async () => {
    const asset = await freshAsset(uniq());

    const res = await api(app)
      .post(`/api/v1/assets/${asset.id}/dispose`)
      .set(auth(s.finance))
      .send(
        disposeBody({
          method: 'SOLD',
          proceeds: '150.00',
          currency: 'usd',
          recipient: 'SecondLife Refurb Ltd',
        }),
      );
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const after = res.body.data;
    expect(after.status).toBe('DISPOSED');
    expect(after.disposal.method).toBe('SOLD');
    expect(after.disposal.recipient).toBe('SecondLife Refurb Ltd');
    // Finance sees the money; the currency was normalised to upper case.
    expect(after.disposal.proceeds).toBe('150');
    expect(after.disposal.currency).toBe('USD');

    const audit = await api(app)
      .get(`/api/v1/audit?entityId=${asset.id}&pageSize=50`)
      .set(auth(s.superAdmin));
    expect(
      audit.body.data.some((e: { action: string }) => e.action === 'DISPOSAL_RECORDED'),
    ).toBe(true);
  });

  it("records proceeds sent without a currency in the company's own, not dollars", async () => {
    // Neither app sends a currency with proceeds. This used to fall back to
    // USD, so an Indian company's scrap sale was stored as dollars.
    // The test company is USD, which would pass with the old fallback too.
    const company = await api(app).get('/api/v1/company').set(auth(s.superAdmin));
    const original = company.body.data.baseCurrency as string;
    const switched = await api(app)
      .patch('/api/v1/company')
      .set(auth(s.superAdmin))
      .send({ baseCurrency: 'INR' });
    expect(switched.status).toBeLessThan(300);
    try {
      const asset = await freshAsset(uniq());
      const res = await api(app)
        .post(`/api/v1/assets/${asset.id}/dispose`)
        .set(auth(s.finance))
        .send(disposeBody({ method: 'SOLD', proceeds: '4500.00', recipient: 'Local recycler' }));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.disposal.currency).toBe('INR');
    } finally {
      await api(app).patch('/api/v1/company').set(auth(s.superAdmin)).send({ baseCurrency: original });
    }
  });

  it('a donation lands in DONATED, not DISPOSED', async () => {
    const asset = await freshAsset(uniq());

    const res = await api(app)
      .post(`/api/v1/assets/${asset.id}/dispose`)
      .set(auth(s.finance))
      .send(disposeBody({ method: 'DONATED', recipient: 'Local school trust' }));
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('DONATED');
  });

  it('refuses while someone still holds the asset', async () => {
    const asset = await freshAsset(uniq());
    await api(app)
      .post(`/api/v1/assets/${asset.id}/assign`)
      .set(auth(s.itAdmin))
      .send({ userId: s.employee.user.id, conditionOut: 'GOOD' });

    const res = await api(app)
      .post(`/api/v1/assets/${asset.id}/dispose`)
      .set(auth(s.finance))
      .send(disposeBody());
    expect(res.status).toBe(422);
    expect(res.body.detail).toContain('still assigned');

    // And custody is untouched.
    const check = await api(app).get(`/api/v1/assets/${asset.id}`).set(auth(s.itAdmin));
    expect(check.body.data.status).toBe('ASSIGNED');
  });

  it('cannot happen twice - the terminal state has no exits', async () => {
    const asset = await freshAsset(uniq());
    await api(app)
      .post(`/api/v1/assets/${asset.id}/dispose`)
      .set(auth(s.finance))
      .send(disposeBody());

    const again = await api(app)
      .post(`/api/v1/assets/${asset.id}/dispose`)
      .set(auth(s.finance))
      .send(disposeBody());
    // The state machine refuses: DISPOSED is terminal, so this is a conflict
    // with the asset's current state, not a validation problem.
    expect(again.status).toBe(409);
  });

  it('refuses a disposal date in the future', async () => {
    const asset = await freshAsset(uniq());
    const res = await api(app)
      .post(`/api/v1/assets/${asset.id}/dispose`)
      .set(auth(s.finance))
      .send(disposeBody({ disposedAt: new Date(Date.now() + 7 * 86_400_000).toISOString() }));
    expect(res.status).toBe(422);
  });

  it('is denied to IT admin - disposal plus stock adjustment is the SoD pair', async () => {
    const asset = await freshAsset(uniq());
    const res = await api(app)
      .post(`/api/v1/assets/${asset.id}/dispose`)
      .set(auth(s.itAdmin))
      .send(disposeBody());
    expect(res.status).toBe(403);
  });

  it('hides proceeds from viewers without cost visibility', async () => {
    const asset = await freshAsset(uniq());
    await api(app)
      .post(`/api/v1/assets/${asset.id}/dispose`)
      .set(auth(s.finance))
      .send(disposeBody({ method: 'SOLD', proceeds: '99.99', recipient: 'Refurb Ltd' }));

    // IT can see the disposal happened - method, date, recipient, reason -
    // but the money is Finance's to see, same as every other price.
    const asIt = await api(app).get(`/api/v1/assets/${asset.id}`).set(auth(s.itAdmin));
    expect(asIt.status).toBe(200);
    expect(asIt.body.data.disposal.method).toBe('SOLD');
    expect(asIt.body.data.disposal.recipient).toBe('Refurb Ltd');
    expect(asIt.body.data.disposal.proceeds).toBeUndefined();
    expect(asIt.body.data.disposal.currency).toBeUndefined();
  });

  it('rejects a reason too short to mean anything', async () => {
    const asset = await freshAsset(uniq());
    const res = await api(app)
      .post(`/api/v1/assets/${asset.id}/dispose`)
      .set(auth(s.finance))
      .send(disposeBody({ reason: 'old' }));
    expect(res.status).toBe(422);
  });
});
