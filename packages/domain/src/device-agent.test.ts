import { describe, expect, it } from 'vitest';
import {
  AGENT_ACTIVE_WINDOW_DAYS,
  AGENT_ONLINE_WINDOW_MINUTES,
  AGENT_REFRESH_REQUEST_TTL_HOURS,
  AGENT_STATUSES,
  AGENT_STATUS_LABELS,
  LATEST_AGENT_VERSION,
  agentRefreshRefusal,
  buildAgentInstallCommand,
  compareAgentVersions,
  deriveAgentStatus,
  isAgentOutdated,
  isRefreshPending,
} from './device-agent';

const NOW = new Date('2026-09-16T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe('deriveAgentStatus', () => {
  it('is ACTIVE when seen within the window', () => {
    expect(deriveAgentStatus({ lastSeenAt: daysAgo(1) }, NOW)).toBe('ACTIVE');
    expect(deriveAgentStatus({ lastSeenAt: daysAgo(AGENT_ACTIVE_WINDOW_DAYS) }, NOW)).toBe('ACTIVE');
  });

  it('is OFFLINE when not seen for longer than the window, with no rejection', () => {
    expect(deriveAgentStatus({ lastSeenAt: daysAgo(3.01) }, NOW)).toBe('OFFLINE');
    expect(deriveAgentStatus({ lastSeenAt: null }, NOW)).toBe('OFFLINE');
  });

  it('is CREDENTIAL_REJECTED when the last rejection is newer than the last accepted contact', () => {
    expect(
      deriveAgentStatus({ lastSeenAt: daysAgo(20), lastRejectedAt: daysAgo(1) }, NOW),
    ).toBe('CREDENTIAL_REJECTED');
    // Even a recently-seen device: refused after it was last accepted.
    expect(
      deriveAgentStatus({ lastSeenAt: daysAgo(2), lastRejectedAt: daysAgo(1) }, NOW),
    ).toBe('CREDENTIAL_REJECTED');
    expect(deriveAgentStatus({ lastSeenAt: null, lastRejectedAt: daysAgo(1) }, NOW)).toBe(
      'CREDENTIAL_REJECTED',
    );
  });

  it('treats a rejection older than the last accepted contact as healed', () => {
    expect(
      deriveAgentStatus({ lastSeenAt: daysAgo(1), lastRejectedAt: daysAgo(5) }, NOW),
    ).toBe('ACTIVE');
    expect(
      deriveAgentStatus({ lastSeenAt: daysAgo(10), lastRejectedAt: daysAgo(11) }, NOW),
    ).toBe('OFFLINE');
  });

  it('REVOKED wins over everything', () => {
    expect(
      deriveAgentStatus(
        { revokedAt: daysAgo(1), lastSeenAt: daysAgo(0), lastRejectedAt: daysAgo(0) },
        NOW,
      ),
    ).toBe('REVOKED');
  });

  it('accepts ISO strings as the web receives them', () => {
    expect(
      deriveAgentStatus(
        { lastSeenAt: daysAgo(9).toISOString(), lastRejectedAt: daysAgo(1).toISOString() },
        NOW,
      ),
    ).toBe('CREDENTIAL_REJECTED');
  });
});

