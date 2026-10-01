import { showToast } from './ui-utils.js';
import { todayKey } from './date-utils.js';

export let state = { habits: [], books: [], settings: { notificationsEnabled: true } };

// Transient UI state (not persisted). Kept as properties on a shared object,
// rather than individually exported `let` bindings, because ES module
// imports are read-only live bindings — other modules can mutate an
// imported object's properties, but can't reassign an imported variable.
export const uiState = {
  currentTab: 'today',
  openNoteHabitId: null,
  openSlipHabitId: null,
  weekViewMode: 'week',
  monthOffset: 0,
  selectedHistoryHabitId: null,
  collapsedTodayGroups: new Set(),
  todayDoneCollapsed: false,
};

export const expandedNotesFor = new Set();
export const expandedInsightFor = new Set();
export const expandedMilestoneFor = new Set();

function migrateNoteFields() {
  state.habits.forEach((habit) => {
    habit.dayNotes = habit.dayNotes || {};
    if (!habit.checkins) return;
    Object.keys(habit.checkins).forEach((k) => {
      const entry = habit.checkins[k];
      if (!entry) return;
      if (!entry.notes && entry.note) {
        entry.notes = [entry.note];
      }
      if (entry.notes && entry.notes.length && !(habit.dayNotes[k] && habit.dayNotes[k].length)) {
        habit.dayNotes[k] = entry.notes.slice();
      }
      delete entry.note;
      delete entry.notes;
    });
  });
}

function autoArchiveEndedHabits() {
  const todayStr = todayKey();
  const justEnded = state.habits.filter((h) => h.endDate && !h.archived && h.endDate < todayStr);
  if (justEnded.length === 0) return;
  justEnded.forEach((h) => {
    h.archived = true;
  });
  persist();
  if (justEnded.length === 1) showToast(`Archived "${justEnded[0].name}" — its end date passed.`);
  else showToast(`Archived ${justEnded.length} habits whose end date passed.`);
}

export async function loadState() {
  try {
    const data = await window.api.loadData();
    state = data && data.habits ? data : { habits: [], books: [], settings: { notificationsEnabled: true } };
  } catch (err) {
    console.error('Load failed', err);
    showToast("Couldn't load your data. Starting fresh.");
    state = { habits: [], books: [], settings: { notificationsEnabled: true } };
  }
  state.books = Array.isArray(state.books) ? state.books : [];
  migrateNoteFields();
  autoArchiveEndedHabits();
}

export async function persist() {
  try {
    const ok = await window.api.saveData(state);
    if (!ok) showToast("Couldn't save — try again.");
  } catch (err) {
    console.error('Save failed', err);
    showToast("Couldn't save — try again.");
  }
}

// Used when wholesale-replacing state (e.g. JSON import), since other
// modules can't reassign the imported `state` binding directly.
export function replaceState(newState) {
  state = newState;
  state.books = Array.isArray(state.books) ? state.books : [];
  migrateNoteFields();
  autoArchiveEndedHabits();
}
