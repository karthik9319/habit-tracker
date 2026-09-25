import { dateKey, todayKey, getWeekStart, weekDates } from './date-utils.js';
import { ICON_RULES, FALLBACK_ICONS, RAMPS, STREAK_MILESTONES } from './constants.js';

export function weeklyCount(habit, weekStart) {
  let count = 0;
  weekDates(weekStart).forEach((d) => {
    const key = dateKey(d);
    if (habit.checkins && habit.checkins[key]) count++;
  });
  return count;
}

export function activePauseWindow(habit, key) {
  if (!habit.pauseWindows) return null;
  return habit.pauseWindows.find((w) => key >= w.from && key <= w.until) || null;
}

export function effectiveWeeklyTarget(habit, weekStart) {
  const dates = weekDates(weekStart);
  const relevantDates = habit.scheduleDays
    ? dates.filter((d) => habit.scheduleDays.includes(d.getDay()))
    : dates;
  const availableDates = relevantDates.filter((d) => !activePauseWindow(habit, dateKey(d)));

  if (availableDates.length === 0) return 0;
  if (habit.scheduleDays) return availableDates.length;

  const target = Math.max(1, Number(habit.target) || 1);
  return Math.ceil(target * (availableDates.length / relevantDates.length));
}

function weekIsMet(habit, weekStart) {
  const adjustedTarget = effectiveWeeklyTarget(habit, weekStart);
  return adjustedTarget === 0 || weeklyCount(habit, weekStart) >= adjustedTarget;
}

function localDateFromKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function firstCheckinWeek(habit) {
  const keys = habit.checkins ? Object.keys(habit.checkins).sort() : [];
  return keys.length ? getWeekStart(localDateFromKey(keys[0])) : null;
}

function hasMetWeekOnOrBefore(habit, fromWeek, firstWeek) {
  const cursor = new Date(fromWeek);
  for (let i = 0; cursor >= firstWeek && i < 520; i++) {
    if (weekIsMet(habit, cursor)) return true;
    cursor.setDate(cursor.getDate() - 7);
  }
  return false;
}

export function weeklyStreak(habit) {
  const firstWeek = firstCheckinWeek(habit);
  if (!firstWeek) return { count: 0, graceUsed: false };

  let streak = 0;
  let graceUsed = false;
  const currentWeek = getWeekStart(new Date());
  const cursor = new Date(currentWeek);

  // An in-progress week cannot break a streak or consume its monthly grace.
  if (weekIsMet(habit, cursor)) {
    streak++;
  }
  cursor.setDate(cursor.getDate() - 7);

  const usedGraceMonths = new Set();
  for (let i = 0; cursor >= firstWeek && i < 520; i++) {
    if (weekIsMet(habit, cursor)) {
      streak++;
    } else {
      const graceKey = `${cursor.getFullYear()}-${cursor.getMonth()}`;
      if (!usedGraceMonths.has(graceKey) && hasMetWeekOnOrBefore(habit, cursor, firstWeek)) {
        usedGraceMonths.add(graceKey);
        streak++;
        graceUsed = true;
      } else {
        break;
      }
    }
    cursor.setDate(cursor.getDate() - 7);
  }
  return { count: streak, graceUsed };
}

export function lastCheckinBeforeToday(habit) {
  if (!habit.checkins) return null;
  const keys = Object.keys(habit.checkins).filter((k) => k !== todayKey()).sort();
  return keys.length ? keys[keys.length - 1] : null;
}

export function habitNoteSuggestions(habit) {
  if (!habit.dayNotes) return [];
  const keys = Object.keys(habit.dayNotes).sort().reverse();
  const seen = new Set();
  const out = [];
  for (const k of keys) {
    const notes = habit.dayNotes[k] || [];
    for (let i = notes.length - 1; i >= 0; i--) {
      const note = notes[i];
      if (note && !seen.has(note)) {
        seen.add(note);
        out.push(note);
        if (out.length >= 8) return out;
      }
    }
  }
  return out;
}

export function assignIcon(name, habitsCount) {
  const lower = name.toLowerCase();
  for (const [regex, icon] of ICON_RULES) {
    if (regex.test(lower)) return icon;
  }
  return FALLBACK_ICONS[habitsCount % FALLBACK_ICONS.length];
}

export function assignRamp(habitsCount) {
  return RAMPS[habitsCount % RAMPS.length];
}

