import { describe, expect, it } from 'vitest';
import {
  assetDetailNav,
  conditionSentence,
  deviceHealthTiles,
  formatUptime,
  headerMeta,
  illustrationIcon,
  latestAgentReport,
  noteSummary,
  quickSpecs,
  resolveAssetImageSource,
} from './asset-overview';

describe('assetDetailNav', () => {
  it('follows the domain order, adds notes and attachments after history, and badges software', () => {
    const nav = assetDetailNav({ showDiscovery: true, softwareCount: 142, canSeeCost: true });
    expect(nav.map((n) => n.key)).toEqual([
      'overview',
      'lifecycle',
      'hardware',
      'os',
      'software',
      'health',
      'history',
      'notes',
      'attachments',
      'financials',
    ]);
    expect(nav.find((n) => n.key === 'software')).toEqual({
      key: 'software',
      label: 'Software',
      badge: 142,
    });
  });

  it('drops the agent tabs and money when they do not apply, keeps notes and attachments', () => {
    const nav = assetDetailNav({ showDiscovery: false, softwareCount: 0, canSeeCost: false });
    expect(nav.map((n) => n.key)).toEqual([
      'overview',
      'lifecycle',
      'history',
      'notes',
      'attachments',
    ]);
    expect(nav.some((n) => n.badge !== undefined)).toBe(false);
  });
});

describe('resolveAssetImageSource', () => {
  const base = { brand: 'Lenovo', subcategory: { key: 'laptop' } };

  it('leads with the catalogue picture when nobody has chosen a primary one', () => {
    expect(
      resolveAssetImageSource({
        ...base,
        vendorProduct: { id: 'vp1', primaryImageId: 'img1' },
        photo: null,
      }),
    ).toEqual({ kind: 'catalogue', productId: 'vp1', imageId: 'img1' });
  });

  it('leads with the chosen primary picture, even over the catalogue (v2.66)', () => {
    expect(
      resolveAssetImageSource({
        ...base,
        vendorProduct: { id: 'vp1', primaryImageId: 'img1' },
        photo: { id: 'ph1' },
      }),
    ).toEqual({ kind: 'photo', photoId: 'ph1' });
  });

  it('falls back to the uploaded photo when the listing has no picture', () => {
    expect(
      resolveAssetImageSource({
        ...base,
        vendorProduct: { id: 'vp1', primaryImageId: null },
        photo: { id: 'ph1' },
      }),
    ).toEqual({ kind: 'photo', photoId: 'ph1' });
  });

  it('draws an illustration by type with the brand when nothing is on file', () => {
    expect(resolveAssetImageSource({ ...base, vendorProduct: null, photo: null })).toEqual({
      kind: 'illustration',
      icon: 'laptop',
      brand: 'Lenovo',
    });
  });

  it('maps every register type to an icon, and the unknown to a box', () => {
    expect(illustrationIcon('mobile-phone')).toBe('phone');
    expect(illustrationIcon('headset')).toBe('headset');
    expect(illustrationIcon('printer')).toBe('printer');
    expect(illustrationIcon('monitor')).toBe('monitor');
    expect(illustrationIcon('desktop')).toBe('desktop');
    expect(illustrationIcon('cable')).toBe('other');
    expect(illustrationIcon(null)).toBe('other');
  });
});

