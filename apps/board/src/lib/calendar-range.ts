export type CalendarMode = 'month' | 'week';

export type CalendarRange = {
  start: Date;
  end: Date;
  days: Date[];
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function startOfLocalDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function endOfLocalDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

export function addLocalDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

/** Adds calendar months while clamping the day to the destination month's last day. */
export function addLocalMonths(date: Date, amount: number): Date {
  const result = new Date(date);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + amount);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

export function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Parses a date-only value as a local calendar date, never as UTC midnight. */
export function parseLocalDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const result = new Date(0);
  result.setFullYear(year, month - 1, day);
  result.setHours(0, 0, 0, 0);
  if (
    result.getFullYear() !== year ||
    result.getMonth() !== month - 1 ||
    result.getDate() !== day
  ) {
    return null;
  }
  return result;
}

/** Date-only fields stay on their written day; timestamps use the viewer's local day. */
export function calendarRecordDay(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : formatLocalDate(value);
  }
  if (typeof value !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    const parsed = parseLocalDateOnly(value);
    return parsed ? formatLocalDate(parsed) : null;
  }
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : formatLocalDate(timestamp);
}

export function navigateCalendar(
  cursor: Date,
  direction: -1 | 1,
  mode: CalendarMode
): Date {
  return mode === 'month' ? addLocalMonths(cursor, direction) : addLocalDays(cursor, direction * 7);
}

export function buildCalendarRange(cursor: Date, mode: CalendarMode): CalendarRange {
  let rangeStart = startOfLocalDay(cursor);
  let rangeEnd: Date;
  let gridStart: Date;
  let dayCount: number;

  if (mode === 'month') {
    rangeStart.setDate(1);
    rangeEnd = endOfLocalDay(
      new Date(rangeStart.getFullYear(), rangeStart.getMonth() + 1, 0)
    );
    gridStart = addLocalDays(rangeStart, -rangeStart.getDay());
    dayCount = 42;
  } else {
    gridStart = addLocalDays(rangeStart, -rangeStart.getDay());
    rangeStart = gridStart;
    rangeEnd = endOfLocalDay(addLocalDays(gridStart, 6));
    dayCount = 7;
  }

  const days = Array.from({ length: dayCount }, (_, index) => addLocalDays(gridStart, index));
  return { start: rangeStart, end: rangeEnd, days };
}
