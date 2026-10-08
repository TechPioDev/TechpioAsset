import { describe, expect, it } from 'vitest';
import {
  m365ProductName,
  m365SeatsReserved,
  normalizeM365Subscriptions,
  planM365Sync,
  type GraphCompanySubscription,
  type GraphSubscribedSku,
  type M365Existing,
  type M365License,
} from './m365-licenses';

const sku = (over: Partial<GraphSubscribedSku> & { skuId: string }): GraphSubscribedSku => ({
  skuPartNumber: 'O365_BUSINESS_PREMIUM',
  appliesTo: 'User',
  capabilityStatus: 'Enabled',
  consumedUnits: 0,
  prepaidUnits: { enabled: 0, warning: 0, suspended: 0, lockedOut: 0 },
  ...over,
});

const sub = (
  over: Partial<GraphCompanySubscription> & { skuId: string },
): GraphCompanySubscription => ({
  status: 'Enabled',
  isTrial: false,
  createdDateTime: '2025-04-01T00:00:00Z',
  nextLifecycleDateTime: '2027-04-01T00:00:00Z',
  ...over,
});

describe('reading Microsoft 365 subscriptions', () => {
  it('records the seats owned, the seats in use and the renewal date', () => {
    const { licenses, skipped } = normalizeM365Subscriptions(
      [sku({ skuId: 'a', consumedUnits: 42, prepaidUnits: { enabled: 50 } })],
      [sub({ skuId: 'a' })],
    );
    expect(skipped).toEqual([]);
    expect(licenses).toHaveLength(1);
    expect(licenses[0]).toMatchObject({
      externalId: 'a',
      partNumber: 'O365_BUSINESS_PREMIUM',
      name: 'Microsoft 365 Business Standard',
      family: 'PRODUCTIVITY_SUITE',
      seatsPurchased: 50,
      seatsUsed: 42,
      status: 'Enabled',
      isTrial: false,
    });
    expect(licenses[0]!.renewalDate).toEqual(new Date('2027-04-01T00:00:00Z'));
    expect(licenses[0]!.purchaseDate).toEqual(new Date('2025-04-01T00:00:00Z'));
  });

  it('counts grace-period seats as owned, and suspended ones as not', () => {
    const { licenses } = normalizeM365Subscriptions(
      [
        sku({
          skuId: 'a',
          prepaidUnits: { enabled: 10, warning: 5, suspended: 20, lockedOut: 7 },
          consumedUnits: 12,
        }),
      ],
      [],
    );
    // 10 running + 5 in grace. The 27 suspended or locked out are owed, not owned.
    expect(licenses[0]!.seatsPurchased).toBe(15);
  });

  it('takes the EARLIEST renewal date when a product was bought in batches', () => {
    const { licenses } = normalizeM365Subscriptions(
      [sku({ skuId: 'a', prepaidUnits: { enabled: 30 } })],
      [
        sub({ skuId: 'a', nextLifecycleDateTime: '2027-09-01T00:00:00Z' }),
        sub({ skuId: 'a', nextLifecycleDateTime: '2027-01-15T00:00:00Z' }),
      ],
    );
    expect(licenses[0]!.renewalDate).toEqual(new Date('2027-01-15T00:00:00Z'));
  });

  it('ignores a batch that has already lapsed when choosing the date', () => {
    // Without this, a subscription that ended last year would make a live
    // product look as if it had expired.
    const { licenses } = normalizeM365Subscriptions(
      [sku({ skuId: 'a', prepaidUnits: { enabled: 30 } })],
      [
        sub({ skuId: 'a', status: 'Deleted', nextLifecycleDateTime: '2025-01-01T00:00:00Z' }),
        sub({ skuId: 'a', status: 'Enabled', nextLifecycleDateTime: '2027-06-01T00:00:00Z' }),
      ],
    );
    expect(licenses[0]!.renewalDate).toEqual(new Date('2027-06-01T00:00:00Z'));
  });

  it('has no renewal date when Microsoft gives none, rather than inventing one', () => {
    const { licenses } = normalizeM365Subscriptions(
      [sku({ skuId: 'a', prepaidUnits: { enabled: 5 } })],
      [],
    );
    expect(licenses[0]!.renewalDate).toBeNull();
    expect(licenses[0]!.purchaseDate).toBeNull();
  });

  it('leaves out the free products, and says so', () => {
    const { licenses, skipped } = normalizeM365Subscriptions(
      [
        sku({ skuId: 'a', prepaidUnits: { enabled: 25 }, consumedUnits: 20 }),
        sku({
          skuId: 'free',
          skuPartNumber: 'FLOW_FREE',
          prepaidUnits: { enabled: 10_000 },
          consumedUnits: 3,
        }),
        sku({
          skuId: 'free2',
          skuPartNumber: 'TEAMS_EXPLORATORY',
          prepaidUnits: { enabled: 1_000_000 },
        }),
      ],
      [],
    );
    expect(licenses.map((l) => l.externalId)).toEqual(['a']);
    expect(skipped).toEqual([
      { partNumber: 'FLOW_FREE', reason: 'free' },
      { partNumber: 'TEAMS_EXPLORATORY', reason: 'free' },
    ]);
  });

  it('leaves out tenant-wide entitlements, deleted products and empty rows', () => {
    const { licenses, skipped } = normalizeM365Subscriptions(
      [
        sku({ skuId: 'c', skuPartNumber: 'RMSBASIC', appliesTo: 'Company' }),
        sku({ skuId: 'd', skuPartNumber: 'OLD_PLAN', capabilityStatus: 'Deleted' }),
        sku({ skuId: 'e', skuPartNumber: 'NOTHING_HERE' }),
      ],
      [],
    );
    expect(licenses).toEqual([]);
    expect(skipped).toEqual([
      { partNumber: 'RMSBASIC', reason: 'not-per-user' },
      { partNumber: 'OLD_PLAN', reason: 'deleted' },
      { partNumber: 'NOTHING_HERE', reason: 'empty' },
    ]);
  });

  it('accounts for every product Microsoft listed: recorded or skipped, never dropped', () => {
    const skus = [
      sku({ skuId: 'a', prepaidUnits: { enabled: 25 } }),
      sku({ skuId: 'b', skuPartNumber: 'FLOW_FREE', prepaidUnits: { enabled: 10_000 } }),
      sku({ skuId: 'c', skuPartNumber: 'RMSBASIC', appliesTo: 'Company' }),
      sku({ skuId: 'd', skuPartNumber: 'SPB', prepaidUnits: { enabled: 4 }, consumedUnits: 4 }),
    ];
    const { licenses, skipped } = normalizeM365Subscriptions(skus, []);
    expect(licenses.length + skipped.length).toBe(skus.length);
  });

  it('still records a product in use with no seats left, so the overshoot is visible', () => {
    const { licenses } = normalizeM365Subscriptions(
      [
        sku({
          skuId: 'a',
          capabilityStatus: 'Suspended',
          prepaidUnits: { enabled: 0, suspended: 10 },
          consumedUnits: 8,
        }),
      ],
      [],
    );
    expect(licenses[0]).toMatchObject({ seatsPurchased: 0, seatsUsed: 8, status: 'Suspended' });
  });

  it('marks a trial only when every live purchase is a trial', () => {
    const trial = normalizeM365Subscriptions(
      [sku({ skuId: 'a', prepaidUnits: { enabled: 25 } })],
      [sub({ skuId: 'a', isTrial: true })],
    ).licenses[0]!;
    expect(trial.isTrial).toBe(true);
    expect(trial.name).toBe('Microsoft 365 Business Standard (trial)');

    const mixed = normalizeM365Subscriptions(
      [sku({ skuId: 'a', prepaidUnits: { enabled: 25 } })],
      [sub({ skuId: 'a', isTrial: true }), sub({ skuId: 'a', isTrial: false })],
    ).licenses[0]!;
    expect(mixed.isTrial).toBe(false);
    expect(mixed.name).toBe('Microsoft 365 Business Standard');
  });

  it("shows Microsoft's own code for a product it does not recognise", () => {
    // A guessed name on a licence is worse than an unfamiliar one.
    expect(m365ProductName('SOME_NEW_PLAN_2027')).toBe('SOME NEW PLAN 2027');
    expect(m365ProductName('SPB')).toBe('Microsoft 365 Business Premium');
  });

  it('files security and Windows products under their own family', () => {
    const { licenses } = normalizeM365Subscriptions(
      [
        sku({ skuId: 'a', skuPartNumber: 'AAD_PREMIUM', prepaidUnits: { enabled: 5 } }),
        sku({ skuId: 'b', skuPartNumber: 'WIN10_PRO_ENT_SUB', prepaidUnits: { enabled: 5 } }),
      ],
      [],
    );
    expect(Object.fromEntries(licenses.map((l) => [l.partNumber, l.family]))).toEqual({
      AAD_PREMIUM: 'SECURITY',
      WIN10_PRO_ENT_SUB: 'OPERATING_SYSTEM',
    });
  });
});

