import { CHECKIN_MILESTONES } from './constants.js';
import { todayKey, dateKey, daysBetween } from './date-utils.js';
import { activePauseWindow, lastCheckinBeforeToday } from './habit-stats.js';
import { state, uiState, persist } from './state.js';
import { showToast } from './ui-utils.js';

// Views register their render functions here once, at startup, so actions
// can trigger a re-render without this module importing view code (which
// would create a circular dependency, since views import actions).
let _renderToday = () => {};
let _renderAll = () => {};
export function setRenderCallbacks({ renderToday, renderAll }) {
  _renderToday = renderToday;
  _renderAll = renderAll;
}

export function toggleCheckin(habit, btnEl, isMini) {
  const key = todayKey();
  habit.checkins = habit.checkins || {};
  const wasChecked = !!habit.checkins[key];

  if (wasChecked) {
    delete habit.checkins[key];
    if (uiState.openNoteHabitId === habit.id) uiState.openNoteHabitId = null;
  } else {
    const gapKey = lastCheckinBeforeToday(habit);
    habit.checkins[key] = { done: true, mini: !!isMini };
    if (gapKey && daysBetween(gapKey, key) >= 10) {
      habit._returnedAfterGap = true;
    }
    uiState.openNoteHabitId = habit.id;

    const totalCheckins = Object.keys(habit.checkins).length;
    habit._celebratedMilestones = habit._celebratedMilestones || [];
    if (CHECKIN_MILESTONES.includes(totalCheckins) && !habit._celebratedMilestones.includes(totalCheckins)) {
      habit._celebratedMilestones.push(totalCheckins);
      showToast(`🎉 ${totalCheckins} check-ins for ${habit.name}!`, { celebratory: true });
    }
  }

  if (btnEl) {
    btnEl.style.transform = 'scale(0.85)';
    setTimeout(() => {
      btnEl.style.transform = 'scale(1.15)';
    }, 90);
    setTimeout(() => {
      btnEl.style.transform = 'scale(1)';
      _renderToday();
    }, 180);
  } else {
    _renderToday();
  }

  persist();
}

export function toggleCheckinForDate(habit, dateKey) {
  habit.checkins = habit.checkins || {};
  if (habit.checkins[dateKey]) {
    delete habit.checkins[dateKey];
  } else {
    habit.checkins[dateKey] = { done: true, mini: false };
    const totalCheckins = Object.keys(habit.checkins).length;
    habit._celebratedMilestones = habit._celebratedMilestones || [];
    if (CHECKIN_MILESTONES.includes(totalCheckins) && !habit._celebratedMilestones.includes(totalCheckins)) {
      habit._celebratedMilestones.push(totalCheckins);
      showToast(`🎉 ${totalCheckins} check-ins for ${habit.name}!`, { celebratory: true });
    }
  }
  persist();
  _renderAll();
}

export function moveHabit(id, direction) {
  const active = state.habits.filter((h) => !h.archived);
  const posInActive = active.findIndex((h) => h.id === id);
  const swapPos = posInActive + direction;
  if (posInActive === -1 || swapPos < 0 || swapPos >= active.length) return;
  const otherId = active[swapPos].id;

  const idxA = state.habits.findIndex((h) => h.id === id);
  const idxB = state.habits.findIndex((h) => h.id === otherId);
  [state.habits[idxA], state.habits[idxB]] = [state.habits[idxB], state.habits[idxA]];

  persist();
  _renderAll();
}

export function resumeHabitNow(habit) {
  const window = activePauseWindow(habit, todayKey());
  if (!window) return;
  const yesterday = dateKey(new Date(Date.now() - 86400000));
  if (yesterday < window.from) {
    habit.pauseWindows = habit.pauseWindows.filter((w) => w !== window);
  } else {
    window.until = yesterday;
  }
  persist();
  _renderAll();
}
