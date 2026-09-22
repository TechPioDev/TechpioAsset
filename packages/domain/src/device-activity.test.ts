import { describe, expect, it } from 'vitest';
import { formatUptime } from './asset-overview';
import { deviceActiveUser, deviceUptime, displayAccount } from './device-activity';

const NOW = new Date('2026-09-22T10:00:00Z').getTime();
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe('uptime, as the agent last reported it', () => {
  it('formats a duration the way people say it', () => {
    expect(formatUptime(45 * 60_000)).toBe('45m');
    expect(formatUptime((5 * 60 + 12) * 60_000)).toBe('5h 12m');
    expect(formatUptime((3 * 24 + 4) * 3_600_000)).toBe('3d 4h');
  });

  it('measures up to the report, not up to now', () => {
    const up = deviceUptime({ lastBootAt: hoursAgo(80), reportedAt: hoursAgo(3) }, NOW);
    expect(up).toEqual({ label: 'Up 3d 5h', detail: 'Reported 3 hours ago', tone: 'active' });
  });

  it('says so when the report is ageing, and refuses to guess when it is stale', () => {
    expect(deviceUptime({ lastBootAt: hoursAgo(80), reportedAt: hoursAgo(50) }, NOW)).toEqual({
      label: 'Up 1d 6h',
      detail: 'As of 2 days ago',
      tone: 'ageing',
    });
    expect(deviceUptime({ lastBootAt: hoursAgo(80), reportedAt: hoursAgo(24 * 22) }, NOW)).toEqual({
      label: 'Not reporting',
      detail: 'Last seen 22 days ago',
      tone: 'stale',
    });
  });

  it('is honest about a machine with no agent at all', () => {
    expect(deviceUptime({}, NOW)).toEqual({ label: '—', detail: 'No agent report', tone: 'none' });
  });
});

describe('who is signed in', () => {
  it('reads a Windows account the way a person does', () => {
    expect(displayAccount('TECHPIO\\ravi')).toBe('ravi');
    expect(displayAccount('AzureAD\\Ravi Menon')).toBe('Ravi Menon');
    expect(displayAccount('ravi@techpio.com')).toBe('ravi@techpio.com');
  });

  it('names the user from a fresh report', () => {
    const who = deviceActiveUser(
      { activeUser: 'TECHPIO\\ravi', activeUserAt: hoursAgo(3), reportedAt: hoursAgo(3) },
      NOW,
    );
    expect(who).toEqual({ label: 'ravi', detail: 'Signed in at last report, 3 hours ago', tone: 'active' });
  });

  it('tells "nobody signed in" apart from "the agent is too old to say"', () => {
    expect(
      deviceActiveUser({ activeUser: null, activeUserAt: hoursAgo(3), reportedAt: hoursAgo(3) }, NOW),
    ).toMatchObject({ label: 'Nobody signed in', tone: 'active' });
    expect(deviceActiveUser({ activeUser: null, activeUserAt: null, reportedAt: hoursAgo(3) }, NOW)).toEqual({
      label: '—',
      detail: 'Needs agent 1.2.0',
      tone: 'none',
    });
  });

  it('never names somebody from a stale report', () => {
    expect(
      deviceActiveUser(
        { activeUser: 'TECHPIO\\ravi', activeUserAt: hoursAgo(24 * 30), reportedAt: hoursAgo(24 * 30) },
        NOW,
      ),
    ).toMatchObject({ label: 'Not reporting', tone: 'stale' });
  });
});
