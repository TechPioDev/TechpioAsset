/**
 * Minimal 5-field cron next-run computation (spec section 18 scheduled reports).
 *
 * Supports the fields most schedules need: `*`, a single number, and step
 * values (`* / n`). Pure and testable; a full cron library would add a
 * dependency for functionality the spec's scheduled reports do not require.
 *
 * Fields: minute hour day-of-month month day-of-week.
 */

interface CronFields {
  minute: (n: number) => boolean;
  hour: (n: number) => boolean;
  dayOfMonth: (n: number) => boolean;
  month: (n: number) => boolean;
  dayOfWeek: (n: number) => boolean;
}

function matcher(field: string, min: number, max: number): (n: number) => boolean {
  if (field === '*') return () => true;

  const stepMatch = /^\*\/(\d+)$/.exec(field);
  if (stepMatch) {
    const step = Number(stepMatch[1]);
    return (n) => step > 0 && (n - min) % step === 0;
  }

  const listValues = field.split(',').map(Number);
  if (listValues.every((v) => Number.isInteger(v) && v >= min && v <= max)) {
    const set = new Set(listValues);
    return (n) => set.has(n);
  }

  // Unrecognised field never matches, which is safer than matching everything.
  return () => false;
}

export function parseCron(expression: string): CronFields | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  return {
    minute: matcher(minute, 0, 59),
    hour: matcher(hour, 0, 23),
    dayOfMonth: matcher(dayOfMonth, 1, 31),
    month: matcher(month, 1, 12),
    dayOfWeek: matcher(dayOfWeek, 0, 6),
  };
}

/** Wall-clock parts of an instant in a zone. One formatter per zone, reused. */
const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function wallClock(instant: Date, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    minute: Number(get('minute')),
    hour: Number(get('hour')),
    day: Number(get('day')),
    month: Number(get('month')),
    weekday: WEEKDAYS[get('weekday')] ?? -1,
  };
}

/**
 * Next time after `from` that the expression fires, with the fields read as the
 * wall clock in `timeZone` (an IANA name; the company's). Returns null for an
 * invalid expression, an unknown zone, or nothing within a year.
 *
 * The fields were read in the server's own zone before, which in the container
 * is UTC - so "09:00" for an Indian company went out at 14:30 there, while the
 * contract said "evaluated in the company timezone".
 *
 * Walks forward in real minutes, jumping to the next hour when the date or hour
 * cannot match. Every zone's offset is a whole number of minutes, so a jump of
 * the minutes left in the local hour lands exactly on its boundary, and
 * daylight-saving shifts move whole hours. On a spring-forward day a local time
 * that does not exist never fires; on a fall-back day the first of the two
 * occurrences does.
 */
export function nextCronRun(expression: string, from: Date, timeZone = 'UTC'): Date | null {
  const fields = parseCron(expression);
  if (!fields) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    return null;
  }

  const candidate = new Date(from);
  candidate.setUTCSeconds(0, 0);
  candidate.setTime(candidate.getTime() + 60_000);

  const limit = from.getTime() + 366 * 86_400_000;
  while (candidate.getTime() <= limit) {
    const local = wallClock(candidate, timeZone);
    const dateMatches =
      fields.dayOfMonth(local.day) && fields.month(local.month) && fields.dayOfWeek(local.weekday);
    if (!dateMatches || !fields.hour(local.hour)) {
      candidate.setTime(candidate.getTime() + (60 - local.minute) * 60_000);
      continue;
    }
    if (fields.minute(local.minute)) return new Date(candidate);
    candidate.setTime(candidate.getTime() + 60_000);
  }
  return null;
}