const license = (over: Partial<M365License> & { externalId: string }): M365License => ({
  partNumber: 'O365_BUSINESS_PREMIUM',
  name: 'Microsoft 365 Business Standard',
  family: 'PRODUCTIVITY_SUITE',
  seatsPurchased: 50,
  seatsUsed: 42,
  status: 'Enabled',
  renewalDate: new Date('2027-04-01T00:00:00Z'),
  purchaseDate: new Date('2025-04-01T00:00:00Z'),
  isTrial: false,
  ...over,
});

const held = (over: Partial<M365Existing> & { id: string; externalId: string }): M365Existing => ({
  name: 'Microsoft 365 Business Standard',
  seatsPurchased: 50,
  seatsUsed: 42,
  renewalDate: new Date('2027-04-01T00:00:00Z'),
  externalStatus: 'Enabled',
  retired: false,
  ...over,
});

describe('deciding what a sync writes', () => {
  it('creates what is new', () => {
    const plan = planM365Sync([], [license({ externalId: 'a' })]);
    expect(plan.create.map((l) => l.externalId)).toEqual(['a']);
    expect(plan.update).toEqual([]);
    expect(plan.retire).toEqual([]);
  });

  it('changes nothing on a second run with the same data', () => {
    const plan = planM365Sync([held({ id: '1', externalId: 'a' })], [license({ externalId: 'a' })]);
    expect(plan.create).toEqual([]);
    expect(plan.retire).toEqual([]);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]).toMatchObject({ id: '1', seatsDelta: 0, changed: false });
  });

  it('reports a seat change as a delta, in either direction', () => {
    const up = planM365Sync(
      [held({ id: '1', externalId: 'a', seatsPurchased: 50 })],
      [license({ externalId: 'a', seatsPurchased: 60 })],
    );
    expect(up.update[0]).toMatchObject({ seatsDelta: 10, changed: true });

    const down = planM365Sync(
      [held({ id: '1', externalId: 'a', seatsPurchased: 50 })],
      [license({ externalId: 'a', seatsPurchased: 45 })],
    );
    expect(down.update[0]).toMatchObject({ seatsDelta: -5, changed: true });
  });

  it('follows a renamed product by its id instead of retiring it and making a new one', () => {
    // Microsoft renamed Office 365 Business Premium to Microsoft 365 Business
    // Standard overnight. Matching on the name would have left the cost and
    // notes somebody typed on a retired record.
    const plan = planM365Sync(
      [held({ id: '1', externalId: 'a', name: 'Office 365 Business Premium' })],
      [license({ externalId: 'a', name: 'Microsoft 365 Business Standard' })],
    );
    expect(plan.create).toEqual([]);
    expect(plan.retire).toEqual([]);
    expect(plan.update[0]).toMatchObject({ id: '1', changed: true, seatsDelta: 0 });
  });

  it('notices a change in use, in status and in the renewal date', () => {
    const base = [held({ id: '1', externalId: 'a' })];
    expect(
      planM365Sync(base, [license({ externalId: 'a', seatsUsed: 43 })]).update[0]!.changed,
    ).toBe(true);
    expect(
      planM365Sync(base, [license({ externalId: 'a', status: 'Warning' })]).update[0]!.changed,
    ).toBe(true);
    expect(
      planM365Sync(base, [
        license({ externalId: 'a', renewalDate: new Date('2028-04-01T00:00:00Z') }),
      ]).update[0]!.changed,
    ).toBe(true);
  });

  it('retires what Microsoft no longer lists, and never deletes it', () => {
    const plan = planM365Sync(
      [
        held({ id: '1', externalId: 'a' }),
        held({ id: '2', externalId: 'gone', name: 'Visio Plan 2' }),
      ],
      [license({ externalId: 'a' })],
    );
    expect(plan.retire).toEqual([{ id: '2', name: 'Visio Plan 2' }]);
  });

  it('does not retire the same licence twice', () => {
    const plan = planM365Sync([held({ id: '2', externalId: 'gone', retired: true })], []);
    expect(plan.retire).toEqual([]);
  });

  it('brings a retired licence back when Microsoft lists it again', () => {
    const plan = planM365Sync(
      [held({ id: '1', externalId: 'a', retired: true })],
      [license({ externalId: 'a' })],
    );
    expect(plan.create).toEqual([]);
    expect(plan.update[0]).toMatchObject({ id: '1', revived: true, changed: true });
  });
});

describe('the seat counter', () => {
  it('mirrors what is in use', () => {
    expect(m365SeatsReserved({ seatsPurchased: 50, seatsUsed: 42 })).toEqual({
      reserved: 42,
      overAssignedBy: 0,
    });
  });

  it('never exceeds the seats owned, and reports the overshoot separately', () => {
    expect(m365SeatsReserved({ seatsPurchased: 50, seatsUsed: 57 })).toEqual({
      reserved: 50,
      overAssignedBy: 7,
    });
  });
});
