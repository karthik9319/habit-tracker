import {
  DAY_ABBR,
  CHECKIN_MILESTONES,
  MILESTONE_ICONS,
  STREAK_MILESTONES,
  STREAK_MILESTONE_ICONS,
  ICON_CHOICES,
  RAMPS,
} from './constants.js';
import { dateKey, todayKey, getWeekStart, weekDates, daysBetween, formatDateKey } from './date-utils.js';
import {
  weeklyCount,
  weeklyStreak,
  activePauseWindow,
  weekOverlapsPause,
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

(function () {
  'use strict';

  let state = { habits: [], settings: { notificationsEnabled: true } };
  let currentTab = 'today';
  let openNoteHabitId = null;
  let weekViewMode = 'week';
  let expandedNotesFor = new Set();
  let expandedInsightFor = new Set();
  let expandedMilestoneFor = new Set();

  // ---------- persistence ----------

  async function loadState() {
    try {
      const data = await window.api.loadData();
      state = data && data.habits ? data : { habits: [], settings: { notificationsEnabled: true } };
    } catch (err) {
      console.error('Load failed', err);
      showToast("Couldn't load your data. Starting fresh.");
      state = { habits: [], settings: { notificationsEnabled: true } };
    }
    migrateNoteFields();
  }

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

  async function persist() {
    try {
      const ok = await window.api.saveData(state);
      if (!ok) showToast("Couldn't save — try again.");
    } catch (err) {
      console.error('Save failed', err);
      showToast("Couldn't save — try again.");
    }
  }

  function resumeHabitNow(habit) {
    const window = activePauseWindow(habit, todayKey());
    if (!window) return;
    const yesterday = dateKey(new Date(Date.now() - 86400000));
    if (yesterday < window.from) {
      habit.pauseWindows = habit.pauseWindows.filter((w) => w !== window);
    } else {
      window.until = yesterday;
    }
    persist();
    renderAll();
  }

  // ---------- toast ----------

  let toastTimer = null;
  function showToast(message, options) {
    const celebratory = options && options.celebratory;
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.style.cssText =
        'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);color:#fff;' +
        'padding:10px 16px;border-radius:10px;font-size:13px;z-index:200;opacity:0;transition:opacity 0.2s ease, background 0.15s ease;max-width:320px;text-align:center;';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.style.background = celebratory ? 'var(--purple-mid)' : '#2C2C2A';
    el.style.fontWeight = celebratory ? '600' : 'normal';
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => {
        el.style.opacity = '0';
      },
      celebratory ? 3600 : 2600
    );
  }

  // ---------- SVG ring ----------

  function ringSvg(pct, midColor, fillColor) {
    const r = 26, c = 2 * Math.PI * r;
    const offset = c * (1 - Math.min(pct, 1));
    return `<svg width="64" height="64" viewBox="0 0 64 64" style="transform: rotate(-90deg);">
      <circle cx="32" cy="32" r="${r}" fill="none" stroke="${fillColor}" stroke-width="6"></circle>
      <circle cx="32" cy="32" r="${r}" fill="none" stroke="${midColor}" stroke-width="6" stroke-linecap="round"
        stroke-dasharray="${c}" stroke-dashoffset="${offset}" style="transition: stroke-dashoffset 0.35s ease;"></circle>
    </svg>`;
  }

  function rampVars(ramp) {
    return {
      fill: `var(--${ramp}-fill)`,
      mid: `var(--${ramp}-mid)`,
      text: `var(--${ramp}-text)`,
    };
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

    const doneToday = active.filter((h) => h.checkins && h.checkins[todayKey()]).length;
    const now = new Date();
    const hour = now.getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const dateLabel = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

    panel.innerHTML = `
      <div class="today-header">
        <h2 class="today-greeting">${greeting}</h2>
        <p class="today-date">${dateLabel}</p>
      </div>
      <p class="today-summary">${doneToday} of ${active.length} done today</p>
      <div id="today-list"></div>
      <button class="btn-secondary" id="add-habit-btn" style="width:100%;margin-top:14px;">+ Add habit</button>
    `;

    const container = panel.querySelector('#today-list');
    const anyGrouped = active.some((h) => h.timeOfDay);

    if (!anyGrouped) {
      const list = document.createElement('div');
      list.className = 'habit-list';
      active.forEach((habit) => list.appendChild(renderHabitCard(habit)));
      container.appendChild(list);
    } else {
      const groups = [
        { key: 'morning', label: 'Morning' },
        { key: 'afternoon', label: 'Afternoon' },
        { key: 'evening', label: 'Evening' },
        { key: null, label: 'Anytime' },
      ];
      groups.forEach((g) => {
        const inGroup = active.filter((h) => (h.timeOfDay || null) === g.key);
        if (inGroup.length === 0) return;
        const header = document.createElement('p');
        header.className = 'today-group-label';
        header.textContent = g.label;
        container.appendChild(header);
        const list = document.createElement('div');
        list.className = 'habit-list';
        inGroup.forEach((habit) => list.appendChild(renderHabitCard(habit)));
        container.appendChild(list);
      });
    }

    panel.querySelector('#add-habit-btn').addEventListener('click', () => openHabitModal(null));
  }

  function renderHabitCard(habit) {
    const card = document.createElement('div');
    card.className = 'habit-card';
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
      wrap.appendChild(card);
      const resumeBtn = document.createElement('button');
      resumeBtn.type = 'button';
      resumeBtn.textContent = 'Resume now';
      resumeBtn.className = 'btn-text';
      resumeBtn.style.cssText = 'display:block;margin:4px 0 0 86px;padding:0;font-size:12px;';
      resumeBtn.addEventListener('click', () => resumeHabitNow(habit));
      wrap.appendChild(resumeBtn);
      return wrap;
    }

    const weekStart = getWeekStart(new Date());
    const done = weeklyCount(habit, weekStart);
    const todayEntry = habit.checkins && habit.checkins[todayKey()];
    const checkedToday = !!todayEntry;
    const pct = habit.target > 0 ? done / habit.target : 0;
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
      ? `${done} of ${habit.target} ${dayWord} this week`
      : `${done} of ${habit.target} this week`;
    const scheduleLabel = habit.scheduleDays
      ? `<p class="habit-sub" style="margin-top:1px;">${habit.scheduleDays.map((d) => DAY_ABBR[d]).join(', ')}</p>`
      : '';
    const typeBadge = isAvoid ? `<span class="habit-type-badge">avoid</span>` : '';

    card.innerHTML = `
      <div class="habit-icon" style="background:${c.fill};">${habit.icon}</div>
      <div class="habit-info">
        <p class="habit-name-row">${escapeHtml(habit.name)}${typeBadge}${streakBadge}</p>
        <p class="habit-sub">${weekSubLabel}</p>
        ${scheduleLabel}
        ${notesHtml}
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

    const wrap = document.createElement('div');
    wrap.appendChild(card);

    if (!checkedToday && habit.miniVersion) {
      const mini = document.createElement('button');
      mini.textContent = `Just do: ${habit.miniVersion}`;
      mini.className = 'btn-text';
      mini.style.cssText = 'display:block;margin-top:6px;padding:0;font-size:12px;';
      const miniWrap = document.createElement('div');
      miniWrap.style.cssText = 'margin:-4px 0 0 86px;';
      miniWrap.appendChild(mini);
      wrap.appendChild(miniWrap);
      mini.addEventListener('click', () => toggleCheckin(habit, btn, true));
    }

    if (checkedToday) {
      if (openNoteHabitId === habit.id) {
        wrap.appendChild(renderNoteInput(habit));
      } else {
        const addNote = document.createElement('button');
        addNote.type = 'button';
        addNote.textContent = todayNotes.length ? '+ add another note' : '+ add a note';
        addNote.className = 'btn-text';
        addNote.style.cssText = 'display:block;margin:4px 0 0 86px;padding:0;font-size:12px;';
        addNote.addEventListener('click', () => {
          openNoteHabitId = habit.id;
          renderToday();
        });
        wrap.appendChild(addNote);
      }
    }

    return wrap;
  }

  function renderNoteInput(habit) {
    const key = todayKey();
    const suggestions = habitNoteSuggestions(habit);
    const listId = `note-suggestions-${habit.id}`;

    const row = document.createElement('div');
    row.className = 'note-input-row';
    row.innerHTML = `
      <input type="text" class="note-input" list="${listId}" placeholder="Add a note (optional) — e.g. which book" />
      <datalist id="${listId}">
        ${suggestions.map((s) => `<option value="${escapeHtml(s)}"></option>`).join('')}
      </datalist>
    `;

    const input = row.querySelector('.note-input');
    let committed = false;

    const commit = () => {
      if (committed) return;
      committed = true;
      const val = input.value.trim();
      if (val && habit.checkins[key]) {
        habit.dayNotes = habit.dayNotes || {};
        habit.dayNotes[key] = habit.dayNotes[key] || [];
        habit.dayNotes[key].push(val);
      }
      openNoteHabitId = null;
      persist();
      renderToday();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        committed = true;
        openNoteHabitId = null;
        renderToday();
      }
    });
    input.addEventListener('blur', commit);

    setTimeout(() => input.focus(), 30);

    return row;
  }

  function toggleCheckin(habit, btnEl, isMini) {
    const key = todayKey();
    habit.checkins = habit.checkins || {};
    const wasChecked = !!habit.checkins[key];

    if (wasChecked) {
      delete habit.checkins[key];
      if (openNoteHabitId === habit.id) openNoteHabitId = null;
    } else {
      const gapKey = lastCheckinBeforeToday(habit);
      habit.checkins[key] = { done: true, mini: !!isMini };
      if (gapKey && daysBetween(gapKey, key) >= 10) {
        habit._returnedAfterGap = true;
      }
      openNoteHabitId = habit.id;

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
        renderToday();
      }, 180);
    } else {
      renderToday();
    }

    persist();
  }

  // ---------- Week tab ----------

  function renderWeek() {
    const panel = document.getElementById('tab-week');
    const active = state.habits.filter((h) => !h.archived);

    if (active.length === 0) {
      panel.innerHTML = `<div class="empty-state"><h3>No habits yet</h3><p>Add a habit to see your week take shape here.</p></div>`;
      return;
    }

    const toggleHtml = `
      <div class="view-toggle">
        <button type="button" class="view-toggle-btn ${weekViewMode === 'week' ? 'active' : ''}" data-mode="week">Week</button>
        <button type="button" class="view-toggle-btn ${weekViewMode === 'month' ? 'active' : ''}" data-mode="month">Month</button>
      </div>
    `;

    const body = weekViewMode === 'month' ? renderMonthGridHtml(active) : renderWeekGridHtml(active);
    panel.innerHTML = toggleHtml + body;

    panel.querySelectorAll('.view-toggle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        weekViewMode = btn.dataset.mode;
        renderWeek();
      });
    });

    panel.querySelectorAll('.day-dot-clickable').forEach((dot) => {
      dot.addEventListener('click', () => {
        const habit = state.habits.find((h) => h.id === dot.dataset.habitId);
        if (habit) openDayNoteModal(habit, dot.dataset.dateKey);
      });
    });
  }

  function renderWeekGridHtml(active) {
    const weekStart = getWeekStart(new Date());
    const dates = weekDates(weekStart);
    const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const todayStr = todayKey();

    let html = `<p class="today-summary">Week of ${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>`;

    active.forEach((habit) => {
      const c = rampVars(habit.ramp);
      html += `<div class="week-habit-block">
        <p class="week-habit-title"><span>${habit.icon}</span> ${escapeHtml(habit.name)}</p>
        <div class="week-grid">`;
      dates.forEach((d, i) => {
        const key = dateKey(d);
        const entry = habit.checkins && habit.checkins[key];
        const done = !!entry;
        const notes = (done && habit.dayNotes && habit.dayNotes[key]) || [];
        const isFuture = key > todayStr;
        const style = done
          ? `background:${c.mid};border-color:${c.mid};`
          : isFuture
          ? 'opacity:0.4;'
          : '';
        html += `<div class="week-day">
          <div class="week-day-label">${dayLabels[i]}</div>
          <div class="week-day-dot ${done ? 'day-dot-clickable' : ''}" style="${style}" ${
          done ? `data-habit-id="${habit.id}" data-date-key="${key}"` : ''
        } ${notes.length ? `title="${escapeHtml(notes.join(' · '))}"` : ''}></div>
        </div>`;
      });
      html += `</div></div>`;
    });

    return html;
  }

  function renderMonthGridHtml(active) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const todayStr = todayKey();
    const monthLabel = now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const leadingBlanks = (new Date(year, month, 1).getDay() + 6) % 7;

    let html = `<p class="today-summary">${monthLabel}</p>`;

    active.forEach((habit) => {
      const c = rampVars(habit.ramp);
      html += `<div class="week-habit-block">
        <p class="week-habit-title"><span>${habit.icon}</span> ${escapeHtml(habit.name)}</p>
        <div class="month-grid">`;

      dayLabels.forEach((l) => {
        html += `<div class="month-day-label">${l}</div>`;
      });

      for (let i = 0; i < leadingBlanks; i++) {
        html += `<div class="month-day-empty"></div>`;
      }

      for (let d = 1; d <= totalDays; d++) {
        const date = new Date(year, month, d);
        const key = dateKey(date);
        const entry = habit.checkins && habit.checkins[key];
        const done = !!entry;
        const notes = (done && habit.dayNotes && habit.dayNotes[key]) || [];
        const isFuture = key > todayStr;
        const style = done
          ? `background:${c.mid};border-color:${c.mid};`
          : isFuture
          ? 'opacity:0.4;'
          : '';
        const dateLabel = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        const title = notes.length ? `${dateLabel}: ${notes.join(' · ')}` : dateLabel;
        html += `<div class="month-day-dot ${done ? 'day-dot-clickable' : ''}" style="${style}" ${
          done ? `data-habit-id="${habit.id}" data-date-key="${key}"` : ''
        } title="${escapeHtml(title)}"></div>`;
      }

      html += `</div></div>`;
    });

    return html;
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
          pauseWindow ? ' · ⏸ paused' : ''
        }</p>
            </div>
            <button class="btn-text edit-habit-btn">Edit</button>
            <button class="btn-text ${pauseWindow ? 'resume-habit-btn' : 'pause-habit-btn'}">${
          pauseWindow ? 'Resume' : 'Pause'
        }</button>
            <button class="btn-text archive-habit-btn">Archive</button>
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
            <button class="btn-text restore-habit-btn">Restore</button>
            <button class="btn-text delete-habit-btn">Delete</button>
          </div>`;
      });
    }

    html += `</div>
      <p id="storage-status" class="habit-sub" style="margin:20px 0 0;">Checking storage…</p>
      <button class="btn-secondary" id="export-btn" style="width:100%;margin-top:10px;">Copy data as JSON</button>
      <button class="btn-secondary" id="import-btn" style="width:100%;margin-top:8px;">Import data from JSON</button>
      <button class="btn-secondary" id="settings-btn" style="width:100%;margin-top:8px;">⚙️ Settings</button>`;

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
    panel.querySelector('#export-btn').addEventListener('click', () => {
      navigator.clipboard
        .writeText(JSON.stringify(state, null, 2))
        .then(() => showToast('Copied your data to the clipboard.'))
        .catch(() => showToast("Couldn't copy — try again."));
    });
    panel.querySelector('#import-btn').addEventListener('click', () => openImportModal());

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

  function moveHabit(id, direction) {
    const active = state.habits.filter((h) => !h.archived);
    const posInActive = active.findIndex((h) => h.id === id);
    const swapPos = posInActive + direction;
    if (posInActive === -1 || swapPos < 0 || swapPos >= active.length) return;
    const otherId = active[swapPos].id;

    const idxA = state.habits.findIndex((h) => h.id === id);
    const idxB = state.habits.findIndex((h) => h.id === otherId);
    [state.habits[idxA], state.habits[idxB]] = [state.habits[idxB], state.habits[idxA]];

    persist();
    renderAll();
  }

  function miniWeekStripHtml(habit, c) {
    const weekStart = getWeekStart(new Date());
    const dates = weekDates(weekStart);
    const todayStr = todayKey();
    let html = '<div class="mini-week-strip">';
    dates.forEach((d) => {
      const key = dateKey(d);
      const done = !!(habit.checkins && habit.checkins[key]);
      const isFuture = key > todayStr;
      const style = done ? `background:${c.mid};border-color:${c.mid};` : isFuture ? 'opacity:0.35;' : '';
      html += `<div class="mini-week-dot" style="${style}"></div>`;
    });
    html += '</div>';
    return html;
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
    let html = '';

    const returned = active.find((h) => h._returnedAfterGap);
    if (returned) {
      html += `<div class="insight-card"><p class="insight-label">Welcome back</p><p class="insight-value" style="font-size:14px;font-weight:500;">You checked in on ${escapeHtml(
        returned.name
      )} after a gap. That's the part that counts.</p></div>`;
    }

    active.forEach((habit) => {
      const done = weeklyCount(habit, weekStart);
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
        extraHtml += `<p class="habit-sub" style="margin-top:2px;">📅 Most consistent on ${consistentDay.day}s.</p>`;
      }
      if (mostNote) {
        extraHtml += `<p class="habit-sub" style="margin-top:2px;">📝 Most mentioned: "${escapeHtml(mostNote.note)}" (${mostNote.count}×).</p>`;
      }

      const insightExpanded = expandedInsightFor.has(habit.id);
      const detailsHtml = insightExpanded
        ? `<p class="habit-sub" style="margin-top:6px;">✅ You've shown up for this ${totalCheckins} time${
            totalCheckins === 1 ? '' : 's'
          } in total.</p>
           ${extraHtml}
           ${notesHtml}`
        : '';

      html += `<div class="insight-card" style="background:color-mix(in srgb, var(--${habit.ramp}-fill) 45%, var(--surface-2));">
        <button type="button" class="insight-label insight-toggle-btn" data-id="${habit.id}">${habit.icon} ${escapeHtml(
        habit.name
      )} ${insightExpanded ? '▲' : '▾'}</button>
        <p class="insight-value">${done}/${habit.target} this week</p>
        ${weekStripHtml}
        ${detailsHtml}
      </div>`;
    });

    panel.innerHTML = html;

    panel.querySelectorAll('.insight-toggle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (expandedInsightFor.has(id)) expandedInsightFor.delete(id);
        else expandedInsightFor.add(id);
        renderInsights();
      });
    });
  }

  // ---------- Milestones tab ----------

  function renderMilestones() {
    const panel = document.getElementById('tab-milestones');
    const active = state.habits.filter((h) => !h.archived);

    if (active.length === 0) {
      panel.innerHTML = `<div class="empty-state"><h3>Nothing yet</h3><p>Check in on a habit and milestones will show up here.</p></div>`;
      return;
    }

    let html = '';
    active.forEach((habit) => {
      const c = rampVars(habit.ramp);
      const totalCheckins = habit.checkins ? Object.keys(habit.checkins).length : 0;
      const achievedCheckinCount = CHECKIN_MILESTONES.filter((m) => totalCheckins >= m).length;
      const sortedKeys = habit.checkins ? Object.keys(habit.checkins).sort() : [];

      const badgesHtml = CHECKIN_MILESTONES.map((m) => {
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

      const next = CHECKIN_MILESTONES.find((m) => totalCheckins < m);
      const nextHtml = next
        ? `<p class="habit-sub" style="margin-top:8px;color:var(--text-muted);">Next: ${next} check-ins (${
            next - totalCheckins
          } to go)</p>`
        : `<p class="habit-sub" style="margin-top:8px;color:var(--text-muted);">All milestones reached 🎉</p>`;

      const streakInfo = streakMilestoneInfo(habit);
      const streakBadgesHtml = STREAK_MILESTONES.map((m) => {
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

    panel.innerHTML = html;

    panel.querySelectorAll('.milestone-toggle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (expandedMilestoneFor.has(id)) expandedMilestoneFor.delete(id);
        else expandedMilestoneFor.add(id);
        renderMilestones();
      });
    });
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

    const dayAbbr = DAY_ABBR;

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
              }" data-type="build">Build a habit</button>
              <button type="button" class="freq-chip type-chip ${
                draft.type === 'avoid' ? 'selected' : ''
              }" data-type="avoid">Avoid a habit</button>
            </div>
          </div>
          <div class="form-group">
            <label>Time of day (optional)</label>
            <div class="freq-options" id="time-of-day-options">
              ${['', 'morning', 'afternoon', 'evening']
                .map(
                  (t) =>
                    `<button type="button" class="freq-chip time-chip ${
                      (draft.timeOfDay || '') === t ? 'selected' : ''
                    }" data-time="${t}">${t ? t[0].toUpperCase() + t.slice(1) : 'Any'}</button>`
                )
                .join('')}
            </div>
          </div>
          <div class="form-group">
            <label>Schedule</label>
            <div class="freq-options" id="schedule-mode-options">
              <button type="button" class="freq-chip schedule-mode-chip ${!draft.scheduleDays ? 'selected' : ''}" data-mode="count">Any days/week</button>
              <button type="button" class="freq-chip schedule-mode-chip ${draft.scheduleDays ? 'selected' : ''}" data-mode="days">Specific days</button>
            </div>
          </div>
          <div class="form-group" id="weekly-target-group" style="${draft.scheduleDays ? 'display:none;' : ''}">
            <label>Weekly target</label>
            <div class="freq-options" id="freq-options">
              ${[1, 2, 3, 4, 5, 6, 7]
                .map(
                  (n) =>
                    `<button type="button" class="freq-chip target-chip ${n === draft.target ? 'selected' : ''}" data-val="${n}">${n}x</button>`
                )
                .join('')}
            </div>
          </div>
          <div class="form-group" id="schedule-days-group" style="${draft.scheduleDays ? '' : 'display:none;'}">
            <label>Days</label>
            <div class="freq-options" id="schedule-days-options">
              ${dayAbbr
                .map(
                  (d, i) =>
                    `<button type="button" class="freq-chip day-chip ${
                      draft.scheduleDays && draft.scheduleDays.includes(i) ? 'selected' : ''
                    }" data-day="${i}">${d}</button>`
                )
                .join('')}
            </div>
            <p class="error-text" id="schedule-error" style="display:none;">Pick at least one day.</p>
          </div>
          <div class="form-group">
            <label>Icon</label>
            <div class="icon-options" id="icon-options">
              ${ICON_CHOICES.map(
                (ic) => `<button type="button" class="icon-chip ${ic === draft.icon ? 'selected' : ''}" data-icon="${ic}">${ic}</button>`
              ).join('')}
            </div>
          </div>
          <div class="form-group">
            <label>Color</label>
            <div class="color-options" id="color-options">
              ${RAMPS.map(
                (r) =>
                  `<button type="button" class="color-chip ${r === draft.ramp ? 'selected' : ''}" data-ramp="${r}" style="background:var(--${r}-mid);" aria-label="${r}"></button>`
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
          </div>
          <div class="modal-actions">
            <button class="btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn-primary" id="modal-save">${isEdit ? 'Save' : 'Create'}</button>
          </div>
        </div>
      </div>
    `;

    let selectedType = draft.type || 'build';
    root.querySelectorAll('.type-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        root.querySelectorAll('.type-chip').forEach((c) => c.classList.remove('selected'));
        chip.classList.add('selected');
        selectedType = chip.dataset.type;
      });
    });

    let selectedTimeOfDay = draft.timeOfDay || '';
    root.querySelectorAll('.time-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        root.querySelectorAll('.time-chip').forEach((c) => c.classList.remove('selected'));
        chip.classList.add('selected');
        selectedTimeOfDay = chip.dataset.time;
      });
    });

    let selectedTarget = draft.target;
    root.querySelectorAll('.target-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        root.querySelectorAll('.target-chip').forEach((c) => c.classList.remove('selected'));
        chip.classList.add('selected');
        selectedTarget = Number(chip.dataset.val);
      });
    });

    let scheduleMode = draft.scheduleDays ? 'days' : 'count';
    const selectedDays = new Set(draft.scheduleDays || []);
    root.querySelectorAll('.schedule-mode-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        root.querySelectorAll('.schedule-mode-chip').forEach((c) => c.classList.remove('selected'));
        chip.classList.add('selected');
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
        } else {
          selectedDays.add(day);
          chip.classList.add('selected');
        }
      });
    });

    let selectedIcon = draft.icon;
    let iconManuallySet = isEdit;
    root.querySelectorAll('.icon-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        root.querySelectorAll('.icon-chip').forEach((c) => c.classList.remove('selected'));
        chip.classList.add('selected');
        selectedIcon = chip.dataset.icon;
        iconManuallySet = true;
      });
    });

    let selectedRamp = draft.ramp;
    root.querySelectorAll('.color-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        root.querySelectorAll('.color-chip').forEach((c) => c.classList.remove('selected'));
        chip.classList.add('selected');
        selectedRamp = chip.dataset.ramp;
      });
    });

    const nameInputEl = root.querySelector('#habit-name');
    nameInputEl.addEventListener('input', () => {
      if (isEdit || iconManuallySet) return;
      const suggested = assignIcon(nameInputEl.value, state.habits.length);
      selectedIcon = suggested;
      root.querySelectorAll('.icon-chip').forEach((c) => c.classList.toggle('selected', c.dataset.icon === suggested));
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
          <div class="modal-actions">
            <button class="btn-primary" id="modal-close-settings" style="width:100%;">Done</button>
          </div>
        </div>
      </div>
    `;

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

  // ---------- Backfill note modal ----------

  function openDayNoteModal(habit, key) {
    const root = document.getElementById('modal-root');
    const entry = habit.checkins && habit.checkins[key];
    if (!entry) {
      closeModal();
      return;
    }

    const suggestions = habitNoteSuggestions(habit);
    const listId = `day-note-suggestions-${habit.id}`;
    const notes = (habit.dayNotes && habit.dayNotes[key]) || [];
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
          <div class="modal-actions">
            <button class="btn-secondary" id="modal-cancel">Close</button>
            <button class="btn-primary" id="modal-save-day-note">Add note</button>
          </div>
        </div>
      </div>
    `;

    root.querySelector('#modal-cancel').addEventListener('click', closeModal);
    root.querySelector('#modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') closeModal();
    });

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

      state = {
        habits: parsed.habits,
        settings: parsed.settings || { notificationsEnabled: true },
      };
      migrateNoteFields();
      persist();
      closeModal();
      renderAll();
      showToast('Data imported.');
    });

    setTimeout(() => root.querySelector('#import-json').focus(), 30);
  }

  // ---------- utils ----------

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ---------- tab switching ----------

  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));
    renderAll();
  }

  function renderAll() {
    renderToday();
    renderWeek();
    renderHabitsTab();
    renderInsights();
    renderMilestones();
  }

  // ---------- init ----------

  async function init() {
    await loadState();
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
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
    renderAll();
  }

  init();
})();
