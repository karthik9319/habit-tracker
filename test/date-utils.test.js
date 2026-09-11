import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateKey, todayKey, getWeekStart, weekDates, formatDateKey } from '../renderer/date-utils.js';

test('dateKey formats as YYYY-MM-DD with zero-padding', () => {
  assert.equal(dateKey(new Date(2026, 0, 5)), '2026-01-05'); // Jan 5, 2026
  assert.equal(dateKey(new Date(2026, 11, 31)), '2026-12-31');
});

test('todayKey matches dateKey(new Date())', () => {
  assert.equal(todayKey(), dateKey(new Date()));
});

test('getWeekStart returns the Monday of the given date\'s week', () => {
  // Wed Jan 7, 2026 -> Monday Jan 5, 2026
  const wed = new Date(2026, 0, 7);
  const monday = getWeekStart(wed);
  assert.equal(dateKey(monday), '2026-01-05');
  assert.equal(monday.getHours(), 0);
});

test('getWeekStart on a Sunday rolls back to the Monday before it', () => {
  // Sun Jan 11, 2026 -> Monday Jan 5, 2026 (week doesn't jump forward)
  const sunday = new Date(2026, 0, 11);
  assert.equal(dateKey(getWeekStart(sunday)), '2026-01-05');
});

test('getWeekStart on a Monday returns the same day', () => {
  const monday = new Date(2026, 0, 5);
  assert.equal(dateKey(getWeekStart(monday)), '2026-01-05');
});

test('weekDates returns 7 consecutive days starting from weekStart', () => {
  const start = getWeekStart(new Date(2026, 0, 7));
  const days = weekDates(start);
  assert.equal(days.length, 7);
  assert.equal(dateKey(days[0]), '2026-01-05');
  assert.equal(dateKey(days[6]), '2026-01-11');
});

test('formatDateKey renders a short human-readable date', () => {
  const label = formatDateKey('2026-03-09');
  // Locale-formatted, but should mention the day number
  assert.match(label, /9/);
});
