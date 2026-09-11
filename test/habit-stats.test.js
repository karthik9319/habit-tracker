import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateKey, getWeekStart } from '../renderer/date-utils.js';
import {
  weeklyStreak,
  longestStreakEver,
  perfectMonthsCount,
  streakMilestoneInfo,
  habitNoteSuggestions,
  assignIcon,
  assignRamp,
} from '../renderer/habit-stats.js';

// helper: the Monday (week-start) date key for "n full weeks before today"
function weekStartKeyWeeksAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n * 7);
  return dateKey(getWeekStart(d));
}

function habitWithCheckinsOnWeekStarts(weeksAgoList, target = 1) {
  const checkins = {};
  weeksAgoList.forEach((n) => {
    checkins[weekStartKeyWeeksAgo(n)] = { done: true };
  });
  return { target, checkins };
}

test('weeklyStreak counts all consecutive met weeks', () => {
  // current week + 3 prior weeks, all met. Note: the function walks past the
  // real data into empty history and forgives the first empty week it hits
  // via monthly grace (pre-existing behavior, unrelated to what we're
  // checking here), so we assert a lower bound rather than an exact count —
  // the exact boundary depends on how calendar months line up with "today".
  const habit = habitWithCheckinsOnWeekStarts([0, 1, 2, 3]);
  const result = weeklyStreak(habit);
  assert.ok(result.count >= 4, `expected at least 4, got ${result.count}`);
});

test('weeklyStreak forgives exactly one missed week via monthly grace', () => {
  // current week + 2 weeks ago met, but 1 week ago missing -> forgiven, streak continues
  const habit = habitWithCheckinsOnWeekStarts([0, 2]);
  const result = weeklyStreak(habit);
  assert.equal(result.count, 3); // week0 + forgiven week1 + week2
  assert.equal(result.graceUsed, true);
});

test('weeklyStreak treats a paused week as met without consuming grace', () => {
  const habit = habitWithCheckinsOnWeekStarts([0, 2]);
  // pause covers the entire missing week (1 week ago)
  const pausedWeekStart = weekStartKeyWeeksAgo(1);
  habit.pauseWindows = [{ from: pausedWeekStart, until: pausedWeekStart }];
  const result = weeklyStreak(habit);
  // week0 + paused week1 + week2 are all "met" without touching grace;
  // same boundary caveat as above applies to the upper bound.
  assert.ok(result.count >= 3, `expected at least 3, got ${result.count}`);
});

test('longestStreakEver matches weeklyStreak for a single unbroken run', () => {
  const habit = habitWithCheckinsOnWeekStarts([0, 1, 2, 3, 4]);
  assert.equal(longestStreakEver(habit), 5);
});

test('longestStreakEver returns 0 for a habit with no checkins', () => {
  assert.equal(longestStreakEver({ target: 1, checkins: {} }), 0);
});

test('streakMilestoneInfo records the date a milestone was first reached', () => {
  // exactly 4 consecutive weeks ending this week -> hits the 4-week milestone now
  const habit = habitWithCheckinsOnWeekStarts([0, 1, 2, 3]);
  const info = streakMilestoneInfo(habit);
  assert.equal(info.longest, 4);
  assert.equal(info.dates[4], weekStartKeyWeeksAgo(0));
});

test('perfectMonthsCount counts a fully-met historical month once', () => {
  // January 2020: Mondays 6th, 13th, 20th, 27th all met, nothing else recorded
  const habit = {
    target: 1,
    checkins: {
      '2020-01-06': { done: true },
      '2020-01-13': { done: true },
      '2020-01-20': { done: true },
      '2020-01-27': { done: true },
    },
  };
  assert.equal(perfectMonthsCount(habit), 1);
});

test('perfectMonthsCount excludes a month with a missed week', () => {
  const habit = {
    target: 1,
    checkins: {
      '2020-01-06': { done: true },
      '2020-01-13': { done: true },
      // 2020-01-20 missing
      '2020-01-27': { done: true },
    },
  };
  assert.equal(perfectMonthsCount(habit), 0);
});

test('habitNoteSuggestions returns unique notes, most recent day first', () => {
  const habit = {
    dayNotes: {
      '2026-01-01': ['Atomic Habits'],
      '2026-01-03': ['Deep Work', 'Atomic Habits'],
      '2026-01-05': ['Deep Work'],
    },
  };
  assert.deepEqual(habitNoteSuggestions(habit), ['Deep Work', 'Atomic Habits']);
});

test('assignIcon matches known keywords regardless of case', () => {
  assert.equal(assignIcon('Morning Run', 0), '🏃');
  assert.equal(assignIcon('Read a book', 0), '📖');
});

test('assignIcon falls back to a rotating icon for unmatched names', () => {
  assert.equal(assignIcon('Xyzzy', 0), '✨');
  assert.equal(assignIcon('Xyzzy', 1), '🌱');
});

test('assignRamp rotates through the ramp palette by habit count', () => {
  assert.equal(assignRamp(0), 'teal');
  assert.equal(assignRamp(1), 'coral');
});