describe('Online and Offline (agents that check in, 1.3.0+)', () => {
  const checksIn = { lastHeartbeatAt: daysAgo(30) };

  it('is ONLINE when heard from within the online window', () => {
    expect(deriveAgentStatus({ ...checksIn, lastSeenAt: minsAgo(1) }, NOW)).toBe('ONLINE');
    expect(
      deriveAgentStatus({ ...checksIn, lastSeenAt: minsAgo(AGENT_ONLINE_WINDOW_MINUTES) }, NOW),
    ).toBe('ONLINE');
  });

  it('is OFFLINE minutes after it goes quiet, not days', () => {
    // An older agent would still read "Reporting daily" here; this one is
    // supposed to call every five minutes, so silence means switched off.
    expect(
      deriveAgentStatus(
        { ...checksIn, lastSeenAt: minsAgo(AGENT_ONLINE_WINDOW_MINUTES + 1) },
        NOW,
      ),
    ).toBe('OFFLINE');
    expect(deriveAgentStatus({ ...checksIn, lastSeenAt: daysAgo(1) }, NOW)).toBe('OFFLINE');
  });

  it('never calls an older, once-a-day agent Online, however recent', () => {
    expect(deriveAgentStatus({ lastSeenAt: minsAgo(1) }, NOW)).toBe('ACTIVE');
    expect(deriveAgentStatus({ lastSeenAt: minsAgo(1), lastHeartbeatAt: null }, NOW)).toBe(
      'ACTIVE',
    );
  });

  it('still says Needs reinstall and Revoked first', () => {
    expect(
      deriveAgentStatus({ ...checksIn, lastSeenAt: minsAgo(30), lastRejectedAt: minsAgo(5) }, NOW),
    ).toBe('CREDENTIAL_REJECTED');
    expect(
      deriveAgentStatus({ ...checksIn, lastSeenAt: minsAgo(1), revokedAt: daysAgo(1) }, NOW),
    ).toBe('REVOKED');
  });

  it('has a plain label for every status', () => {
    for (const s of AGENT_STATUSES) expect(AGENT_STATUS_LABELS[s]).toBeTruthy();
    expect(AGENT_STATUS_LABELS.CREDENTIAL_REJECTED).toBe('Needs reinstall');
  });
});

describe('Refresh now', () => {
  it('is pending until the request ages out', () => {
    expect(isRefreshPending(null, NOW)).toBe(false);
    expect(isRefreshPending(minsAgo(3), NOW)).toBe(true);
    expect(isRefreshPending(daysAgo(AGENT_REFRESH_REQUEST_TTL_HOURS / 24 - 0.1), NOW)).toBe(true);
    expect(isRefreshPending(daysAgo(AGENT_REFRESH_REQUEST_TTL_HOURS / 24 + 0.1), NOW)).toBe(false);
  });

  it('works only for an agent that checks in and is not revoked', () => {
    expect(agentRefreshRefusal({ lastHeartbeatAt: minsAgo(1) })).toBeNull();
    expect(agentRefreshRefusal({ lastHeartbeatAt: minsAgo(1), revokedAt: daysAgo(1) })).toMatch(
      /revoked/,
    );
  });

  it('tells an older agent what to do, in words', () => {
    const why = agentRefreshRefusal({ lastHeartbeatAt: null, agentVersion: '1.0.0' });
    expect(why).toMatch(/agent 1\.0\.0/);
    expect(why).toMatch(/once a day/);
    expect(why).toMatch(/Copy fix command/);
  });
});

describe('agent versions', () => {
  it('compares numerically, not lexically', () => {
    expect(compareAgentVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareAgentVersions('1.0.0', '1.1.0')).toBe(-1);
    expect(compareAgentVersions('v1.1', '1.1.0')).toBe(0);
  });

  it('flags older and unknown versions as outdated', () => {
    expect(LATEST_AGENT_VERSION).toBe('1.3.0');
    expect(isAgentOutdated('1.0.0')).toBe(true);
    expect(isAgentOutdated(null)).toBe(true);
    expect(isAgentOutdated('')).toBe(true);
    expect(isAgentOutdated('1.3.0')).toBe(false);
    expect(isAgentOutdated('1.2.1')).toBe(true);
    expect(isAgentOutdated('1.1.0')).toBe(true);
    expect(isAgentOutdated('1.2.0')).toBe(true);
  });
});

describe('buildAgentInstallCommand', () => {
  it('builds the elevated one-liner with the token and portal filled in', () => {
    expect(
      buildAgentInstallCommand({
        scriptUrl: 'https://pioassets.com/downloads/TechpioAgent.ps1',
        portalUrl: 'https://pioassets.com/api/v1',
        enrolmentToken: 'tae_abc',
      }),
    ).toBe(
      'iwr -useb https://pioassets.com/downloads/TechpioAgent.ps1 -OutFile $env:TEMP\\TechpioAgent.ps1; ' +
        'powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\\TechpioAgent.ps1 ' +
        '-PortalUrl https://pioassets.com/api/v1 -EnrolmentToken tae_abc -Install',
    );
  });
});
