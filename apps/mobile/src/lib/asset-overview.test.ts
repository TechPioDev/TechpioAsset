import { describe, expect, it } from 'vitest';
import { assetDetailNav } from '@techpioasset/domain';
import {
  agentPill,
  assetImageCaption,
  assetImagePath,
  assetNavIcon,
  healthScoreTile,
  illustrationIonicon,
  lastSyncLine,
  moreActions,
  notesPayload,
  warrantyStanding,
} from './asset-overview';

describe('tab strip icons', () => {
  it('has a glyph for every section the domain can list', () => {
    const nav = assetDetailNav({ showDiscovery: true, softwareCount: 3, canSeeCost: true });
    for (const item of nav) expect(assetNavIcon(item.key)).toMatch(/-outline$/);
    expect(assetNavIcon('software')).toBe('cube-outline');
  });

  it('draws every illustration the domain can resolve', () => {
    expect(illustrationIonicon('laptop')).toBe('laptop-outline');
    expect(illustrationIonicon('phone')).toBe('phone-portrait-outline');
    expect(illustrationIonicon('other')).toBe('cube-outline');
  });
});

describe('product image card', () => {
  it('resolves the catalogue picture and the unit photo to their API paths', () => {
    expect(assetImagePath({ kind: 'catalogue', productId: 'vp1', imageId: 'im1' }, 'a1')).toBe(
      '/vendor-products/vp1/images/im1',
    );
    expect(assetImagePath({ kind: 'photo', photoId: 'ph1' }, 'a1')).toBe('/assets/a1/photos/ph1');
    expect(assetImagePath({ kind: 'illustration', icon: 'laptop', brand: null }, 'a1')).toBeNull();
  });

  it('captions the picture by where it came from, and honestly after a failed load', () => {
    expect(assetImageCaption({ kind: 'catalogue', productId: 'vp1', imageId: 'im1' }, false)).toBe(
      'Catalogue picture',
    );
    expect(assetImageCaption({ kind: 'photo', photoId: 'ph1' }, false)).toBe('Photo of this unit');
    expect(assetImageCaption({ kind: 'photo', photoId: 'ph1' }, true)).toBe(
      'No picture on file — illustration by type',
    );
    expect(assetImageCaption({ kind: 'illustration', icon: 'other', brand: 'Dell' }, false)).toBe(
      'No picture on file — illustration by type',
    );
  });
});

describe('header lines', () => {
  const now = Date.parse('2026-09-17T12:00:00Z');

  it('never says online - only how recently the agent reported', () => {
    expect(agentPill('fresh', '2026-09-17T11:00:00Z', now)).toEqual({
      label: 'Agent reporting',
      tone: 'success',
    });
    expect(agentPill('ageing', '2026-09-14T12:00:00Z', now)).toEqual({
      label: 'Agent last seen 3 days ago',
      tone: 'warning',
    });
    expect(agentPill('stale', '2026-09-01T12:00:00Z', now)).toEqual({
      label: 'Agent not reporting · 16 days ago',
      tone: 'critical',
    });
  });

  it('writes the last-sync line with the source in lower case', () => {
    expect(lastSyncLine({ at: '2026-09-16T12:00:00Z', source: 'AGENT' }, now)).toBe(
      'Updated 1 day ago · agent',
    );
  });

  it('reads the warranty standing from the end date', () => {
    const today = new Date('2026-09-17T00:00:00Z');
    expect(warrantyStanding(null, today)).toEqual({ label: 'Not recorded', tone: 'muted', expired: false });
    expect(warrantyStanding('2027-01-01', today)).toEqual({
      label: 'Under warranty',
      tone: 'success',
      expired: false,
    });
    expect(warrantyStanding('2026-01-01', today)).toEqual({ label: 'Warranty out', tone: 'critical', expired: true });
  });

  it('turns the health score into a tile with a clamped bar', () => {
    expect(healthScoreTile({ overall: 82, grade: 'GOOD' }, 'success')).toEqual({
      key: 'smart',
      label: 'Health score',
      value: '82 / 100',
      hint: 'good',
      tone: 'success',
      percent: 82,
    });
    expect(healthScoreTile({ overall: 140, grade: 'EXCELLENT' }, 'success').percent).toBe(100);
  });
});

describe('notes', () => {
  it('trims, sends null for blank, and carries the version for the conflict check', () => {
    expect(notesPayload('  hinge loose \n', 7)).toEqual({ notes: 'hinge loose', version: 7 });
    expect(notesPayload('   ', 7)).toEqual({ notes: null, version: 7 });
  });
});

describe('more actions sheet', () => {
  const everything = {
    hasHolder: true,
    canUpdate: true,
    hasQrToken: true,
    custody: { show: true, recordReturn: true },
    transfer: 'dispatch' as const,
    canDispose: true,
    canSeeCost: true,
    hasPrice: false,
  };

  it('offers every door in the web menu order, grouped', () => {
    const groups = moreActions(everything);
    expect(groups.map((g) => g.title)).toEqual([undefined, 'Manage']);
    expect(groups[0]!.items.map((i) => i.key)).toEqual(['receipt', 'edit', 'qr']);
    expect(groups[1]!.items.map((i) => [i.key, i.label])).toEqual([
      ['custody', 'Hand over / record return'],
      ['transfer', 'Office transfer'],
      ['disposal', 'Record disposal'],
      ['price', 'Record price'],
    ]);
  });

  it('words the doors by the state they lead to', () => {
    const groups = moreActions({
      ...everything,
      custody: { show: true, recordReturn: false },
      transfer: 'receive',
      hasPrice: true,
    });
    expect(groups[1]!.items.map((i) => i.label)).toEqual([
      'Assign to someone',
      'Confirm arrival',
      'Record disposal',
      'Price & financials',
    ]);
  });

  it('drops empty groups rather than showing a heading over nothing', () => {
    expect(
      moreActions({
        hasHolder: false,
        canUpdate: false,
        hasQrToken: false,
        custody: { show: false, recordReturn: false },
        transfer: 'none',
        canDispose: false,
        canSeeCost: false,
        hasPrice: false,
      }),
    ).toEqual([]);
    const onlyManage = moreActions({ ...everything, hasHolder: false, canUpdate: false, hasQrToken: false });
    expect(onlyManage).toHaveLength(1);
    expect(onlyManage[0]!.title).toBe('Manage');
  });
});
