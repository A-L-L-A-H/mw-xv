import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addLocalDays,
  addLocalMonths,
  buildCalendarRange,
  calendarRecordDay,
  formatLocalDate,
  navigateCalendar,
  parseLocalDateOnly,
} from '../../apps/board/src/lib/calendar-range.ts';

function localDate(year, month, day, hour = 12) {
  return new Date(year, month - 1, day, hour);
}

function withTimeZone(timeZone, callback) {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

test('month ranges cover the whole month and a Sunday-leading 42-day grid', () => {
  const range = buildCalendarRange(localDate(2024, 1, 15), 'month');
  assert.equal(formatLocalDate(range.start), '2024-01-01');
  assert.equal(formatLocalDate(range.end), '2024-01-31');
  assert.equal(range.start.getHours(), 0);
  assert.equal(range.end.getHours(), 23);
  assert.equal(range.days.length, 42);
  assert.equal(formatLocalDate(range.days[0]), '2023-12-31');
  assert.equal(formatLocalDate(range.days.at(-1)), '2024-02-10');
});

test('leap-day and year-boundary months use real calendar arithmetic', () => {
  const leap = buildCalendarRange(localDate(2024, 2, 10), 'month');
  assert.equal(formatLocalDate(leap.end), '2024-02-29');
  assert.equal(formatLocalDate(leap.days[0]), '2024-01-28');
  assert.equal(formatLocalDate(leap.days.at(-1)), '2024-03-09');

  const yearEnd = buildCalendarRange(localDate(2024, 12, 15), 'month');
  assert.equal(formatLocalDate(yearEnd.days[0]), '2024-12-01');
  assert.equal(formatLocalDate(yearEnd.days.at(-1)), '2025-01-11');
});

test('month navigation clamps short months and never drifts by thirty days', () => {
  assert.equal(formatLocalDate(addLocalMonths(localDate(2024, 1, 31), 1)), '2024-02-29');
  assert.equal(formatLocalDate(addLocalMonths(localDate(2023, 1, 31), 1)), '2023-02-28');
  assert.equal(formatLocalDate(addLocalMonths(localDate(2024, 3, 31), -1)), '2024-02-29');
  assert.equal(formatLocalDate(addLocalMonths(localDate(2024, 12, 31), 1)), '2025-01-31');
  assert.equal(
    formatLocalDate(navigateCalendar(localDate(2024, 3, 31), 1, 'month')),
    '2024-04-30'
  );
  assert.equal(
    formatLocalDate(navigateCalendar(localDate(2024, 4, 15), -1, 'month')),
    '2024-03-15'
  );
});

test('week navigation and ranges remain seven local days across DST and year boundaries', () => {
  withTimeZone('America/New_York', () => {
    const cursor = localDate(2024, 3, 10, 12);
    const range = buildCalendarRange(cursor, 'week');
    assert.equal(formatLocalDate(range.start), '2024-03-10');
    assert.equal(formatLocalDate(range.end), '2024-03-16');
    assert.equal(range.days.length, 7);
    assert.deepEqual(
      range.days.map(formatLocalDate),
      [
        '2024-03-10',
        '2024-03-11',
        '2024-03-12',
        '2024-03-13',
        '2024-03-14',
        '2024-03-15',
        '2024-03-16',
      ]
    );
    assert.equal(range.days[1].getHours(), 0);
    assert.equal(
      Math.round((range.days[1].getTime() - range.days[0].getTime()) / 3_600_000),
      23
    );
    assert.equal(
      formatLocalDate(navigateCalendar(localDate(2024, 12, 31), 1, 'week')),
      '2025-01-07'
    );
    assert.equal(formatLocalDate(addLocalDays(localDate(2024, 3, 9), 1)), '2024-03-10');
  });
});

test('date-only parsing and formatting stay stable in UTC and non-UTC timezones', () => {
  for (const timeZone of ['UTC', 'Asia/Jakarta', 'America/New_York', 'Pacific/Kiritimati']) {
    withTimeZone(timeZone, () => {
      const date = parseLocalDateOnly('2024-01-01');
      assert.ok(date);
      assert.equal(formatLocalDate(date), '2024-01-01');
      assert.equal(date.getHours(), 0);
      assert.equal(calendarRecordDay('2024-01-01'), '2024-01-01');
    });
  }
});

test('timestamp record keys resolve to the local day while date-only values do not shift', () => {
  const expectedByTimeZone = {
    UTC: '2023-12-31',
    'Asia/Jakarta': '2024-01-01',
    'America/New_York': '2023-12-31',
    'Pacific/Kiritimati': '2024-01-01',
  };
  for (const [timeZone, expected] of Object.entries(expectedByTimeZone)) {
    withTimeZone(timeZone, () => {
      assert.equal(calendarRecordDay('2024-01-01T00:30:00+07:00'), expected);
      assert.equal(calendarRecordDay('2024-01-01'), '2024-01-01');
    });
  }
});

test('invalid dates and unsupported record values are ignored', () => {
  assert.equal(parseLocalDateOnly('2024-02-30'), null);
  assert.equal(parseLocalDateOnly('2023-02-29'), null);
  assert.equal(parseLocalDateOnly('2024-2-01'), null);
  assert.equal(calendarRecordDay('2024-02-30'), null);
  assert.equal(calendarRecordDay('not-a-date'), null);
  assert.equal(calendarRecordDay(17), null);
  assert.equal(calendarRecordDay(new Date(Number.NaN)), null);
});
