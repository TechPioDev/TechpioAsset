import { describe, expect, it } from 'vitest';
import {
  assetDetailTabs,
  assetIdentifier,
  conditionPhotosEmptyMessage,
  custodyOptions,
  assetSpecRows,
  custodyHistory,
  deviceLifecycle,
  hardwareRows,
  hasDiscoveryTabs,
  healthDimensionLabel,
  healthSubScoreTone,
  humanDuration,
  issuedByName,
  calendarMonthsBetween,
  osRows,
  relativeAge,
  reportFreshness,
  reportFreshnessWording,
  securityPostureRows,
  type HardwareSnapshot,
  type OsSnapshot,
} from './asset-detail';

/**
 * The asset page's wording, pinned. The web and the phone both render these
 * strings; if one changes here it changes for both, and a test says so.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-09-14T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const iso = (d: string) => new Date(d).toISOString();
const fmt = (v: string | null) => (v ? v.slice(0, 10) : '—');

describe('how the age of a report reads', () => {
  it('says "just now" under an hour, never "0 hours ago"', () => {
    expect(relativeAge(ago(30_000), NOW)).toBe('just now');
    expect(relativeAge(ago(30 * MINUTE), NOW)).toBe('just now');
    expect(relativeAge(ago(61 * MINUTE), NOW)).toBe('1 hour ago');
    expect(relativeAge(ago(3 * HOUR), NOW)).toBe('3 hours ago');
  });

  it('counts in days after that, singular where it should be', () => {
    expect(relativeAge(ago(1 * DAY), NOW)).toBe('1 day ago');
    expect(relativeAge(ago(18 * DAY), NOW)).toBe('18 days ago');
  });

  it('defaults to the current clock', () => {
    expect(relativeAge(new Date(Date.now() - 8 * DAY).toISOString())).toBe('8 days ago');
  });

  it('turns stale at seven days and ageing at two', () => {
    expect(reportFreshness(ago(1 * DAY), NOW)).toBe('fresh');
    expect(reportFreshness(ago(2 * DAY), NOW)).toBe('ageing');
    expect(reportFreshness(ago(6.9 * DAY), NOW)).toBe('ageing');
    expect(reportFreshness(ago(7 * DAY), NOW)).toBe('stale');
  });

  it('writes the banner: a warning when stale, one quiet line otherwise', () => {
    expect(reportFreshnessWording('AGENT', ago(18 * DAY), '27/08/2026, 10:00', NOW)).toEqual({
      freshness: 'stale',
      headline: 'This machine last reported 18 days ago.',
      detail:
        'What follows is a snapshot from 27/08/2026, 10:00, not its current state — the agent has stopped checking in, so anything changed since then is not shown here.',
    });
    expect(reportFreshnessWording('AGENT', ago(3 * HOUR), 'EXACT', NOW)).toEqual({
      freshness: 'fresh',
      headline: 'Reported by agent 3 hours ago · EXACT',
      detail: null,
    });
  });
});

describe('which tabs an asset shows', () => {
  const empty = { hardwareProfile: null, osInfo: null, health: null, _count: { installedSoftware: 0 } };

  it('hides the agent tabs for a type no agent reports, unless data exists', () => {
    expect(hasDiscoveryTabs({ ...empty, subcategory: { key: 'headset' } })).toBe(false);
    expect(hasDiscoveryTabs({ ...empty, subcategory: { key: 'headset' }, _count: { installedSoftware: 3 } })).toBe(
      true,
    );
    expect(hasDiscoveryTabs({ ...empty, subcategory: { key: 'laptop' } })).toBe(true);
    // No type recorded: shown, because hiding real data is the worse mistake.
    expect(hasDiscoveryTabs({ ...empty, subcategory: null })).toBe(true);
  });

  it('lists them in the web order, with the software count and cost gate', () => {
    expect(assetDetailTabs({ showDiscovery: true, softwareCount: 142, canSeeCost: true }).map((t) => t.label)).toEqual([
      'Overview',
      'Lifecycle',
      'Hardware',
      'OS & Security',
      'Software (142)',
      'Health',
      'History',
      'Financials',
    ]);
    expect(assetDetailTabs({ showDiscovery: true, softwareCount: 0, canSeeCost: false }).map((t) => t.label)).toEqual([
      'Overview',
      'Lifecycle',
      'Hardware',
      'OS & Security',
      'Software',
      'Health',
      'History',
    ]);
    expect(assetDetailTabs({ showDiscovery: false, softwareCount: 0, canSeeCost: false }).map((t) => t.key)).toEqual([
      'overview',
      'lifecycle',
      'history',
    ]);
  });
});

describe('overview helpers', () => {
  it('names who issued the open assignment only', () => {
    expect(
      issuedByName([
        { returnedAt: null, assignedBy: { profile: { firstName: 'Asha', lastName: 'Rao' } } },
        { returnedAt: '2026-01-01', assignedBy: { profile: { firstName: 'Old', lastName: 'Admin' } } },
      ]),
    ).toBe('Asha Rao');
    expect(issuedByName([{ returnedAt: null, assignedBy: null }])).toBeNull();
    expect(issuedByName([])).toBeNull();
  });

  it('labels specs from the catalogue in field order, units included', () => {
    const out = assetSpecRows('laptop', { os: 'Windows 11', ramGb: '16', junk: 'x' });
    expect(out.title).toBe('Laptop');
    expect(out.rows).toEqual([
      ['RAM (GB)', '16'],
      ['Operating system', 'Windows 11'],
    ]);
    expect(assetSpecRows(null, { colour: 'Black' })).toEqual({ title: 'Specification', rows: [['colour', 'Black']] });
    expect(assetSpecRows('laptop', null).rows).toEqual([]);
  });
});

describe('hardware and OS rows', () => {
  const hw: HardwareSnapshot = {
    manufacturer: 'LENOVO',
    modelName: 'ThinkPad E14',
    cpu: 'Intel Core i5',
    cpuCores: 8,
    ramGb: '16',
    ramSlotsUsed: null,
    ramSlotsTotal: 2,
    storageTotalGb: '512',
    storageFreeGb: null,
    smartStatus: 'WARNING',
    batteryHealthPct: 87,
    batteryCycleCount: null,
    gpu: null,
    biosVersion: 'R1.2',
  };

  it('formats the snapshot the way the web did', () => {
    const rows = Object.fromEntries(hardwareRows(hw).map((r) => [r.label, r]));
    expect(Object.keys(rows)).toEqual([
      'Manufacturer',
      'Model',
      'Processor',
      'Cores',
      'Memory',
      'Memory slots',
      'Storage',
      'Free space',
      'Drive (SMART)',
      'Battery',
      'Battery cycles',
      'Graphics',
      'BIOS',
    ]);
    expect(rows['Cores']!.value).toBe('8');
    expect(rows['Memory']!.value).toBe('16 GB');
    expect(rows['Memory slots']!.value).toBe('? of 2 used');
    expect(rows['Free space']!.value).toBeNull();
    expect(rows['Drive (SMART)']).toEqual({ label: 'Drive (SMART)', value: 'warning', tone: 'warning' });
    expect(rows['Battery']!.value).toBe('87% health');
    expect(rows['Battery cycles']!.value).toBeNull();
  });

  const os: OsSnapshot = {
    osName: 'Windows 11 Pro',
    osVersion: '23H2',
    osBuild: null,
    osSupported: false,
    osActivated: null,
    lastBootAt: '2026-09-01T08:00:00Z',
    diskEncrypted: true,
    defenderEnabled: false,
    firewallEnabled: null,
    tpmPresent: false,
    localAdminCount: 3,
    missingCriticalPatches: 0,
  };

  it('reads support and activation as badges, unknown as a dash', () => {
    const rows = osRows(os, () => 'BOOT');
    expect(rows.find((r) => r.label === 'Support')).toEqual({
      label: 'Support',
      value: 'out of support',
      tone: 'critical',
    });
    expect(rows.find((r) => r.label === 'Activation')).toEqual({ label: 'Activation', value: null });
    expect(rows.find((r) => r.label === 'Last boot')!.value).toBe('BOOT');
  });

  it('says "not reported" rather than guessing a posture', () => {
    expect(securityPostureRows(os)).toEqual([
      { label: 'Disk encryption', state: { text: 'on', tone: 'success' } },
      { label: 'Antivirus', state: { text: 'off', tone: 'critical' } },
      { label: 'Firewall', state: null },
      { label: 'TPM', state: { text: 'missing', tone: 'critical' } },
      { label: 'Local administrators', state: { text: '3', tone: 'critical' } },
      { label: 'Missing critical updates', state: { text: '0', tone: 'success' } },
    ]);
  });
});

describe('health wording', () => {
  it('labels dimensions and colours bars at 75 / 40', () => {
    expect(healthDimensionLabel('battery')).toBe('Battery');
    expect(healthDimensionLabel('mystery')).toBe('mystery');
    expect(healthSubScoreTone(75)).toBe('success');
    expect(healthSubScoreTone(74)).toBe('warning');
    expect(healthSubScoreTone(40)).toBe('warning');
    expect(healthSubScoreTone(39)).toBe('critical');
  });
});

describe('history and lifecycle', () => {
  const data = {
    purchaseDate: iso('2024-01-10'),
    warrantyStartDate: null,
    warrantyEndDate: iso('2027-03-10'),
    expectedReplacementDate: null,
    assignmentCount: 4,
    assignments: [
      {
        id: 'a2',
        assignedAt: iso('2026-02-01'),
        returnedAt: null,
        assignedBy: { profile: { firstName: 'Asha', lastName: 'Rao' } },
        user: { email: 'n@x.com', profile: { firstName: 'Narvada', lastName: 'S' } },
        assetReturn: null,
      },
      {
        id: 'a1',
        assignedAt: iso('2025-01-01'),
        returnedAt: iso('2026-01-15'),
        assignedBy: null,
        user: null,
        assetReturn: { conditionIn: 'FAIR', damageNotes: 'Cracked hinge' },
      },
    ],
    conditionLogs: [
      {
        id: 'l1',
        recordedAt: iso('2026-01-15'),
        previousStatus: 'ASSIGNED',
        newStatus: 'AVAILABLE',
        previousCondition: 'GOOD',
        newCondition: 'FAIR',
        reason: 'Returned',
      },
      {
        id: 'l2',
        recordedAt: iso('2026-01-20'),
        previousStatus: null,
        newStatus: null,
        previousCondition: null,
        newCondition: null,
        reason: null,
      },
    ],
  };

  it('writes the custody history lines', () => {
    const out = custodyHistory(data, (v) => v.slice(0, 10));
    expect(out.map((e) => [e.title, e.date, e.suffix, e.note])).toEqual([
      ['Assigned to Narvada S', '2026-02-01', ' · issued by Asha Rao', null],
      ['Returned by someone', '2026-01-15', '', 'Cracked hinge'],
      ['ASSIGNED → AVAILABLE', '2026-01-15', '', 'Returned'],
      ['Status change', '2026-01-20', '', null],
    ]);
  });

  it('tells the device story oldest first with the real assignment count', () => {
    const out = deviceLifecycle(data, fmt, new Date('2026-09-14T00:00:00Z'));
    expect(out.timesAssigned).toBe(4);
    expect(out.chips).toEqual([
      { label: 'Purchased', value: '2024-01-10' },
      { label: 'Asset age', value: '2 yrs 8 mo' },
      { label: 'Warranty', value: '6 mo left' },
      { label: 'Expected replacement', value: '—' },
      { label: 'Times assigned', value: '4' },
    ]);
    expect(out.events.map((e) => [e.title, e.detail])).toEqual([
      ['Purchased', undefined],
      ['Assigned', 'to a team member'],
      ['Returned', 'condition: fair'],
      ['Status update', 'assigned → available · condition fair · Returned'],
      ['Status update', undefined],
      ['Assigned to you', undefined],
      ['Warranty ends', undefined],
    ]);
  });

  it('says expired once the warranty has passed', () => {
    const out = deviceLifecycle({ ...data, warrantyEndDate: iso('2026-01-01') }, fmt, new Date('2026-09-14'));
    expect(out.chips.find((c) => c.label === 'Warranty')!.value).toBe('Expired');
    expect(out.events.find((e) => e.title.startsWith('Warranty'))).toMatchObject({
      title: 'Warranty ended',
      tone: 'critical',
    });
  });

  it('measures durations in whole months', () => {
    expect(calendarMonthsBetween(new Date('2026-01-31'), new Date('2026-02-01'))).toBe(1);
    expect(calendarMonthsBetween(new Date('2026-05-01'), new Date('2026-01-01'))).toBe(0);
    expect(humanDuration(0)).toBe('—');
    expect(humanDuration(12)).toBe('1 yr');
    expect(humanDuration(27)).toBe('2 yrs 3 mo');
  });
});

describe('custody, photos and kit wording', () => {
  it('offers custody moves the way the web panel does', () => {
    const all = { canAssign: true, canReturn: true };
    expect(custodyOptions({ ...all, status: 'AVAILABLE', isHeld: false })).toEqual({
      show: true,
      assign: true,
      handOver: false,
      recordReturn: false,
    });
    expect(custodyOptions({ ...all, status: 'IN_USE', isHeld: true })).toEqual({
      show: true,
      assign: false,
      handOver: true,
      recordReturn: true,
    });
    // Return-only right: no hand over, which needs both halves.
    expect(custodyOptions({ canAssign: false, canReturn: true, status: 'ASSIGNED', isHeld: true }).handOver).toBe(false);
    // Unheld and under repair: nothing to offer at all.
    expect(custodyOptions({ ...all, status: 'UNDER_REPAIR', isHeld: false }).show).toBe(false);
    expect(custodyOptions({ canAssign: false, canReturn: false, status: 'AVAILABLE', isHeld: false }).show).toBe(false);
  });

  it('explains an empty photo record by whether a handover exists', () => {
    expect(conditionPhotosEmptyMessage(true, 'Asha')).toBe('No photos recorded yet.');
    expect(conditionPhotosEmptyMessage(false, 'Asha')).toMatch(/^Recorded as being with Asha, but never handed over/);
    expect(conditionPhotosEmptyMessage(false, null)).toMatch(/^Photos attach to a handover or a return/);
  });

  it('identifies kit by serial, then IMEI, then MAC', () => {
    expect(assetIdentifier({ serialNumber: 'S1', imei: 'I1' })).toEqual({ label: 'SN', value: 'S1' });
    expect(assetIdentifier({ serialNumber: null, imei: 'I1', macAddress: 'M1' })).toEqual({ label: 'IMEI', value: 'I1' });
    expect(assetIdentifier({ macAddress: 'M1' })).toEqual({ label: 'MAC', value: 'M1' });
    expect(assetIdentifier({})).toBeNull();
  });
});
