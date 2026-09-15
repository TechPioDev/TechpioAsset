import { describe, it, expect } from 'vitest';
import { parseCron, nextCronRun } from './cron.js';

// Instants are written in UTC and results compared as ISO strings, so the test
// means the same thing on any machine. The old tests used local Date getters
// and passed only because the code read the machine's zone too.

describe('parseCron', () => {
  it('accepts a valid 5-field expression', () => {
    expect(parseCron('0 9 * * 1')).not.toBeNull();
  });

  it('rejects the wrong number of fields', () => {
    expect(parseCron('0 9 * *')).toBeNull();
    expect(parseCron('0 9 * * 1 6')).toBeNull();
  });
});

describe('nextCronRun in UTC', () => {
  it('finds the next daily 09:00', () => {
    expect(nextCronRun('0 9 * * *', new Date('2026-07-01T08:00:00Z'))?.toISOString()).toBe(
      '2026-07-01T09:00:00.000Z',
    );
  });

  it('rolls to the next day when today’s time has passed', () => {
    expect(nextCronRun('0 9 * * *', new Date('2026-07-01T10:00:00Z'))?.toISOString()).toBe(
      '2026-07-02T09:00:00.000Z',
    );
  });

  it('finds the next Monday for a weekday schedule', () => {
    // 2026-07-01 is a Wednesday; the next Monday is the 6th.
    expect(nextCronRun('0 9 * * 1', new Date('2026-07-01T00:00:00Z'))?.toISOString()).toBe(
      '2026-07-06T09:00:00.000Z',
    );
  });

  it('handles a step expression (every 15 minutes)', () => {
    expect(nextCronRun('*/15 * * * *', new Date('2026-07-01T10:07:00Z'))?.toISOString()).toBe(
      '2026-07-01T10:15:00.000Z',
    );
  });

  it('is strictly after `from`, so a run cannot schedule itself again', () => {
    expect(nextCronRun('0 9 * * *', new Date('2026-07-01T09:00:00Z'))?.toISOString()).toBe(
      '2026-07-02T09:00:00.000Z',
    );
  });

  it('returns null for an invalid expression or an unknown zone', () => {
    expect(nextCronRun('nonsense', new Date())).toBeNull();
    expect(nextCronRun('0 9 * * *', new Date(), 'Mars/Olympus_Mons')).toBeNull();
  });
});

describe('nextCronRun in the company timezone', () => {
  it('reads 09:00 as India time: 03:30 UTC', () => {
    expect(
      nextCronRun('0 9 * * *', new Date('2026-09-15T00:00:00Z'), 'Asia/Kolkata')?.toISOString(),
    ).toBe('2026-09-15T03:30:00.000Z');
  });

  it('uses the local date for the day of the week, not the UTC one', () => {
    // 2026-09-14 20:00 UTC is already Tuesday 01:30 in India. A Monday-09:00
    // report must go to the following Monday, not fire "today".
    expect(
      nextCronRun('0 9 * * 1', new Date('2026-09-14T20:00:00Z'), 'Asia/Kolkata')?.toISOString(),
    ).toBe('2026-09-21T03:30:00.000Z');
  });

  it('handles the first of the month at local midnight', () => {
    expect(
      nextCronRun('0 0 1 * *', new Date('2026-09-15T00:00:00Z'), 'Asia/Kolkata')?.toISOString(),
    ).toBe('2026-09-30T18:30:00.000Z');
  });

  it('follows British Summer Time ending: 09:00 moves from 08:00 UTC to 09:00 UTC', () => {
    // BST ends 2026-10-25 at 02:00 local.
    const before = nextCronRun('0 9 * * *', new Date('2026-10-24T00:00:00Z'), 'Europe/London');
    const after = nextCronRun('0 9 * * *', new Date('2026-10-25T00:00:00Z'), 'Europe/London');
    expect(before?.toISOString()).toBe('2026-10-24T08:00:00.000Z');
    expect(after?.toISOString()).toBe('2026-10-25T09:00:00.000Z');
  });

  it('skips a local time that does not exist on the spring-forward day', () => {
    // 2027-03-28 01:00 -> 02:00 in London: 01:30 never happens that day.
    expect(
      nextCronRun('30 1 * * *', new Date('2027-03-28T00:00:00Z'), 'Europe/London')?.toISOString(),
    ).toBe('2027-03-29T00:30:00.000Z');
  });

  it('keeps step minutes aligned in a half-hour zone', () => {
    expect(
      nextCronRun('*/15 * * * *', new Date('2026-09-15T00:07:00Z'), 'Asia/Kolkata')?.toISOString(),
    ).toBe('2026-09-15T00:15:00.000Z');
  });
});