describe('deviceHealthTiles', () => {
  const hw = {
    manufacturer: 'LENOVO',
    modelName: '21J5',
    cpu: 'i7',
    cpuCores: 8,
    ramGb: '16.0',
    ramSlotsUsed: 1,
    ramSlotsTotal: 2,
    storageTotalGb: '512.0',
    storageFreeGb: '128.0',
    smartStatus: 'HEALTHY' as const,
    batteryHealthPct: 72,
    batteryCycleCount: 310,
    gpu: null,
    biosVersion: null,
  };

  it('derives disk usage from total and free, and never invents a usage figure', () => {
    const tiles = deviceHealthTiles(hw, null);
    const disk = tiles.find((t) => t.key === 'disk');
    expect(disk).toMatchObject({
      value: '384 / 512 GB',
      hint: '128 GB free',
      percent: 75,
      tone: 'warning',
    });
    // Installed memory is what the agent reports - labelled as such.
    expect(tiles.find((t) => t.key === 'memory')).toMatchObject({
      label: 'Memory installed',
      value: '16 GB',
      hint: '1 of 2 slots used',
    });
    expect(tiles.find((t) => t.key === 'battery')).toMatchObject({
      value: '72%',
      tone: 'warning',
      hint: '310 cycles',
    });
    expect(tiles.find((t) => t.key === 'smart')).toMatchObject({
      value: 'healthy',
      tone: 'success',
    });
  });

  it('omits tiles whose fields the agent did not report', () => {
    const tiles = deviceHealthTiles(
      { ...hw, storageFreeGb: null, batteryHealthPct: null, smartStatus: null },
      null,
    );
    expect(tiles.map((t) => t.key)).toEqual(['memory']);
    expect(deviceHealthTiles(null, null)).toEqual([]);
  });

  it('measures uptime to the report, not to now', () => {
    const tiles = deviceHealthTiles(null, {
      lastBootAt: '2026-09-01T00:00:00Z',
      lastDiscoveredAt: '2026-09-03T04:30:00Z',
    });
    expect(tiles).toEqual([
      { key: 'uptime', label: 'Uptime', value: '2d 4h', hint: 'at last report' },
    ]);
  });

  it('formats uptime in the two largest units', () => {
    expect(formatUptime(5 * 3_600_000 + 12 * 60_000)).toBe('5h 12m');
    expect(formatUptime(42 * 60_000)).toBe('42m');
    expect(formatUptime(-5)).toBe('0m');
  });
});

describe('latestAgentReport', () => {
  it('picks the newer of the two snapshots and is null with none', () => {
    expect(
      latestAgentReport(
        { source: 'AGENT', lastDiscoveredAt: '2026-09-10T00:00:00Z' },
        { source: 'INTUNE', lastDiscoveredAt: '2026-09-12T00:00:00Z' },
      ),
    ).toEqual({ at: '2026-09-12T00:00:00Z', source: 'INTUNE' });
    expect(latestAgentReport(null, undefined)).toBeNull();
  });
});

describe('overview card helpers', () => {
  it('reads the condition as a sentence', () => {
    expect(conditionSentence('GOOD')).toBe('Device is in good condition.');
    expect(conditionSentence('WHATEVER')).toBe('Condition recorded.');
  });

  it('prefers agent values for quick specs and falls back to the typed specification', () => {
    expect(
      quickSpecs({
        hw: { cpu: 'Intel i7-1360P', ramGb: '32.0' },
        os: { osName: 'Windows 11 Pro', osVersion: '23H2' },
        specs: { cpu: 'typed', ramGb: '16', os: 'typed os' },
        assetTag: 'LT-001',
      }),
    ).toEqual([
      { label: 'Processor', value: 'Intel i7-1360P' },
      { label: 'RAM', value: '32 GB' },
      { label: 'OS', value: 'Windows 11 Pro 23H2' },
      { label: 'Asset tag', value: 'LT-001' },
    ]);
    expect(quickSpecs({ hw: null, os: null, specs: { ramGb: '8' }, assetTag: 'MN-2' })).toEqual([
      { label: 'RAM', value: '8 GB' },
      { label: 'Asset tag', value: 'MN-2' },
    ]);
  });

  it('builds the header meta line and skips what is missing', () => {
    expect(
      headerMeta({
        brand: 'Lenovo',
        model: 'ThinkPad P14s',
        typeName: 'Laptop',
        holderName: 'Gurpreet Singh',
      }),
    ).toEqual(['Lenovo ThinkPad P14s', 'Laptop', 'Assigned to Gurpreet Singh']);
    expect(headerMeta({ brand: null, model: null, typeName: null, holderName: null })).toEqual([
      'Unassigned',
    ]);
  });

  it('summarises the notes to their first non-empty line', () => {
    expect(noteSummary('\n  Warranty out · Problem noted: hinge loose\nmore')).toBe(
      'Warranty out · Problem noted: hinge loose',
    );
    expect(noteSummary('x'.repeat(200), 20)).toHaveLength(20);
    expect(noteSummary('   ')).toBeNull();
    expect(noteSummary(null)).toBeNull();
  });
});