export function recentHabitNotes(habit, limit) {
  if (!habit.dayNotes || !habit.checkins) return [];
  const keys = Object.keys(habit.dayNotes).sort().reverse();
  const out = [];
  for (const k of keys) {
    if (!habit.checkins[k]) continue; // only reflect notes for days actually marked done
    const notes = habit.dayNotes[k] || [];
    for (let i = notes.length - 1; i >= 0; i--) {
      out.push({ date: k, note: notes[i] });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function longestStreakEver(habit) {
  const start = firstCheckinWeek(habit);
  if (!start) return 0;
  const end = getWeekStart(new Date());

  let longest = 0;
  let current = 0;
  const cursor = new Date(start);
  let iterations = 0;
  const usedGraceMonths = new Set();
  while (cursor <= end && iterations < 1000) {
    const isCurrentWeek = dateKey(cursor) === dateKey(end);
    if (isCurrentWeek && !weekIsMet(habit, cursor)) {
      cursor.setDate(cursor.getDate() + 7);
      iterations++;
      continue;
    }

    if (weekIsMet(habit, cursor)) {
      current++;
      if (current > longest) longest = current;
    } else {
      const graceKey = `${cursor.getFullYear()}-${cursor.getMonth()}`;
      if (current > 0 && !usedGraceMonths.has(graceKey)) {
        usedGraceMonths.add(graceKey);
        current++;
        if (current > longest) longest = current;
      } else {
        current = 0;
      }
    }
    cursor.setDate(cursor.getDate() + 7);
    iterations++;
  }
  return longest;
}

export function streakMilestoneInfo(habit) {
  const dates = {};
  let longest = 0;
  const start = firstCheckinWeek(habit);
  if (!start) return { longest, dates };
  const end = getWeekStart(new Date());

  let current = 0;
  const cursor = new Date(start);
  let iterations = 0;
  const usedGraceMonths = new Set();
  while (cursor <= end && iterations < 1000) {
    const isCurrentWeek = dateKey(cursor) === dateKey(end);
    if (isCurrentWeek && !weekIsMet(habit, cursor)) {
      cursor.setDate(cursor.getDate() + 7);
      iterations++;
      continue;
    }

    let met = false;
    if (weekIsMet(habit, cursor)) {
      current++;
      met = true;
    } else {
      const graceKey = `${cursor.getFullYear()}-${cursor.getMonth()}`;
      if (current > 0 && !usedGraceMonths.has(graceKey)) {
        usedGraceMonths.add(graceKey);
        current++;
        met = true;
      } else {
        current = 0;
      }
    }
    if (met) {
      if (current > longest) longest = current;
      STREAK_MILESTONES.forEach((m) => {
        if (current === m && !dates[m]) dates[m] = dateKey(cursor);
      });
    }
    cursor.setDate(cursor.getDate() + 7);
    iterations++;
  }
  return { longest, dates };
}

export function perfectMonthsCount(habit) {
  if (!habit.checkins) return 0;
  const keys = Object.keys(habit.checkins).sort();
  if (keys.length === 0) return 0;

  const start = firstCheckinWeek(habit);
  const end = getWeekStart(new Date());
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${now.getMonth()}`;

  const months = {};
  const cursor = new Date(start);
  let iterations = 0;
  while (cursor <= end && iterations < 1000) {
    const adjustedTarget = effectiveWeeklyTarget(habit, cursor);
    if (adjustedTarget === 0) {
      cursor.setDate(cursor.getDate() + 7);
      iterations++;
      continue; // fully paused weeks don't count for or against a perfect month
    }
    const monthKey = `${cursor.getFullYear()}-${cursor.getMonth()}`;
    const met = weeklyCount(habit, cursor) >= adjustedTarget;
    if (!months[monthKey]) months[monthKey] = { total: 0, allMet: true };
    months[monthKey].total++;
    if (!met) months[monthKey].allMet = false;
    cursor.setDate(cursor.getDate() + 7);
    iterations++;
  }

  let perfect = 0;
  Object.keys(months).forEach((mk) => {
    if (mk === currentMonthKey) return;
    if (months[mk].total >= 4 && months[mk].allMet) perfect++;
  });
  return perfect;
}

export function mostMentionedNote(habit) {
  if (!habit.dayNotes) return null;
  const counts = {};
  Object.values(habit.dayNotes).forEach((notes) => {
    (notes || []).forEach((n) => {
      counts[n] = (counts[n] || 0) + 1;
    });
  });
  let best = null;
  Object.keys(counts).forEach((n) => {
    if (!best || counts[n] > counts[best]) best = n;
  });
  if (!best || counts[best] < 2) return null;
  return { note: best, count: counts[best] };
}

export function mostConsistentDay(habit) {
  if (!habit.checkins) return null;
  const keys = Object.keys(habit.checkins);
  if (keys.length < 3) return null;

  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  keys.forEach((k) => {
    const [y, m, d] = k.split('-').map(Number);
    const idx = (new Date(y, m - 1, d).getDay() + 6) % 7;
    counts[idx]++;
  });

  let bestIdx = 0;
  counts.forEach((c, i) => {
    if (c > counts[bestIdx]) bestIdx = i;
  });
  if (counts[bestIdx] === 0) return null;
  return { day: dayNames[bestIdx], count: counts[bestIdx] };
}
