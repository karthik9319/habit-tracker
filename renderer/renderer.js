import {
  DAY_ABBR,
  CHECKIN_MILESTONES,
  MILESTONE_ICONS,
  STREAK_MILESTONES,
  STREAK_MILESTONE_ICONS,
  ICON_CHOICES,
  RAMPS,
} from './constants.js';
import { dateKey, todayKey, getWeekStart, weekDates, formatDateKey } from './date-utils.js';
import {
  weeklyCount,
  weeklyStreak,
  activePauseWindow,
  effectiveWeeklyTarget,
  lastCheckinBeforeToday,
  habitNoteSuggestions,
  assignIcon,
  assignRamp,
  recentHabitNotes,
  longestStreakEver,
  streakMilestoneInfo,
  perfectMonthsCount,
  mostMentionedNote,
  mostConsistentDay,
} from './habit-stats.js';
import { state, uiState, expandedNotesFor, expandedInsightFor, expandedMilestoneFor, loadState, persist, replaceState } from './state.js';
import { showToast, ringSvg, rampVars, escapeHtml, miniWeekStripHtml } from './ui-utils.js';
import { toggleCheckin, toggleCheckinForDate, toggleSlip, moveHabit, resumeHabitNow, setRenderCallbacks } from './actions.js';

(function () {
  'use strict';

  let modalReturnFocus = null;

  function activateModal(root) {
    const modal = root.querySelector('.modal');
    if (!modal) return;
    if (!modalReturnFocus) modalReturnFocus = document.activeElement;

    const heading = modal.querySelector('h2');
    if (heading) {
      heading.id = 'active-modal-title';
      modal.setAttribute('aria-labelledby', heading.id);
    }
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('tabindex', '-1');

    modal.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        modal.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary')
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    setTimeout(() => {
      const first = modal.querySelector('input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), summary');
      if (first) first.focus();
      else modal.focus();
    }, 0);
  }

  // ---------- Today tab ----------

  function renderToday() {
    const panel = document.getElementById('tab-today');
    const active = state.habits.filter((h) => !h.archived);

    if (active.length === 0) {
      panel.innerHTML = `
        <div class="empty-state">
          <h3>No habits yet</h3>
          <p>Start with just one — small and doable beats big and abandoned.</p>
          <button class="btn-primary" id="empty-add-btn">+ Add your first habit</button>
        </div>`;
      panel.querySelector('#empty-add-btn').addEventListener('click', () => openHabitModal(null));
      return;
    }

    const today = todayKey();
    const availableToday = active.filter((h) => !activePauseWindow(h, today));
    const pausedToday = active.length - availableToday.length;
    const doneToday = availableToday.filter((h) => h.checkins && h.checkins[today]).length;
    const finished = active.filter((h) => h.checkins && h.checkins[today]);
    const unfinished = active.filter((h) => !(h.checkins && h.checkins[today]));
    const showCompactToggle = active.length >= 7;
    const compactView = showCompactToggle && !!(state.settings && state.settings.todayCompactView);
    const now = new Date();
    const hour = now.getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const dateLabel = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

    panel.innerHTML = `
      <div class="today-header">
        <h2 class="today-greeting">${greeting}</h2>
        <p class="today-date">${dateLabel}</p>
      </div>
      <p class="today-summary">${doneToday} of ${availableToday.length} available done today${
        pausedToday ? ` · ${pausedToday} paused` : ''
      }</p>
      ${
        showCompactToggle
          ? `<div class="today-view-controls">
              <button type="button" class="today-compact-toggle" id="today-compact-toggle" aria-pressed="${compactView}">
                ${compactView ? 'Comfortable view' : 'Compact view'}
              </button>
            </div>`
          : ''
      }
      <div id="today-list"></div>
      <div id="today-done-list"></div>
      <button class="btn-secondary" id="add-habit-btn" style="width:100%;margin-top:14px;">+ Add habit</button>
    `;

    const container = panel.querySelector('#today-list');
    const anyGrouped = unfinished.some((h) => h.timeOfDay);

    if (unfinished.length === 0) {
      container.innerHTML = `<div class="today-all-done"><span>✓</span><p>Everything available is done for today.</p></div>`;
    } else if (!anyGrouped) {
      const list = document.createElement('div');
      list.className = 'habit-list';
      unfinished.forEach((habit) => list.appendChild(renderHabitCard(habit, { compact: compactView })));
      container.appendChild(list);
    } else {
      const groups = [
        { key: 'morning', label: 'Morning' },
        { key: 'afternoon', label: 'Afternoon' },
        { key: 'evening', label: 'Evening' },
        { key: null, label: 'Anytime' },
      ];
      groups.forEach((g) => {
        const inGroup = unfinished.filter((h) => (h.timeOfDay || null) === g.key);
        if (inGroup.length === 0) return;
        const groupId = g.key || 'anytime';
        const collapsed = uiState.collapsedTodayGroups.has(groupId);
        const header = document.createElement('button');
        header.type = 'button';
        header.className = 'today-group-label today-group-toggle';
        header.setAttribute('aria-expanded', String(!collapsed));
        header.innerHTML = `<span>${g.label}</span><span class="today-group-meta">${inGroup.length} ${collapsed ? '▾' : '▲'}</span>`;
        header.addEventListener('click', () => {
          if (uiState.collapsedTodayGroups.has(groupId)) uiState.collapsedTodayGroups.delete(groupId);
          else uiState.collapsedTodayGroups.add(groupId);
          renderToday();
        });
        container.appendChild(header);
        if (collapsed) return;
        const list = document.createElement('div');
        list.className = 'habit-list';
        inGroup.forEach((habit) => list.appendChild(renderHabitCard(habit, { compact: compactView })));
        container.appendChild(list);
      });
    }

    if (finished.length > 0) {
      const doneContainer = panel.querySelector('#today-done-list');
      const noteComposerOpen = finished.some((habit) => uiState.openNoteHabitId === habit.id);
      const collapsed = uiState.todayDoneCollapsed && !noteComposerOpen;
      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'today-done-header';
      header.setAttribute('aria-expanded', String(!collapsed));
      header.innerHTML = `<span>Done today</span><span>${finished.length} ${collapsed ? '▾' : '▲'}</span>`;
      header.addEventListener('click', () => {
        uiState.todayDoneCollapsed = !uiState.todayDoneCollapsed;
        renderToday();
      });
      doneContainer.appendChild(header);
      if (!collapsed) {
        const list = document.createElement('div');
        list.className = 'completed-habit-list';
        finished.forEach((habit) => {
          if (uiState.openNoteHabitId === habit.id) list.appendChild(renderHabitCard(habit));
          else list.appendChild(renderCompletedHabitRow(habit));
        });
        doneContainer.appendChild(list);
      }
    }

    const compactToggle = panel.querySelector('#today-compact-toggle');
    if (compactToggle) {
      compactToggle.addEventListener('click', () => {
        state.settings = state.settings || {};
        state.settings.todayCompactView = !compactView;
        persist();
        renderToday();
      });
    }

    panel.querySelector('#add-habit-btn').addEventListener('click', () => openHabitModal(null));
  }

  function renderCompletedHabitRow(habit) {
    const row = document.createElement('div');
    row.className = 'completed-habit-row';
    const entry = habit.checkins && habit.checkins[todayKey()];
    const notes = (habit.dayNotes && habit.dayNotes[todayKey()]) || [];
    const c = rampVars(habit.ramp);
    row.innerHTML = `
      <div class="completed-habit-icon" style="background:${c.fill};">${habit.icon}</div>
      <div class="completed-habit-info">
        <p>${escapeHtml(habit.name)}</p>
        <span>${entry && entry.mini ? 'Minimum version' : 'Completed'}${notes.length ? ` · 📝 ${notes.length}` : ''}</span>
      </div>
      <button type="button" class="completed-note-btn" aria-label="Add a note to ${escapeHtml(habit.name)}">${
      notes.length ? 'Note' : '+ Note'
    }</button>
      <button type="button" class="completed-undo-btn" aria-label="Undo ${escapeHtml(habit.name)}">✓</button>`;
    row.querySelector('.completed-note-btn').addEventListener('click', () => {
      uiState.todayDoneCollapsed = false;
      uiState.openNoteHabitId = habit.id;
      renderToday();
    });
    row.querySelector('.completed-undo-btn').addEventListener('click', () => toggleCheckin(habit, null));
    return row;
  }

  function renderHabitCard(habit, { compact = false } = {}) {
    const card = document.createElement('div');
    card.className = 'habit-card';
    if (compact) card.classList.add('is-compact');
    card.style.background = `color-mix(in srgb, var(--${habit.ramp}-fill) 55%, var(--surface))`;

    const c0 = rampVars(habit.ramp);
    const pauseWindow = activePauseWindow(habit, todayKey());
    if (pauseWindow) {
      card.innerHTML = `
        <div class="habit-icon" style="background:${c0.fill};opacity:0.6;">${habit.icon}</div>
        <div class="habit-info">
          <p class="habit-name-row">${escapeHtml(habit.name)}</p>
          <p class="habit-sub">⏸ Paused until ${formatDateKey(pauseWindow.until)}</p>
        </div>
      `;
      const wrap = document.createElement('div');
      wrap.className = `habit-card-wrap${compact ? ' is-compact' : ''}`;
      wrap.appendChild(card);
      const resumeBtn = document.createElement('button');
      resumeBtn.type = 'button';
      resumeBtn.textContent = 'Resume now';
      resumeBtn.className = 'btn-text habit-followup-action';
      resumeBtn.addEventListener('click', () => resumeHabitNow(habit));
      wrap.appendChild(resumeBtn);
      return wrap;
    }

    const weekStart = getWeekStart(new Date());
    const done = weeklyCount(habit, weekStart);
    const adjustedTarget = effectiveWeeklyTarget(habit, weekStart);
    const todayEntry = habit.checkins && habit.checkins[todayKey()];
    const checkedToday = !!todayEntry;
    const pct = adjustedTarget > 0 ? done / adjustedTarget : 1;
    const streakInfo = weeklyStreak(habit);
    const streak = streakInfo.count;
    const c = rampVars(habit.ramp);

    const streakBadge =
      streak > 0
        ? `<span class="streak-badge" style="background:${c.fill};color:${c.text};" ${
            streakInfo.graceUsed ? 'title="Includes a forgiven week"' : ''
          }>🔥 ${streak}${streakInfo.graceUsed ? ' ❄️' : ''}</span>`
        : '';

    const todayKeyStr = todayKey();
    const todayNotes = (checkedToday && habit.dayNotes && habit.dayNotes[todayKeyStr]) || [];
    const notesExpanded = expandedNotesFor.has(habit.id);
    let notesHtml = '';
    if (checkedToday && todayNotes.length > 0) {
      const summaryLabel = `📝 ${todayNotes.length} note${todayNotes.length === 1 ? '' : 's'} ${
        notesExpanded ? '▲' : '▾'
      }`;
      const linesHtml = notesExpanded
        ? todayNotes
            .map(
              (n, i) =>
                `<p class="habit-sub habit-note">• ${escapeHtml(n)} <button type="button" class="note-delete-btn" data-idx="${i}" aria-label="Delete note">×</button></p>`
            )
            .join('')
        : '';
      notesHtml = `<button type="button" class="habit-sub habit-note-summary-btn">${summaryLabel}</button>${linesHtml}`;
    }

    const isAvoid = habit.type === 'avoid';
    const dayWord = isAvoid ? 'clean days' : habit.scheduleDays ? 'scheduled days' : null;
    const weekSubLabel = dayWord
      ? `${done} of ${adjustedTarget} ${dayWord} this week`
      : `${done} of ${adjustedTarget} this week`;
    const pauseAdjustment = adjustedTarget !== habit.target ? ' · adjusted for pause' : '';
    const scheduleLabel = habit.scheduleDays
      ? `<p class="habit-sub" style="margin-top:1px;">${habit.scheduleDays.map((d) => DAY_ABBR[d]).join(', ')}</p>`
      : '';
    const typeBadge = isAvoid ? `<span class="habit-type-badge">avoid</span>` : '';
    const addNoteHtml = checkedToday && uiState.openNoteHabitId !== habit.id
      ? `<button type="button" class="habit-add-note-btn">${todayNotes.length ? '+ Add another note' : '+ Add note'}</button>`
      : '';

    card.innerHTML = `
      <div class="habit-icon" style="background:${c.fill};">${habit.icon}</div>
      <div class="habit-info">
        <p class="habit-name-row">${escapeHtml(habit.name)}${typeBadge}${streakBadge}</p>
        <p class="habit-sub">${weekSubLabel}${pauseAdjustment}</p>
        ${scheduleLabel}
        ${notesHtml}
        ${addNoteHtml}
      </div>
      <button class="ring-check-btn" aria-label="${
        checkedToday ? 'Undo today' : isAvoid ? 'Mark today clean' : 'Mark done today'
      }">
        ${ringSvg(pct, c.mid, c.fill)}
        <span class="ring-check-mark" style="${checkedToday ? `background:${c.mid};` : ''}">${checkedToday ? '✓' : ''}</span>
      </button>
    `;

    const btn = card.querySelector('.ring-check-btn');
    btn.addEventListener('click', () => toggleCheckin(habit, btn));

    const summaryBtn = card.querySelector('.habit-note-summary-btn');
    if (summaryBtn) {
      summaryBtn.addEventListener('click', () => {
        if (expandedNotesFor.has(habit.id)) expandedNotesFor.delete(habit.id);
        else expandedNotesFor.add(habit.id);
        renderToday();
      });
    }

    card.querySelectorAll('.note-delete-btn').forEach((delBtn) => {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = Number(delBtn.dataset.idx);
        if (habit.dayNotes && habit.dayNotes[todayKeyStr]) {
          habit.dayNotes[todayKeyStr].splice(idx, 1);
          persist();
          renderToday();
        }
      });
    });

    const addNoteBtn = card.querySelector('.habit-add-note-btn');
    if (addNoteBtn) {
      addNoteBtn.addEventListener('click', () => {
        uiState.openNoteHabitId = habit.id;
        renderToday();
      });
    }

    if (checkedToday && uiState.openNoteHabitId === habit.id) {
      card.appendChild(renderNoteInput(habit));
    }

    const wrap = document.createElement('div');
    wrap.className = `habit-card-wrap${compact ? ' is-compact' : ''}`;
    wrap.appendChild(card);

    if (!checkedToday && habit.miniVersion) {
      const mini = document.createElement('button');
      mini.textContent = `Just do: ${habit.miniVersion}`;
      mini.className = 'btn-text habit-followup-action';
      const miniWrap = document.createElement('div');
      miniWrap.className = 'habit-followup-row';
      miniWrap.appendChild(mini);
      wrap.appendChild(miniWrap);
      mini.addEventListener('click', () => toggleCheckin(habit, btn, true));
    }

    if (isAvoid) {
      if (uiState.openSlipHabitId === habit.id) {
        wrap.appendChild(renderSlipInput(habit));
      } else {
        const todayHasSlip = !!(habit.slips && habit.slips[todayKeyStr]);
        const slipLink = document.createElement('button');
        slipLink.type = 'button';
        slipLink.textContent = todayHasSlip ? '⚠️ Slip logged today · Undo' : '⚠️ Log a slip';
        slipLink.className = 'btn-text habit-followup-action';
        slipLink.addEventListener('click', () => {
          uiState.openSlipHabitId = todayHasSlip ? null : habit.id;
          toggleSlip(habit, todayKeyStr);
        });
        wrap.appendChild(slipLink);
      }
    }

    return wrap;
  }

  function renderSlipInput(habit) {
    const key = todayKey();
    const row = document.createElement('div');
    row.className = 'note-input-row';
    row.innerHTML = `<input type="text" class="note-input" placeholder="Optional reason (e.g. stressful day)" />`;

    const input = row.querySelector('.note-input');
    let committed = false;

    const commit = () => {
      if (committed) return;
      committed = true;
      const val = input.value.trim();
      if (val) {
        habit.dayNotes = habit.dayNotes || {};
        habit.dayNotes[key] = habit.dayNotes[key] || [];
        habit.dayNotes[key].push(val);
        persist();
      }
      uiState.openSlipHabitId = null;
      renderToday();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        committed = true;
        uiState.openSlipHabitId = null;
        renderToday();
      }
    });
    input.addEventListener('blur', commit);

    setTimeout(() => input.focus(), 30);

    return row;
  }

  function renderNoteInput(habit) {
    const key = todayKey();
    const suggestions = habitNoteSuggestions(habit).slice(0, 3);
    const composer = document.createElement('div');
    composer.className = 'habit-note-composer';
    composer.innerHTML = `
      <label class="habit-note-composer-label" for="note-input-${habit.id}">Add a note</label>
      <textarea id="note-input-${habit.id}" class="habit-note-textarea" rows="2" placeholder="What would you like to remember?"></textarea>
      ${
        suggestions.length
          ? `<div class="habit-note-suggestions" aria-label="Past note suggestions">
              ${suggestions
                .map(
                  (suggestion) =>
                    `<button type="button" class="note-suggestion-chip" data-note="${escapeHtml(suggestion)}">${escapeHtml(
                      suggestion
                    )}</button>`
                )
                .join('')}
            </div>`
          : ''
      }
      <div class="habit-note-composer-actions">
        <button type="button" class="btn-text cancel-note-btn">Cancel</button>
        <button type="button" class="btn-secondary save-note-btn" disabled>Save note</button>
      </div>`;

    const textarea = composer.querySelector('.habit-note-textarea');
    const saveButton = composer.querySelector('.save-note-btn');

    const closeComposer = () => {
      uiState.openNoteHabitId = null;
      renderToday();
    };
    const saveNote = () => {
      const value = textarea.value.trim();
      if (!value || !(habit.checkins && habit.checkins[key])) return;
      habit.dayNotes = habit.dayNotes || {};
      habit.dayNotes[key] = habit.dayNotes[key] || [];
      habit.dayNotes[key].push(value);
      expandedNotesFor.add(habit.id);
      uiState.openNoteHabitId = null;
      persist();
      renderToday();
    };

    textarea.addEventListener('input', () => {
      saveButton.disabled = !textarea.value.trim();
    });
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeComposer();
      } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        saveNote();
      }
    });
    composer.querySelector('.cancel-note-btn').addEventListener('click', closeComposer);
    saveButton.addEventListener('click', saveNote);
    composer.querySelectorAll('.note-suggestion-chip').forEach((button) => {
      button.addEventListener('click', () => {
        textarea.value = button.dataset.note;
        saveButton.disabled = false;
        textarea.focus();
      });
    });

    setTimeout(() => textarea.focus(), 30);
    return composer;
  }


  // ---------- History tab ----------

  function renderWeek() {
    const panel = document.getElementById('tab-week');
    const active = state.habits.filter((h) => !h.archived);

    if (active.length === 0) {
      panel.innerHTML = `<div class="empty-state"><h3>No habits yet</h3><p>Add a habit to see your week take shape here.</p></div>`;
      return;
    }

    const toggleHtml = `
      <div class="view-toggle" role="group" aria-label="History range">
        <button type="button" class="view-toggle-btn ${uiState.weekViewMode === 'week' ? 'active' : ''}" aria-pressed="${
          uiState.weekViewMode === 'week'
        }" data-mode="week">This week</button>
        <button type="button" class="view-toggle-btn ${uiState.weekViewMode === 'month' ? 'active' : ''}" aria-pressed="${
          uiState.weekViewMode === 'month'
        }" data-mode="month">Month</button>
      </div>
    `;

    const body = uiState.weekViewMode === 'month' ? renderMonthGridHtml(active) : renderWeekGridHtml(active);
    panel.innerHTML = toggleHtml + body;

    panel.querySelectorAll('.view-toggle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        uiState.weekViewMode = btn.dataset.mode;
        renderWeek();
      });
    });

    const prevMonthBtn = panel.querySelector('#month-prev');
    if (prevMonthBtn) {
      prevMonthBtn.addEventListener('click', () => {
        uiState.monthOffset -= 1;
        renderWeek();
      });
    }
    const nextMonthBtn = panel.querySelector('#month-next');
    if (nextMonthBtn) {
      nextMonthBtn.addEventListener('click', () => {
        if (uiState.monthOffset < 0) uiState.monthOffset += 1;
        renderWeek();
      });
    }

    const habitSelect = panel.querySelector('#history-habit-select');
    if (habitSelect) {
      habitSelect.addEventListener('change', () => {
        uiState.selectedHistoryHabitId = habitSelect.value;
        renderWeek();
      });
    }

    panel.querySelectorAll('.day-dot-clickable').forEach((dot) => {
      dot.addEventListener('click', () => {
        const habit = state.habits.find((h) => h.id === dot.dataset.habitId);
        if (!habit) return;
        const key = dot.dataset.dateKey;
        const hasSlip = habit.slips && habit.slips[key];
        if ((habit.checkins && habit.checkins[key]) || hasSlip) {
          openDayNoteModal(habit, key);
        } else if (habit.type === 'avoid') {
          openAvoidDayModal(habit, key);
        } else {
          toggleCheckinForDate(habit, key);
        }
      });
    });
  }

  function renderWeekGridHtml(active) {
    const weekStart = getWeekStart(new Date());
    const dates = weekDates(weekStart);
    const todayStr = todayKey();

    let html = `<div class="history-heading">
      <div>
        <p class="history-title">Week of ${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>
        <p class="habit-sub">Select any past or current day to update it.</p>
      </div>
    </div>${historyLegendHtml()}`;

    active.forEach((habit) => {
      const c = rampVars(habit.ramp);
      const adjustedTarget = effectiveWeeklyTarget(habit, weekStart);
      const count = weeklyCount(habit, weekStart);
      html += `<div class="week-habit-block">
        <div class="week-habit-heading">
          <p class="week-habit-title"><span>${habit.icon}</span> ${escapeHtml(habit.name)}</p>
          <span class="week-habit-progress">${count}/${adjustedTarget}</span>
        </div>
        <div class="week-grid">`;
      dates.forEach((d) => {
        const key = dateKey(d);
        const entry = habit.checkins && habit.checkins[key];
        const done = !!entry;
        const hasSlip = !!(habit.slips && habit.slips[key]);
        const notes = (habit.dayNotes && habit.dayNotes[key]) || [];
        const paused = !!activePauseWindow(habit, key);
        const isFuture = key > todayStr;
        const interactive = done || hasSlip || (!isFuture && !paused);
        const isToday = key === todayStr;
        const isMini = !!(entry && entry.mini);
        const scheduled = !habit.scheduleDays || habit.scheduleDays.includes(d.getDay());
        const status = hasSlip ? 'slip logged' : done ? (isMini ? 'minimum version complete' : 'complete') : paused ? 'paused' : 'not complete';
        const style = done
          ? `background:${c.mid};border-color:${c.mid};`
          : isFuture
          ? 'opacity:0.4;'
          : '';
        const ariaLabel = `${habit.name}, ${d.toLocaleDateString(undefined, {
          weekday: 'long', month: 'short', day: 'numeric'
        })}: ${status}${notes.length ? `. ${notes.join('. ')}` : ''}`;
        html += `<div class="week-day">
          <div class="week-day-label">${d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2)}<span>${d.getDate()}</span></div>
          <button type="button" class="week-day-dot ${interactive ? 'day-dot-clickable' : ''} ${
          hasSlip ? 'has-slip' : ''
        } ${isToday ? 'is-today' : ''} ${paused ? 'is-paused' : ''} ${isMini ? 'is-mini' : ''} ${
          !scheduled ? 'is-unscheduled' : ''
        }" style="${style}" ${interactive ? `data-habit-id="${habit.id}" data-date-key="${key}"` : 'disabled'} aria-label="${escapeHtml(
          ariaLabel
        )}" title="${escapeHtml(ariaLabel)}">${notes.length ? '<span class="note-indicator" aria-hidden="true"></span>' : ''}</button>
        </div>`;
      });
      html += `</div></div>`;
    });

    return html;
  }

  function renderMonthGridHtml(active) {
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth() + uiState.monthOffset, 1);
    const year = target.getFullYear();
    const month = target.getMonth();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const todayStr = todayKey();
    const monthLabel = target.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const leadingBlanks = (new Date(year, month, 1).getDay() + 6) % 7;

    let selectedHabit = active.find((habit) => habit.id === uiState.selectedHistoryHabitId);
    if (!selectedHabit) {
      selectedHabit = active[0];
      uiState.selectedHistoryHabitId = selectedHabit.id;
    }
    const c = rampVars(selectedHabit.ramp);
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const monthCheckins = Object.keys(selectedHabit.checkins || {}).filter((key) => key.startsWith(monthPrefix)).length;
    const monthSlips = Object.keys(selectedHabit.slips || {}).filter((key) => key.startsWith(monthPrefix)).length;
    const summary = selectedHabit.type === 'avoid'
      ? `${monthCheckins} clean day${monthCheckins === 1 ? '' : 's'}${monthSlips ? ` · ${monthSlips} slip${monthSlips === 1 ? '' : 's'}` : ''}`
      : `${monthCheckins} check-in${monthCheckins === 1 ? '' : 's'}`;

    let html = `<div class="history-heading month-history-heading">
      <label class="history-habit-picker" for="history-habit-select">
        <span>Habit</span>
        <select id="history-habit-select">
          ${active.map((habit) => `<option value="${habit.id}" ${habit.id === selectedHabit.id ? 'selected' : ''}>${habit.icon} ${escapeHtml(
            habit.name
          )}</option>`).join('')}
        </select>
      </label>
      <div class="month-nav">
        <button type="button" class="month-nav-btn" id="month-prev" aria-label="Previous month">‹</button>
        <p class="history-title">${monthLabel}</p>
        <button type="button" class="month-nav-btn" id="month-next" aria-label="Next month" ${
          uiState.monthOffset >= 0 ? 'disabled' : ''
        }>›</button>
      </div>
      <p class="habit-sub month-summary">${summary}</p>
    </div>${historyLegendHtml()}
    <div class="month-grid">`;

    dayLabels.forEach((label) => {
      html += `<div class="month-day-label">${label}</div>`;
    });

    for (let i = 0; i < leadingBlanks; i++) {
      html += `<div class="month-day-empty"></div>`;
    }

    for (let day = 1; day <= totalDays; day++) {
      const date = new Date(year, month, day);
      const key = dateKey(date);
      const entry = selectedHabit.checkins && selectedHabit.checkins[key];
      const done = !!entry;
      const hasSlip = !!(selectedHabit.slips && selectedHabit.slips[key]);
      const notes = (selectedHabit.dayNotes && selectedHabit.dayNotes[key]) || [];
      const paused = !!activePauseWindow(selectedHabit, key);
      const isFuture = key > todayStr;
      const interactive = done || hasSlip || (!isFuture && !paused);
      const isToday = key === todayStr;
      const isMini = !!(entry && entry.mini);
      const scheduled = !selectedHabit.scheduleDays || selectedHabit.scheduleDays.includes(date.getDay());
      const status = hasSlip ? 'slip logged' : done ? (isMini ? 'minimum version complete' : 'complete') : paused ? 'paused' : 'not complete';
      const style = done ? `background:${c.mid};border-color:${c.mid};color:#fff;` : isFuture ? 'opacity:0.4;' : '';
      const dateLabel = date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
      const ariaLabel = `${selectedHabit.name}, ${dateLabel}: ${status}${notes.length ? `. ${notes.join('. ')}` : ''}`;
      html += `<button type="button" class="month-day-dot ${interactive ? 'day-dot-clickable' : ''} ${
        hasSlip ? 'has-slip' : ''
      } ${isToday ? 'is-today' : ''} ${paused ? 'is-paused' : ''} ${isMini ? 'is-mini' : ''} ${
        !scheduled ? 'is-unscheduled' : ''
      }" style="${style}" ${interactive ? `data-habit-id="${selectedHabit.id}" data-date-key="${key}"` : 'disabled'} aria-label="${escapeHtml(
        ariaLabel
      )}" title="${escapeHtml(ariaLabel)}"><span>${day}</span>${notes.length ? '<span class="note-indicator" aria-hidden="true"></span>' : ''}</button>`;
    }

    html += `</div>`;

    return html;
  }

  function historyLegendHtml() {
    return `<div class="history-legend" aria-label="History legend">
      <span><i class="legend-swatch is-complete"></i>Done</span>
      <span><i class="legend-swatch has-slip"></i>Slip</span>
      <span><i class="legend-swatch is-mini"></i>Minimum</span>
      <span><i class="legend-swatch is-paused"></i>Paused</span>
    </div>`;
  }

  // ---------- Books tab ----------

  function renderBooks() {
    const panel = document.getElementById('tab-books');
    const books = [...(state.books || [])].sort((a, b) => {
      const byDate = (b.finishedOn || '').localeCompare(a.finishedOn || '');
      return byDate || (b.createdAt || '').localeCompare(a.createdAt || '');
    });
    const currentYear = String(new Date().getFullYear());
    const finishedThisYear = books.filter((book) => (book.finishedOn || '').startsWith(currentYear)).length;

    let html = `<div class="section-heading books-heading">
      <h2>Finished books</h2>
      <p>Keep the accomplishment separate from your daily reading check-ins.</p>
    </div>
    <button class="btn-primary" id="add-book-btn">+ Log a finished book</button>`;

    if (books.length === 0) {
      html += `<div class="empty-state books-empty-state">
        <h3>Your finished shelf is empty</h3>
        <p>Add the book you just completed — you can backdate it if needed.</p>
      </div>`;
    } else {
      html += `<p class="book-summary"><strong>${finishedThisYear}</strong> finished in ${currentYear} · <strong>${books.length}</strong> all time</p>
        <div class="book-list">`;
      books.forEach((book) => {
        const numericRating = Math.max(0, Math.min(5, Number(book.rating) || 0));
        const finishedYear = (book.finishedOn || '').slice(0, 4);
        const finishedLabel = `${formatDateKey(book.finishedOn)}${finishedYear && finishedYear !== currentYear ? `, ${finishedYear}` : ''}`;
        const rating = numericRating
          ? `<span class="book-rating" aria-label="${numericRating} out of 5 stars">${'★'.repeat(numericRating)}${'☆'.repeat(5 - numericRating)}</span>`
          : '';
        const coverHtml = book.coverUrl
          ? `<img src="${escapeHtml(book.coverUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
          : '<span aria-hidden="true">📖</span>';
        html += `<article class="book-card" data-id="${escapeHtml(book.id)}">
          <div class="book-cover-mark">${coverHtml}</div>
          <div class="book-info">
            <h3>${escapeHtml(book.title)}</h3>
            ${book.author ? `<p class="book-author">by ${escapeHtml(book.author)}</p>` : ''}
            <p class="book-meta">Finished ${finishedLabel} ${rating}</p>
            ${book.note ? `<p class="book-note">${escapeHtml(book.note)}</p>` : ''}
          </div>
          <div class="book-actions">
            <button type="button" class="btn-text edit-book-btn" aria-label="Edit ${escapeHtml(book.title)}">Edit</button>
            <button type="button" class="btn-text delete-book-btn" aria-label="Delete ${escapeHtml(book.title)}">Delete</button>
          </div>
        </article>`;
      });
      html += `</div>
        <p class="book-cover-credit">Book covers provided by <a href="https://openlibrary.org" target="_blank" rel="noreferrer">Open Library</a>.</p>`;
    }

    panel.innerHTML = html;
    panel.querySelector('#add-book-btn').addEventListener('click', () => openBookModal(null));
    panel.querySelectorAll('.book-cover-mark img').forEach((img) => {
      img.addEventListener('error', () => {
        img.parentElement.innerHTML = '<span aria-hidden="true">📖</span>';
      });
    });
    panel.querySelectorAll('.edit-book-btn').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        const id = event.target.closest('.book-card').dataset.id;
        openBookModal(state.books.find((book) => book.id === id));
      });
    });
    panel.querySelectorAll('.delete-book-btn').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        const id = event.target.closest('.book-card').dataset.id;
        const book = state.books.find((item) => item.id === id);
        if (!book || !window.confirm(`Delete "${book.title}" from your finished books?`)) return;
        state.books = state.books.filter((item) => item.id !== id);
        persist();
        renderBooks();
        showToast('Book removed.');
      });
    });
  }

  // ---------- Habits management tab ----------

  function renderHabitsTab() {
    const panel = document.getElementById('tab-habits');
    const active = state.habits.filter((h) => !h.archived);
    const archived = state.habits.filter((h) => h.archived);

    let html = `<button class="btn-primary" id="add-habit-btn-2">+ Add habit</button><div style="margin-top:16px;">`;

    if (active.length === 0) {
      html += `<p class="today-summary">No active habits.</p>`;
    } else {
      active.forEach((habit, idx) => {
        const c = rampVars(habit.ramp);
        const scheduleMeta = habit.scheduleDays
          ? habit.scheduleDays.map((d) => DAY_ABBR[d]).join('/')
          : `${habit.target}x / week`;
        const typeMeta = habit.type === 'avoid' ? 'Avoid · ' : '';
        const pauseWindow = activePauseWindow(habit, todayKey());
        html += `
          <div class="habit-manage-row" data-id="${habit.id}">
            <div class="reorder-btns">
              <button type="button" class="reorder-btn move-up-btn" ${idx === 0 ? 'disabled' : ''} aria-label="Move up">▲</button>
              <button type="button" class="reorder-btn move-down-btn" ${idx === active.length - 1 ? 'disabled' : ''} aria-label="Move down">▼</button>
            </div>
            <div class="habit-icon" style="background:${c.fill};width:32px;height:32px;font-size:15px;">${habit.icon}</div>
            <div class="habit-manage-info">
              <p class="habit-manage-name">${escapeHtml(habit.name)}</p>
              <p class="habit-manage-meta">${typeMeta}${scheduleMeta}${habit.reminderTime ? ' · reminder ' + habit.reminderTime : ''}${
          habit.endDate ? ' · ends ' + formatDateKey(habit.endDate) : ''
        }${
          pauseWindow ? ' · ⏸ paused' : ''
        }</p>
            </div>
            <div class="habit-manage-actions">
              <button class="btn-text edit-habit-btn">Edit</button>
              <button class="btn-text ${pauseWindow ? 'resume-habit-btn' : 'pause-habit-btn'}">${
            pauseWindow ? 'Resume' : 'Pause'
          }</button>
              <button class="btn-text archive-habit-btn">Archive</button>
            </div>
          </div>`;
      });
    }

    if (archived.length > 0) {
      html += `<h3 style="font-size:13px;color:var(--text-secondary);margin:20px 0 6px;">Archived</h3>`;
      archived.forEach((habit) => {
        html += `
          <div class="habit-manage-row" data-id="${habit.id}">
            <div class="habit-icon" style="background:var(--surface-2);width:32px;height:32px;font-size:15px;">${habit.icon}</div>
            <div class="habit-manage-info">
              <p class="habit-manage-name">${escapeHtml(habit.name)}</p>
              <p class="habit-manage-meta">Archived</p>
            </div>
            <div class="habit-manage-actions">
              <button class="btn-text restore-habit-btn">Restore</button>
              <button class="btn-text delete-habit-btn">Delete</button>
            </div>
          </div>`;
      });
    }

    html += `</div>
      <p id="storage-status" class="habit-sub" style="margin:20px 0 0;">Checking storage…</p>
      <button class="btn-secondary" id="settings-btn" style="width:100%;margin-top:10px;">⚙️ Settings</button>`;

    panel.innerHTML = html;

    if (window.api.getStorageInfo) {
      window.api.getStorageInfo().then((info) => {
        const el = document.getElementById('storage-status');
        if (!el) return;
        el.textContent = info.icloud
          ? '☁️ Synced via iCloud Drive'
          : '💾 Stored locally on this Mac only';
      });
    }

    panel.querySelector('#settings-btn').addEventListener('click', () => openSettingsModal());
    panel.querySelector('#add-habit-btn-2').addEventListener('click', () => openHabitModal(null));

    panel.querySelectorAll('.move-up-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.target.closest('.habit-manage-row').dataset.id;
        moveHabit(id, -1);
      });
    });
    panel.querySelectorAll('.move-down-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.target.closest('.habit-manage-row').dataset.id;
        moveHabit(id, 1);
      });
    });
    panel.querySelectorAll('.edit-habit-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.target.closest('.habit-manage-row').dataset.id;
        openHabitModal(state.habits.find((h) => h.id === id));
      });
    });
    panel.querySelectorAll('.pause-habit-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.target.closest('.habit-manage-row').dataset.id;
        openPauseModal(state.habits.find((h) => h.id === id));
      });
    });
    panel.querySelectorAll('.resume-habit-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.target.closest('.habit-manage-row').dataset.id;
        resumeHabitNow(state.habits.find((h) => h.id === id));
      });
    });
    panel.querySelectorAll('.archive-habit-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.target.closest('.habit-manage-row').dataset.id;
        const h = state.habits.find((x) => x.id === id);
        h.archived = true;
        persist();
        renderAll();
        showToast(`${h.name} archived.`);
      });
    });
    panel.querySelectorAll('.restore-habit-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.target.closest('.habit-manage-row').dataset.id;
        const h = state.habits.find((x) => x.id === id);
        h.archived = false;
        persist();
        renderAll();
      });
    });
    panel.querySelectorAll('.delete-habit-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.target.closest('.habit-manage-row').dataset.id;
        const h = state.habits.find((x) => x.id === id);
        const ok = window.confirm(
          `Permanently delete "${h ? h.name : 'this habit'}"? This removes all its history, notes, and milestones — this can't be undone.`
        );
        if (!ok) return;
        state.habits = state.habits.filter((x) => x.id !== id);
        persist();
        renderAll();
      });
    });
  }

  // ---------- Insights tab ----------

  function renderInsights() {
    const panel = document.getElementById('tab-insights');
    const active = state.habits.filter((h) => !h.archived);

    if (active.length === 0) {
      panel.innerHTML = `<div class="empty-state"><h3>Nothing to show yet</h3><p>Check in on a habit and your insights will show up here.</p></div>`;
      return;
    }

    const weekStart = getWeekStart(new Date());
    let html = `<div class="section-heading"><h2>Your patterns</h2><p>Progress without judgment — look for what helps you return.</p></div>`;

    const returned = active.find((h) => h._returnedAfterGap);
    if (returned) {
      html += `<div class="insight-card"><p class="insight-label">Welcome back</p><p class="insight-value" style="font-size:14px;font-weight:500;">You checked in on ${escapeHtml(
        returned.name
      )} after a gap. That's the part that counts.</p></div>`;
    }

    active.forEach((habit) => {
      const done = weeklyCount(habit, weekStart);
      const adjustedTarget = effectiveWeeklyTarget(habit, weekStart);
      const previousWeekStart = new Date(weekStart);
      previousWeekStart.setDate(previousWeekStart.getDate() - 7);
      const previousDone = weeklyCount(habit, previousWeekStart);
      const previousTarget = effectiveWeeklyTarget(habit, previousWeekStart);
      const previousSummary = previousTarget === 0 ? 'paused' : `${previousDone}/${previousTarget}`;
      let completedWeeks = 0;
      let hitWeeks = 0;
      for (let offset = 1; offset <= 4; offset++) {
        const start = new Date(weekStart);
        start.setDate(start.getDate() - offset * 7);
        const target = effectiveWeeklyTarget(habit, start);
        if (target === 0) continue;
        completedWeeks++;
        if (weeklyCount(habit, start) >= target) hitWeeks++;
      }
      const currentWeekKeys = new Set(weekDates(weekStart).map((date) => dateKey(date)));
      const slipsThisWeek = Object.keys(habit.slips || {}).filter((key) => currentWeekKeys.has(key)).length;
      const remaining = Math.max(0, adjustedTarget - done);
      const paceText = adjustedTarget === 0
        ? 'Paused for the rest of this week'
        : remaining === 0
        ? 'Weekly target reached'
        : habit.type === 'avoid'
        ? `${remaining} more clean day${remaining === 1 ? '' : 's'} to target${slipsThisWeek ? ` · ${slipsThisWeek} slip${slipsThisWeek === 1 ? '' : 's'}` : ''}`
        : `${remaining} check-in${remaining === 1 ? '' : 's'} to reach your target`;
      const totalCheckins = habit.checkins ? Object.keys(habit.checkins).length : 0;
      const notes = recentHabitNotes(habit, 5);
      const notesHtml = notes.length
        ? `<div class="insight-notes">${notes
            .map(
              (n) =>
                `<p class="insight-note-row"><span class="insight-note-date">${formatDateKey(
                  n.date
                )}</span> ${escapeHtml(n.note)}</p>`
            )
            .join('')}</div>`
        : '';

      const c = rampVars(habit.ramp);
      const weekStripHtml = miniWeekStripHtml(habit, c);

      const longest = longestStreakEver(habit);
      const consistentDay = mostConsistentDay(habit);
      const mostNote = mostMentionedNote(habit);
      let extraHtml = '';
      if (longest > 0) {
        extraHtml += `<p class="habit-sub" style="margin-top:2px;">🔥 Longest streak: ${longest} week${longest === 1 ? '' : 's'}.</p>`;
      }
      if (consistentDay) {
        extraHtml += `<p class="habit-sub" style="margin-top:2px;">📅 Most common check-in day: ${consistentDay.day}.</p>`;
      }
      if (mostNote) {
        extraHtml += `<p class="habit-sub" style="margin-top:2px;">📝 Most mentioned: "${escapeHtml(mostNote.note)}" (${mostNote.count}×).</p>`;
      }

      const insightExpanded = expandedInsightFor.has(habit.id);
      const detailsHtml = insightExpanded
        ? `<p class="habit-sub" style="margin-top:6px;">✅ You've shown up for this ${totalCheckins} time${
            totalCheckins === 1 ? '' : 's'
          } in total.</p>
           <p class="habit-sub" style="margin-top:2px;">📈 Hit the target in ${hitWeeks} of ${completedWeeks} recent completed week${
            completedWeeks === 1 ? '' : 's'
          }.</p>
           ${extraHtml}
           ${notesHtml}`
        : '';

      html += `<div class="insight-card" style="background:color-mix(in srgb, var(--${habit.ramp}-fill) 45%, var(--surface-2));">
        <button type="button" class="insight-label insight-toggle-btn" data-id="${habit.id}">${habit.icon} ${escapeHtml(
        habit.name
      )} ${insightExpanded ? '▲' : '▾'}</button>
        <p class="insight-value">${adjustedTarget === 0 ? 'Paused this week' : `${done}/${adjustedTarget} this week`}</p>
        <p class="insight-summary">${paceText} · Last week: ${previousSummary}</p>
        ${weekStripHtml}
        ${detailsHtml}
      </div>`;
    });

    html += `<div class="section-heading achievements-heading"><h2>Achievements</h2><p>Celebrate the progress you've earned; only the next goals stay visible.</p></div>`;
    html += renderMilestonesHtml(active);

    panel.innerHTML = html;

    panel.querySelectorAll('.insight-toggle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (expandedInsightFor.has(id)) expandedInsightFor.delete(id);
        else expandedInsightFor.add(id);
        renderInsights();
      });
    });

    panel.querySelectorAll('.milestone-toggle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (expandedMilestoneFor.has(id)) expandedMilestoneFor.delete(id);
        else expandedMilestoneFor.add(id);
        renderInsights();
      });
    });
  }

  // ---------- Milestones within Insights ----------

  function renderMilestonesHtml(active) {
    let html = '';
    active.forEach((habit) => {
      const c = rampVars(habit.ramp);
      const totalCheckins = habit.checkins ? Object.keys(habit.checkins).length : 0;
      const achievedCheckinCount = CHECKIN_MILESTONES.filter((m) => totalCheckins >= m).length;
      const sortedKeys = habit.checkins ? Object.keys(habit.checkins).sort() : [];

      const next = CHECKIN_MILESTONES.find((m) => totalCheckins < m);
      const nextIndex = next ? CHECKIN_MILESTONES.indexOf(next) : CHECKIN_MILESTONES.length;
      const visibleCheckinMilestones = CHECKIN_MILESTONES.filter((m, index) => totalCheckins >= m || index <= nextIndex + 1);
      const badgesHtml = visibleCheckinMilestones.map((m) => {
        const achieved = totalCheckins >= m;
        const title = achieved
          ? sortedKeys[m - 1]
            ? `${m} check-ins · ${formatDateKey(sortedKeys[m - 1])}`
            : `${m} check-ins`
          : `${m - totalCheckins} to go`;
        const style = achieved ? `background:${c.mid};border-color:${c.mid};` : '';
        return `<div class="milestone-badge-wrap" title="${escapeHtml(title)}">
          <div class="milestone-badge ${achieved ? 'achieved' : ''}" style="${style}">${MILESTONE_ICONS[m] || '🏅'}</div>
          <span class="milestone-badge-label ${achieved ? 'achieved' : ''}">${m}</span>
        </div>`;
      }).join('');

      const nextHtml = next
        ? `<p class="habit-sub" style="margin-top:8px;color:var(--text-muted);">Next: ${next} check-ins (${
            next - totalCheckins
          } to go)</p>`
        : `<p class="habit-sub" style="margin-top:8px;color:var(--text-muted);">All milestones reached 🎉</p>`;

      const streakInfo = streakMilestoneInfo(habit);
      const nextStreakIndex = STREAK_MILESTONES.findIndex((m) => streakInfo.longest < m);
      const visibleStreakMilestones = STREAK_MILESTONES.filter(
        (m, index) => streakInfo.longest >= m || index <= (nextStreakIndex === -1 ? STREAK_MILESTONES.length : nextStreakIndex)
      );
      const streakBadgesHtml = visibleStreakMilestones.map((m) => {
        const achieved = streakInfo.longest >= m;
        const achievedDate = streakInfo.dates[m];
        const title = achieved
          ? achievedDate
            ? `${m}-week streak · ${formatDateKey(achievedDate)}`
            : `${m}-week streak`
          : `${m - streakInfo.longest} more week${m - streakInfo.longest === 1 ? '' : 's'} needed`;
        const style = achieved ? `background:${c.mid};border-color:${c.mid};` : '';
        return `<div class="milestone-badge-wrap" title="${escapeHtml(title)}">
          <div class="milestone-badge ${achieved ? 'achieved' : ''}" style="${style}">${STREAK_MILESTONE_ICONS[m]}</div>
          <span class="milestone-badge-label ${achieved ? 'achieved' : ''}">${m}w</span>
        </div>`;
      }).join('');

      const perfectMonths = perfectMonthsCount(habit);
      const perfectAchieved = perfectMonths >= 1;
      const perfectTitle = perfectAchieved
        ? `${perfectMonths} perfect month${perfectMonths === 1 ? '' : 's'} — hit your target every week`
        : 'Hit your target every week in a calendar month to unlock';
      const perfectStyle = perfectAchieved ? `background:${c.mid};border-color:${c.mid};` : '';
      const perfectHtml = `<div class="milestone-badge-wrap" title="${escapeHtml(perfectTitle)}">
        <div class="milestone-badge ${perfectAchieved ? 'achieved' : ''}" style="${perfectStyle}">🏵️</div>
        <span class="milestone-badge-label ${perfectAchieved ? 'achieved' : ''}">${
        perfectAchieved ? '×' + perfectMonths : 'Perfect'
      }</span>
      </div>`;

      const totalAchieved =
        achievedCheckinCount + STREAK_MILESTONES.filter((m) => streakInfo.longest >= m).length + (perfectAchieved ? 1 : 0);
      const milestoneExpanded = expandedMilestoneFor.has(habit.id);
      const summaryLabel = `🏅 ${totalAchieved} badge${totalAchieved === 1 ? '' : 's'} earned ${
        milestoneExpanded ? '▲' : '▾'
      }`;

      const detailsHtml = milestoneExpanded
        ? `<p class="milestone-section-label">Check-ins</p>
           <div class="milestone-badge-row">${badgesHtml}</div>
           ${nextHtml}
           <p class="milestone-section-label">Streaks</p>
           <div class="milestone-badge-row">${streakBadgesHtml}</div>
           <p class="milestone-section-label">Consistency</p>
           <div class="milestone-badge-row">${perfectHtml}</div>`
        : '';

      html += `<div class="insight-card" style="background:color-mix(in srgb, var(--${habit.ramp}-fill) 45%, var(--surface-2));">
        <p class="insight-label">${habit.icon} ${escapeHtml(habit.name)}</p>
        <button type="button" class="habit-sub habit-note-summary-btn milestone-toggle-btn" data-id="${habit.id}">${summaryLabel}</button>
        ${detailsHtml}
      </div>`;
    });
    return html;
  }

  // ---------- Habit create/edit modal ----------

  function openHabitModal(existingHabit) {
    const root = document.getElementById('modal-root');
    const isEdit = !!existingHabit;
    const draft = existingHabit
      ? { ...existingHabit }
      : {
          name: '',
          target: 3,
          reminderTime: '',
          miniVersion: '',
          icon: assignIcon('', state.habits.length),
          ramp: assignRamp(state.habits.length),
          scheduleDays: null,
          type: 'build',
        };

    const dayIndices = [1, 2, 3, 4, 5, 6, 0];

    root.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal">
          <h2>${isEdit ? 'Edit habit' : 'New habit'}</h2>
          <div class="form-group">
            <label for="habit-name">Name</label>
            <input type="text" id="habit-name" placeholder="Morning walk" value="${escapeHtml(draft.name)}" />
            <p class="error-text" id="name-error" style="display:none;">Enter a name for the habit.</p>
          </div>
          <div class="form-group">
            <label>Type</label>
            <div class="freq-options" id="type-options">
              <button type="button" class="freq-chip type-chip ${
                (draft.type || 'build') === 'build' ? 'selected' : ''
              }" data-type="build" aria-pressed="${(draft.type || 'build') === 'build'}">Build a habit</button>
              <button type="button" class="freq-chip type-chip ${
                draft.type === 'avoid' ? 'selected' : ''
              }" data-type="avoid" aria-pressed="${draft.type === 'avoid'}">Avoid a habit</button>
            </div>
          </div>
          <div class="form-group">
            <label>Schedule</label>
            <div class="freq-options" id="schedule-mode-options">
              <button type="button" class="freq-chip schedule-mode-chip ${!draft.scheduleDays ? 'selected' : ''}" data-mode="count" aria-pressed="${!draft.scheduleDays}">Any days/week</button>
              <button type="button" class="freq-chip schedule-mode-chip ${draft.scheduleDays ? 'selected' : ''}" data-mode="days" aria-pressed="${!!draft.scheduleDays}">Specific days</button>
            </div>
          </div>
          <div class="form-group" id="weekly-target-group" style="${draft.scheduleDays ? 'display:none;' : ''}">
            <label>Weekly target</label>
            <div class="freq-options" id="freq-options">
              ${[1, 2, 3, 4, 5, 6, 7]
                .map(
                  (n) =>
                    `<button type="button" class="freq-chip target-chip ${n === draft.target ? 'selected' : ''}" data-val="${n}" aria-pressed="${n === draft.target}">${n}x</button>`
                )
                .join('')}
            </div>
          </div>
          <div class="form-group" id="schedule-days-group" style="${draft.scheduleDays ? '' : 'display:none;'}">
            <label>Days</label>
            <div class="freq-options" id="schedule-days-options">
              ${dayIndices
                .map(
                  (i) =>
                    `<button type="button" class="freq-chip day-chip ${
                      draft.scheduleDays && draft.scheduleDays.includes(i) ? 'selected' : ''
                    }" data-day="${i}" aria-pressed="${!!(draft.scheduleDays && draft.scheduleDays.includes(i))}">${DAY_ABBR[i]}</button>`
                )
                .join('')}
            </div>
            <p class="error-text" id="schedule-error" style="display:none;">Pick at least one day.</p>
          </div>
          <details class="advanced-options" ${isEdit ? 'open' : ''}>
            <summary>Customize appearance, timing, and fallback</summary>
            <div class="advanced-options-body">
              <div class="form-group">
                <label>Time of day (optional)</label>
                <div class="freq-options" id="time-of-day-options">
                  ${['', 'morning', 'afternoon', 'evening']
                    .map(
                      (t) =>
                        `<button type="button" class="freq-chip time-chip ${
                          (draft.timeOfDay || '') === t ? 'selected' : ''
                        }" data-time="${t}" aria-pressed="${(draft.timeOfDay || '') === t}">${
                          t ? t[0].toUpperCase() + t.slice(1) : 'Any'
                        }</button>`
                    )
                    .join('')}
                </div>
              </div>
              <div class="form-group">
                <label>Icon</label>
                <div class="icon-options" id="icon-options">
                  ${ICON_CHOICES.map(
                    (ic) => `<button type="button" class="icon-chip ${ic === draft.icon ? 'selected' : ''}" data-icon="${ic}" aria-pressed="${ic === draft.icon}">${ic}</button>`
                  ).join('')}
                </div>
              </div>
              <div class="form-group">
                <label>Color</label>
                <div class="color-options" id="color-options">
                  ${RAMPS.map(
                    (r) =>
                      `<button type="button" class="color-chip ${r === draft.ramp ? 'selected' : ''}" data-ramp="${r}" style="background:var(--${r}-mid);" aria-label="${r}" aria-pressed="${r === draft.ramp}"></button>`
                  ).join('')}
                </div>
              </div>
              <div class="form-group">
                <label for="habit-reminder">Reminder time (optional)</label>
                <input type="time" id="habit-reminder" value="${draft.reminderTime || ''}" />
              </div>
              <div class="form-group">
                <label for="habit-mini">Minimum version (optional)</label>
                <input type="text" id="habit-mini" placeholder="e.g. Read 1 page" value="${escapeHtml(draft.miniVersion || '')}" />
                <p class="form-hint">A tiny fallback that still counts on difficult days.</p>
              </div>
              <div class="form-group">
                <label for="habit-end-date">Ends on (optional)</label>
                <input type="date" id="habit-end-date" value="${draft.endDate || ''}" />
                <p class="form-hint">For a short course — e.g. medicine for a week. Auto-archives the day after.</p>
              </div>
            </div>
          </details>
          <div class="modal-actions">
            <button class="btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn-primary" id="modal-save">${isEdit ? 'Save' : 'Create'}</button>
          </div>
        </div>
      </div>
    `;

    activateModal(root);

    let selectedType = draft.type || 'build';
    root.querySelectorAll('.type-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        root.querySelectorAll('.type-chip').forEach((c) => {
          c.classList.remove('selected');
          c.setAttribute('aria-pressed', 'false');
        });
        chip.classList.add('selected');
        chip.setAttribute('aria-pressed', 'true');
        selectedType = chip.dataset.type;
      });
    });

    let selectedTimeOfDay = draft.timeOfDay || '';
    root.querySelectorAll('.time-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        root.querySelectorAll('.time-chip').forEach((c) => {
          c.classList.remove('selected');
          c.setAttribute('aria-pressed', 'false');
        });
        chip.classList.add('selected');
        chip.setAttribute('aria-pressed', 'true');
        selectedTimeOfDay = chip.dataset.time;
      });
    });

    let selectedTarget = draft.target;
    root.querySelectorAll('.target-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        root.querySelectorAll('.target-chip').forEach((c) => {
          c.classList.remove('selected');
          c.setAttribute('aria-pressed', 'false');
        });
        chip.classList.add('selected');
        chip.setAttribute('aria-pressed', 'true');
        selectedTarget = Number(chip.dataset.val);
      });
    });

    let scheduleMode = draft.scheduleDays ? 'days' : 'count';
    const selectedDays = new Set(draft.scheduleDays || []);
    root.querySelectorAll('.schedule-mode-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        root.querySelectorAll('.schedule-mode-chip').forEach((c) => {
          c.classList.remove('selected');
          c.setAttribute('aria-pressed', 'false');
        });
        chip.classList.add('selected');
        chip.setAttribute('aria-pressed', 'true');
        scheduleMode = chip.dataset.mode;
        root.querySelector('#weekly-target-group').style.display = scheduleMode === 'count' ? '' : 'none';
        root.querySelector('#schedule-days-group').style.display = scheduleMode === 'days' ? '' : 'none';
      });
    });
    root.querySelectorAll('.day-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const day = Number(chip.dataset.day);
        if (selectedDays.has(day)) {
          selectedDays.delete(day);
          chip.classList.remove('selected');
          chip.setAttribute('aria-pressed', 'false');
        } else {
          selectedDays.add(day);
          chip.classList.add('selected');
          chip.setAttribute('aria-pressed', 'true');
        }
      });
    });

    let selectedIcon = draft.icon;
    let iconManuallySet = isEdit;
    root.querySelectorAll('.icon-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        root.querySelectorAll('.icon-chip').forEach((c) => {
          c.classList.remove('selected');
          c.setAttribute('aria-pressed', 'false');
        });
        chip.classList.add('selected');
        chip.setAttribute('aria-pressed', 'true');
        selectedIcon = chip.dataset.icon;
        iconManuallySet = true;
      });
    });

    let selectedRamp = draft.ramp;
    root.querySelectorAll('.color-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        root.querySelectorAll('.color-chip').forEach((c) => {
          c.classList.remove('selected');
          c.setAttribute('aria-pressed', 'false');
        });
        chip.classList.add('selected');
        chip.setAttribute('aria-pressed', 'true');
        selectedRamp = chip.dataset.ramp;
      });
    });

    const nameInputEl = root.querySelector('#habit-name');
    nameInputEl.addEventListener('input', () => {
      if (isEdit || iconManuallySet) return;
      const suggested = assignIcon(nameInputEl.value, state.habits.length);
      selectedIcon = suggested;
      root.querySelectorAll('.icon-chip').forEach((c) => {
        const selected = c.dataset.icon === suggested;
        c.classList.toggle('selected', selected);
        c.setAttribute('aria-pressed', String(selected));
      });
    });

    root.querySelector('#modal-cancel').addEventListener('click', closeModal);
    root.querySelector('#modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') closeModal();
    });

    root.querySelector('#modal-save').addEventListener('click', () => {
      const nameInput = root.querySelector('#habit-name');
      const name = nameInput.value.trim();
      const errorEl = root.querySelector('#name-error');
      if (!name) {
        errorEl.style.display = 'block';
        nameInput.focus();
        return;
      }
      errorEl.style.display = 'none';

      if (scheduleMode === 'days' && selectedDays.size === 0) {
        root.querySelector('#schedule-error').style.display = 'block';
        return;
      }
      root.querySelector('#schedule-error').style.display = 'none';

      const reminderTime = root.querySelector('#habit-reminder').value || null;
      const miniVersion = root.querySelector('#habit-mini').value.trim() || null;
      const endDate = root.querySelector('#habit-end-date').value || null;

      let scheduleDays = null;
      let finalTarget = selectedTarget;
      if (scheduleMode === 'days') {
        scheduleDays = Array.from(selectedDays).sort((a, b) => a - b);
        finalTarget = scheduleDays.length;
      }

      if (isEdit) {
        const h = state.habits.find((x) => x.id === existingHabit.id);
        h.name = name;
        h.type = selectedType;
        h.timeOfDay = selectedTimeOfDay || null;
        h.target = finalTarget;
        h.scheduleDays = scheduleDays;
        h.reminderTime = reminderTime;
        h.miniVersion = miniVersion;
        h.endDate = endDate;
        h.icon = selectedIcon;
        h.ramp = selectedRamp;
      } else {
        state.habits.push({
          id: 'h_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
          name,
          type: selectedType,
          timeOfDay: selectedTimeOfDay || null,
          icon: selectedIcon,
          ramp: selectedRamp,
          target: finalTarget,
          scheduleDays,
          reminderTime,
          miniVersion,
          endDate,
          createdAt: new Date().toISOString(),
          archived: false,
          checkins: {},
        });
      }

      persist();
      closeModal();
      renderAll();
    });

    nameInputFocus();
    function nameInputFocus() {
      setTimeout(() => root.querySelector('#habit-name').focus(), 30);
    }
  }

  function closeModal() {
    document.getElementById('modal-root').innerHTML = '';
    if (modalReturnFocus && typeof modalReturnFocus.focus === 'function') modalReturnFocus.focus();
    modalReturnFocus = null;
  }

  // ---------- Finished book create/edit modal ----------

  function openBookModal(existingBook) {
    const root = document.getElementById('modal-root');
    const isEdit = !!existingBook;
    const draft = existingBook || { title: '', author: '', finishedOn: todayKey(), rating: null, note: '' };
    const ratingOptions = [
      [0, 'Not rated'],
      [1, '★'],
      [2, '★★'],
      [3, '★★★'],
      [4, '★★★★'],
      [5, '★★★★★'],
    ];

    root.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal">
          <h2>${isEdit ? 'Edit finished book' : 'Log a finished book'}</h2>
          <div class="form-group">
            <label for="book-title">Title</label>
            <input type="text" id="book-title" placeholder="Book title" value="${escapeHtml(draft.title || '')}" />
            <p class="error-text" id="book-title-error" style="display:none;">Enter the book title.</p>
          </div>
          <div class="form-group">
            <label for="book-author">Author (optional)</label>
            <input type="text" id="book-author" placeholder="Author name" value="${escapeHtml(draft.author || '')}" />
          </div>
          <div class="form-group">
            <label>Cover (optional)</label>
            <div id="selected-cover-preview" class="selected-cover-preview"></div>
            <div class="cover-picker-actions">
              <button type="button" class="btn-secondary" id="find-book-cover">Find cover</button>
              <button type="button" class="btn-text" id="remove-book-cover">Remove cover</button>
            </div>
            <p class="form-hint">Search sends the title and author to Open Library.</p>
            <p class="cover-search-status" id="cover-search-status" role="status"></p>
            <div class="cover-search-results" id="cover-search-results"></div>
          </div>
          <div class="form-group">
            <label for="book-finished-on">Finished on</label>
            <input type="date" id="book-finished-on" max="${todayKey()}" value="${draft.finishedOn || todayKey()}" />
            <p class="error-text" id="book-date-error" style="display:none;">Choose a date no later than today.</p>
          </div>
          <div class="form-group">
            <label for="book-rating">Rating (optional)</label>
            <select id="book-rating">
              ${ratingOptions
                .map(
                  ([value, label]) =>
                    `<option value="${value}" ${Number(draft.rating || 0) === value ? 'selected' : ''}>${label}</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="form-group">
            <label for="book-note">A thought to remember (optional)</label>
            <textarea id="book-note" class="book-note-input" rows="3" placeholder="What stayed with you?">${escapeHtml(
              draft.note || ''
            )}</textarea>
          </div>
          <div class="modal-actions">
            <button class="btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn-primary" id="modal-save-book">${isEdit ? 'Save' : 'Add book'}</button>
          </div>
        </div>
      </div>`;

    activateModal(root);
    let selectedCover = draft.coverUrl
      ? {
          coverUrl: draft.coverUrl,
          coverId: draft.coverId || null,
          openLibraryKey: draft.openLibraryKey || null,
        }
      : null;

    function renderSelectedCover() {
      const preview = root.querySelector('#selected-cover-preview');
      const removeButton = root.querySelector('#remove-book-cover');
      if (selectedCover) {
        preview.innerHTML = `<img src="${escapeHtml(
          selectedCover.coverUrl
        )}" alt="Selected book cover" referrerpolicy="no-referrer" /><span>Cover selected</span>`;
        preview.querySelector('img').addEventListener('error', () => {
          preview.innerHTML = '<span>That cover could not be loaded. Try another.</span>';
        });
        removeButton.hidden = false;
      } else {
        preview.innerHTML = '<span class="cover-placeholder" aria-hidden="true">📖</span><span>No cover selected</span>';
        removeButton.hidden = true;
      }
    }

    renderSelectedCover();
    root.querySelector('#remove-book-cover').addEventListener('click', () => {
      selectedCover = null;
      root.querySelector('#cover-search-results').innerHTML = '';
      root.querySelector('#cover-search-status').textContent = '';
      renderSelectedCover();
    });
    root.querySelector('#find-book-cover').addEventListener('click', async () => {
      const title = root.querySelector('#book-title').value.trim();
      const author = root.querySelector('#book-author').value.trim();
      const status = root.querySelector('#cover-search-status');
      const results = root.querySelector('#cover-search-results');
      const button = root.querySelector('#find-book-cover');
      if (!title) {
        root.querySelector('#book-title-error').style.display = 'block';
        root.querySelector('#book-title').focus();
        return;
      }
      root.querySelector('#book-title-error').style.display = 'none';
      button.disabled = true;
      button.textContent = 'Searching…';
      status.textContent = '';
      results.innerHTML = '';
      try {
        const response = await window.api.searchBooks({ title, author });
        const matches = response && response.ok && Array.isArray(response.books) ? response.books : [];
        if (!response || !response.ok) {
          status.textContent = (response && response.error) || 'Cover search is unavailable.';
          return;
        }
        if (matches.length === 0) {
          status.textContent = 'No covers found. Try adding the author or adjusting the title.';
          return;
        }
        status.textContent = 'Choose the matching edition:';
        results.innerHTML = matches
          .map(
            (match, index) => `<button type="button" class="cover-result-btn" data-index="${index}">
              <img src="${escapeHtml(match.coverUrl)}" alt="" referrerpolicy="no-referrer" />
              <span><strong>${escapeHtml(match.title)}</strong><small>${escapeHtml(match.author || 'Unknown author')}${
              match.year ? ` · ${match.year}` : ''
            }</small></span>
            </button>`
          )
          .join('');
        results.querySelectorAll('.cover-result-btn').forEach((resultButton) => {
          resultButton.addEventListener('click', () => {
            const match = matches[Number(resultButton.dataset.index)];
            selectedCover = {
              coverUrl: match.coverUrl,
              coverId: match.coverId,
              openLibraryKey: match.key,
            };
            results.innerHTML = '';
            status.textContent = '';
            renderSelectedCover();
          });
        });
      } catch (err) {
        status.textContent = 'Cover search is unavailable.';
      } finally {
        button.disabled = false;
        button.textContent = 'Find cover';
      }
    });

    root.querySelector('#modal-cancel').addEventListener('click', closeModal);
    root.querySelector('#modal-overlay').addEventListener('click', (event) => {
      if (event.target.id === 'modal-overlay') closeModal();
    });
    root.querySelector('#modal-save-book').addEventListener('click', () => {
      const titleInput = root.querySelector('#book-title');
      const dateInput = root.querySelector('#book-finished-on');
      const title = titleInput.value.trim();
      const finishedOn = dateInput.value;
      const dateIsValid = !!finishedOn && finishedOn <= todayKey();
      root.querySelector('#book-title-error').style.display = title ? 'none' : 'block';
      root.querySelector('#book-date-error').style.display = dateIsValid ? 'none' : 'block';
      if (!title) {
        titleInput.focus();
        return;
      }
      if (!dateIsValid) {
        dateInput.focus();
        return;
      }

      const values = {
        title,
        author: root.querySelector('#book-author').value.trim() || null,
        finishedOn,
        rating: Number(root.querySelector('#book-rating').value) || null,
        note: root.querySelector('#book-note').value.trim() || null,
        coverUrl: selectedCover ? selectedCover.coverUrl : null,
        coverId: selectedCover ? selectedCover.coverId : null,
        openLibraryKey: selectedCover ? selectedCover.openLibraryKey : null,
        updatedAt: new Date().toISOString(),
      };
      if (isEdit) {
        Object.assign(state.books.find((book) => book.id === existingBook.id), values);
      } else {
        state.books.push({
          id: 'b_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
          ...values,
          createdAt: new Date().toISOString(),
        });
      }
      persist();
      closeModal();
      renderBooks();
      showToast(isEdit ? 'Book updated.' : 'Book added to your finished shelf.');
    });
  }

  // ---------- Settings modal ----------

  function openSettingsModal() {
    const root = document.getElementById('modal-root');
    state.settings = state.settings || {};
    const remindersOn = state.settings.notificationsEnabled !== false;
    const recapOn = state.settings.weeklyRecapEnabled !== false;

    root.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal">
          <h2>Settings</h2>
          <div class="form-group">
            <label class="settings-toggle-row">
              <input type="checkbox" id="setting-reminders" ${remindersOn ? 'checked' : ''} />
              <span>Daily habit reminders</span>
            </label>
          </div>
          <div class="form-group">
            <label class="settings-toggle-row">
              <input type="checkbox" id="setting-recap" ${recapOn ? 'checked' : ''} />
              <span>Weekly recap (Sunday 8pm)</span>
            </label>
          </div>
          <div class="form-group">
            <label>Data</label>
            <button class="btn-secondary" id="export-btn" style="width:100%;">Copy data as JSON</button>
            <button class="btn-secondary" id="import-btn" style="width:100%;margin-top:8px;">Import data from JSON</button>
          </div>
          <div class="modal-actions">
            <button class="btn-primary" id="modal-close-settings" style="width:100%;">Done</button>
          </div>
        </div>
      </div>
    `;

    activateModal(root);

    root.querySelector('#modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') closeModal();
    });
    root.querySelector('#modal-close-settings').addEventListener('click', closeModal);

    root.querySelector('#setting-reminders').addEventListener('change', (e) => {
      state.settings.notificationsEnabled = e.target.checked;
      persist();
    });
    root.querySelector('#setting-recap').addEventListener('change', (e) => {
      state.settings.weeklyRecapEnabled = e.target.checked;
      persist();
    });
    root.querySelector('#export-btn').addEventListener('click', () => {
      navigator.clipboard
        .writeText(JSON.stringify(state, null, 2))
        .then(() => showToast('Copied your data to the clipboard.'))
        .catch(() => showToast("Couldn't copy — try again."));
    });
    root.querySelector('#import-btn').addEventListener('click', () => openImportModal());
  }

  // ---------- Pause modal ----------

  function openPauseModal(habit) {
    const root = document.getElementById('modal-root');
    const today = todayKey();
    const weekLater = dateKey(new Date(Date.now() + 7 * 86400000));

    root.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal">
          <h2>Pause ${escapeHtml(habit.name)}</h2>
          <p class="habit-sub" style="margin:-8px 0 14px;">Paused days won't break your streak or send reminders.</p>
          <div class="form-group">
            <label for="pause-from">From</label>
            <input type="date" id="pause-from" value="${today}" />
          </div>
          <div class="form-group">
            <label for="pause-until">Until</label>
            <input type="date" id="pause-until" value="${weekLater}" />
          </div>
          <p class="error-text" id="pause-error" style="display:none;">End date must be on or after the start date.</p>
          <div class="modal-actions">
            <button class="btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn-primary" id="modal-save-pause">Pause</button>
          </div>
        </div>
      </div>
    `;

    activateModal(root);

    root.querySelector('#modal-cancel').addEventListener('click', closeModal);
    root.querySelector('#modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') closeModal();
    });

    root.querySelector('#modal-save-pause').addEventListener('click', () => {
      const from = root.querySelector('#pause-from').value;
      const until = root.querySelector('#pause-until').value;
      const errorEl = root.querySelector('#pause-error');
      if (!from || !until || until < from) {
        errorEl.style.display = 'block';
        return;
      }
      errorEl.style.display = 'none';

      habit.pauseWindows = habit.pauseWindows || [];
      habit.pauseWindows.push({ from, until });
      persist();
      closeModal();
      renderAll();
      showToast(`${habit.name} paused until ${formatDateKey(until)}.`);
    });
  }

  // ---------- Avoid-habit day chooser (empty past/today day in Week/Month grids) ----------

  function openAvoidDayModal(habit, key) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal">
          <h2>${habit.icon} ${escapeHtml(habit.name)}</h2>
          <p class="habit-sub" style="margin:-8px 0 14px;">${formatDateKey(key)}</p>
          <div class="modal-actions" style="flex-direction:column;gap:8px;">
            <button class="btn-primary" id="modal-mark-clean" style="width:100%;">Mark clean</button>
            <button class="btn-secondary" id="modal-log-slip" style="width:100%;">⚠️ Log a slip</button>
            <button class="btn-text" id="modal-cancel" style="width:100%;">Cancel</button>
          </div>
        </div>
      </div>
    `;

    root.querySelector('#modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') closeModal();
    });
    activateModal(root);

    root.querySelector('#modal-cancel').addEventListener('click', closeModal);
    root.querySelector('#modal-mark-clean').addEventListener('click', () => {
      toggleCheckinForDate(habit, key);
      closeModal();
    });
    root.querySelector('#modal-log-slip').addEventListener('click', () => {
      toggleSlip(habit, key);
      openDayNoteModal(habit, key);
    });
  }

  // ---------- Backfill note modal ----------

  function openDayNoteModal(habit, key) {
    const root = document.getElementById('modal-root');
    const hasCheckin = !!(habit.checkins && habit.checkins[key]);
    const hasSlip = !!(habit.slips && habit.slips[key]);
    if (!hasCheckin && !hasSlip) {
      closeModal();
      return;
    }

    const suggestions = habitNoteSuggestions(habit);
    const listId = `day-note-suggestions-${habit.id}`;
    const notes = (habit.dayNotes && habit.dayNotes[key]) || [];
    const canUndo = key !== todayKey();
    const notesListHtml = notes.length
      ? notes
          .map(
            (n, i) =>
              `<p class="habit-sub habit-note">• ${escapeHtml(n)} <button type="button" class="note-delete-btn" data-idx="${i}" aria-label="Delete note">×</button></p>`
          )
          .join('')
      : `<p class="habit-sub">No notes yet for this day.</p>`;

    root.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal">
          <h2>${habit.icon} ${escapeHtml(habit.name)}</h2>
          <p class="habit-sub" style="margin:-8px 0 14px;">${formatDateKey(key)}</p>
          <div id="day-notes-list">${notesListHtml}</div>
          <div class="form-group" style="margin-top:14px;">
            <label for="day-note-input">Add a note</label>
            <input type="text" id="day-note-input" list="${listId}" placeholder="e.g. which book" />
            <datalist id="${listId}">
              ${suggestions.map((s) => `<option value="${escapeHtml(s)}"></option>`).join('')}
            </datalist>
          </div>
          ${canUndo && hasCheckin ? `<button type="button" class="btn-text" id="modal-undo-checkin" style="display:block;margin:10px 0 0;padding:0;">Undo check-in</button>` : ''}
          ${hasSlip ? `<p class="habit-sub" style="margin:10px 0 0;">⚠️ Slip logged</p><button type="button" class="btn-text" id="modal-undo-slip" style="display:block;margin:2px 0 0;padding:0;">Undo slip</button>` : ''}
          <div class="modal-actions">
            <button class="btn-secondary" id="modal-cancel">Close</button>
            <button class="btn-primary" id="modal-save-day-note">Add note</button>
          </div>
        </div>
      </div>
    `;

    activateModal(root);

    root.querySelector('#modal-cancel').addEventListener('click', closeModal);
    root.querySelector('#modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') closeModal();
    });

    if (canUndo && hasCheckin) {
      root.querySelector('#modal-undo-checkin').addEventListener('click', () => {
        toggleCheckinForDate(habit, key);
        closeModal();
      });
    }
    if (hasSlip) {
      root.querySelector('#modal-undo-slip').addEventListener('click', () => {
        toggleSlip(habit, key);
        closeModal();
      });
    }

    root.querySelectorAll('.note-delete-btn').forEach((delBtn) => {
      delBtn.addEventListener('click', () => {
        const idx = Number(delBtn.dataset.idx);
        if (habit.dayNotes && habit.dayNotes[key]) {
          habit.dayNotes[key].splice(idx, 1);
          persist();
          renderAll();
          openDayNoteModal(habit, key);
        }
      });
    });

    const addNoteToDay = () => {
      const input = root.querySelector('#day-note-input');
      const val = input.value.trim();
      if (!val) return;
      habit.dayNotes = habit.dayNotes || {};
      habit.dayNotes[key] = habit.dayNotes[key] || [];
      habit.dayNotes[key].push(val);
      persist();
      renderAll();
      openDayNoteModal(habit, key);
    };

    root.querySelector('#modal-save-day-note').addEventListener('click', addNoteToDay);
    root.querySelector('#day-note-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addNoteToDay();
      }
    });

    setTimeout(() => root.querySelector('#day-note-input').focus(), 30);
  }

  // ---------- Import modal ----------

  function openImportModal() {
    const root = document.getElementById('modal-root');
    root.innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal">
          <h2>Import data</h2>
          <div class="form-group">
            <label for="import-json">Paste exported JSON</label>
            <textarea id="import-json" class="import-textarea" rows="8"></textarea>
            <p class="error-text" id="import-error" style="display:none;">That doesn't look like valid habit data.</p>
          </div>
          <div class="modal-actions">
            <button class="btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn-primary" id="modal-import">Import</button>
          </div>
        </div>
      </div>
    `;

    activateModal(root);

    root.querySelector('#modal-cancel').addEventListener('click', closeModal);
    root.querySelector('#modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') closeModal();
    });

    root.querySelector('#modal-import').addEventListener('click', () => {
      const raw = root.querySelector('#import-json').value.trim();
      const errorEl = root.querySelector('#import-error');
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        errorEl.style.display = 'block';
        return;
      }
      if (!parsed || !Array.isArray(parsed.habits)) {
        errorEl.style.display = 'block';
        return;
      }
      errorEl.style.display = 'none';

      const ok = window.confirm('This will replace all your current habits and history. Continue?');
      if (!ok) return;

      replaceState({
        habits: parsed.habits,
        books: Array.isArray(parsed.books) ? parsed.books : [],
        settings: parsed.settings || { notificationsEnabled: true },
      });
      persist();
      closeModal();
      renderAll();
      showToast('Data imported.');
    });

    setTimeout(() => root.querySelector('#import-json').focus(), 30);
  }

  // ---------- tab switching ----------

  function switchTab(tab) {
    uiState.currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach((button) => {
      const selected = button.dataset.tab === tab;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      const selected = panel.id === `tab-${tab}`;
      panel.classList.toggle('active', selected);
      panel.hidden = !selected;
    });
    renderAll();
  }

  function renderAll() {
    renderToday();
    renderWeek();
    renderBooks();
    renderHabitsTab();
    renderInsights();
  }

  // ---------- init ----------

  async function init() {
    setRenderCallbacks({ renderToday, renderAll });
    await loadState();
    const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
    tabButtons.forEach((btn, index) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
      btn.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        let nextIndex = index;
        if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabButtons.length) % tabButtons.length;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabButtons.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = tabButtons.length - 1;
        const next = tabButtons[nextIndex];
        switchTab(next.dataset.tab);
        next.focus();
      });
    });
    if (window.api.onNavigateToToday) {
      window.api.onNavigateToToday(() => switchTab('today'));
    }
    if (window.api.onDataChanged) {
      window.api.onDataChanged(async () => {
        await loadState();
        renderAll();
      });
    }
    switchTab(uiState.currentTab);
  }

  init();
})();
