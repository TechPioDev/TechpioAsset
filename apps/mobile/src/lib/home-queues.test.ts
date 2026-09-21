import { describe, expect, it } from 'vitest';
import { QUEUES, QUEUE_ROWS } from './home-queues';

const NOW = new Date('2026-09-21T10:00:00Z');

describe('the work queues on Home', () => {
  it('shows what is awaiting the person, by what was asked for, opening the request', () => {
    const rows = QUEUES['awaiting-me'].rows(
      [
        {
          id: 'r1',
          requestNumber: 'REQ-2026-000012',
          currentStep: { name: 'Manager approval' },
          requester: { email: 'a@x.test', profile: { firstName: 'Asha', lastName: 'Rao' } },
          items: [{ description: 'Dell Latitude 7450' }],
        },
      ],
      NOW,
    );
    expect(rows).toEqual([
      {
        id: 'r1',
        title: 'Dell Latitude 7450',
        subtitle: 'REQ-2026-000012 · Asha Rao',
        badge: 'Manager approval',
        tone: 'warning',
        href: '/request/r1',
      },
    ]);
  });

  it('leaves finished work orders out, and marks one past its due time', () => {
    const rows = QUEUES['my-work-orders'].rows(
      [
        { id: 'w1', title: 'Done job', status: 'COMPLETED', slaDueAt: null, scheduledFor: null },
        { id: 'w2', title: 'Late job', status: 'IN_PROGRESS', slaDueAt: '2026-09-20T10:00:00Z', scheduledFor: null },
        { id: 'w3', title: 'Open job', status: 'OPEN', slaDueAt: null, scheduledFor: null },
      ],
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(['w2', 'w3']);
    expect(rows[0]).toMatchObject({ tone: 'danger', subtitle: 'Past its due time', href: '/work-order/w2' });
    expect(QUEUES['my-work-orders'].path('u1')).toContain('technicianId=u1');
  });

  it('lists only stock at or under its reorder level, from either response shape', () => {
    const levels = [
      { id: 'l1', quantity: '2', inventoryItem: { name: 'HDMI cable', unit: 'pc', minStock: '5' }, stockLocation: { name: 'Main store' } },
      { id: 'l2', quantity: '40', inventoryItem: { name: 'Mouse', unit: 'pc', minStock: '5' }, stockLocation: { name: 'Main store' } },
      { id: 'l3', quantity: '0', inventoryItem: { name: 'Toner', unit: 'pc', minStock: null }, stockLocation: { name: 'Main store' } },
    ];
    const fromArray = QUEUES['low-stock'].rows(levels, NOW);
    const fromEnvelope = QUEUES['low-stock'].rows({ data: levels }, NOW);
    expect(fromArray).toEqual(fromEnvelope);
    expect(fromArray.map((r) => r.id)).toEqual(['l1']);
    expect(fromArray[0]).toMatchObject({ badge: '2 left', subtitle: 'Main store · reorder at 5' });
  });

  it('shows bills still to be verified, not the settled ones', () => {
    const rows = QUEUES['invoices-to-verify'].rows(
      [
        { id: 'i1', invoiceNumber: 'INV-1', verificationStatus: 'VERIFIED', vendor: { name: 'Acme' } },
        { id: 'i2', invoiceNumber: 'INV-2', verificationStatus: 'MANUAL_REVIEW_REQUIRED', vendor: null },
      ],
      NOW,
    );
    expect(rows).toEqual([
      { id: 'i2', title: 'INV-2', subtitle: 'No vendor', badge: 'Manual review required', tone: 'warning', href: '/invoice/i2' },
    ]);
  });

  it('names the person who is leaving and opens their offboarding', () => {
    const rows = QUEUES.offboarding.rows(
      [{ id: 't1', subjectUserId: 'u9', subjectUser: { email: 'r@x.test', profile: { firstName: 'Rohit', lastName: 'C' } } }],
      NOW,
    );
    expect(rows[0]).toMatchObject({ title: 'Rohit C', href: '/person/offboard?id=u9' });
  });

  it('never shows more than a few rows, and nothing at all from a bad response', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: `a${i}`,
      action: 'ASSET_UPDATED',
      entityType: 'Asset',
      createdAt: '2026-09-21T09:00:00Z',
      actor: null,
    }));
    expect(QUEUES['recent-changes'].rows(many, NOW)).toHaveLength(QUEUE_ROWS);
    for (const spec of Object.values(QUEUES)) {
      expect(spec.rows(null, NOW)).toEqual([]);
      expect(spec.rows({ nonsense: true }, NOW)).toEqual([]);
    }
  });
});
