import { describe, expect, it } from 'vitest';
import {
  AGENT_ACTIVE_WINDOW_DAYS,
  LATEST_AGENT_VERSION,
  buildAgentInstallCommand,
  compareAgentVersions,
  deriveAgentStatus,
  isAgentOutdated,
} from './device-agent';

const NOW = new Date('2026-09-16T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

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

describe('agent versions', () => {
  it('compares numerically, not lexically', () => {
    expect(compareAgentVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareAgentVersions('1.0.0', '1.1.0')).toBe(-1);
    expect(compareAgentVersions('v1.1', '1.1.0')).toBe(0);
  });

  it('flags older and unknown versions as outdated', () => {
    expect(LATEST_AGENT_VERSION).toBe('1.2.1');
    expect(isAgentOutdated('1.0.0')).toBe(true);
    expect(isAgentOutdated(null)).toBe(true);
    expect(isAgentOutdated('')).toBe(true);
    expect(isAgentOutdated('1.2.1')).toBe(false);
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
