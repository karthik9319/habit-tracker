# Habit Tracker

A cross-platform habit-tracking desktop app built with Electron. Designed for people who
give up on rigid daily streaks — habits use flexible weekly targets instead, so missing
one day never resets you to zero.

## Features

- **Flexible weekly targets** (1x–7x per week), or **specific scheduled days** (e.g. Mon/Wed/Fri) if you'd rather commit to a fixed pattern than a raw count
- **Build or avoid habits** — track a habit you're building, or one you're trying to quit ("clean days" instead of check-ins)
- **Weekly momentum streak** (🔥) — counts consecutive weeks you hit your target, not consecutive days
- **Minimum viable fallback** — define a smaller version of a habit (e.g. "Read 1 page") that still counts
- **Today / Week / Habits / Insights / Milestones tabs** — quick check-in, a week or month grid per habit, habit management, a gentle non-judgmental summary, and check-in/streak/perfect-month milestone badges
- **Time-of-day grouping** — tag a habit Morning/Afternoon/Evening and the Today tab clusters it accordingly (handy for e.g. splitting a routine into an AM and PM habit)
- **Backfill and correct past check-ins** — the Week tab's grid and the Month view (with prev/next navigation to any past month) let you fill in a day you forgot, or undo a mistaken check-in, without opening up unlimited future dates
- **Per-day notes**, with autosuggested phrases pulled from your own past notes
- **Vacation pause** — pause a habit for a date range so travel or illness doesn't break its streak or send reminders
- **Per-habit reminders** with rotating, low-pressure notification copy, and a snooze option (macOS), plus an optional weekly recap notification (Sunday 8pm)
- **Menu bar tray icon** showing today's progress, with one-click check-in per habit
- **Global quick-check window** (⌘/Ctrl+Shift+H) — a small always-on-top popup to check off habits without opening the main window
- **Settings screen** — toggle reminders/weekly recap, and copy/import your data as JSON
- **Local-only storage** — all data lives in a JSON file on your machine, nothing leaves your computer, with automatic daily backups (30-day retention)
- **Optional iCloud Drive sync** (macOS) — if iCloud Drive is available, your data file lives there instead, so multiple Macs stay in sync
- **No guilt UI** — broken streaks disappear quietly instead of showing a "you failed" state

## Setup

You'll need [Node.js](https://nodejs.org) (v18+) installed.

```bash
cd habit-tracker
npm install
npm start
```

This launches the app in a window. Your data is saved automatically to your OS's app-data
folder (e.g. `~/Library/Application Support/habit-tracker/habit-data.json` on macOS, or
`~/Library/Mobile Documents/com~apple~CloudDocs/HabitTracker/habit-data.json` if iCloud
Drive sync is active) as you use it — no separate save step needed.

## Building a distributable Mac app

```bash
npm run dist
```

This uses `electron-builder` to produce a `.dmg` you can install like any other Mac app.
The first run may take a minute to download build tools.

## Running tests

```bash
npm test
```

Runs the `node --test` suite in `test/`, covering the pure date/streak/stats logic in
`renderer/date-utils.js` and `renderer/habit-stats.js`.

## Project structure

```
habit-tracker/
├── main.js               Electron main process: window, storage, tray, reminders, quick-check
├── preload.js             Safe IPC bridge exposed to the renderer as window.api
├── renderer/
│   ├── index.html          App shell with tab structure
│   ├── style.css           Playful, colorful styling
│   ├── renderer.js         Tab rendering and DOM wiring (Today/Week/Habits/Insights/Milestones, modals)
│   ├── actions.js          State-mutating actions (check-in, reorder, resume from pause)
│   ├── state.js             Persisted app state + transient UI state, load/save/replace
│   ├── ui-utils.js          Toast, SVG ring, color-ramp helpers, escaping
│   ├── constants.js         Milestone thresholds, icons, day labels
│   ├── date-utils.js       Pure date/week-key helpers
│   ├── habit-stats.js       Pure streak/stats/note-suggestion calculations
│   ├── quickcheck.html/.js  The global-shortcut quick-check popup window
│   └── package.json         Marks renderer/ as an ES module tree
├── test/                   node:test suite for date-utils and habit-stats
├── package.json
└── README.md
```

## Data model

Each habit is stored as:

```json
{
  "id": "h_1234567890_42",
  "name": "Morning walk",
  "icon": "🏃",
  "ramp": "teal",
  "type": "build",
  "target": 4,
  "scheduleDays": null,
  "timeOfDay": "morning",
  "reminderTime": "08:00",
  "miniVersion": "Walk to the mailbox",
  "createdAt": "2026-09-11T00:00:00.000Z",
  "archived": false,
  "pauseWindows": [{ "from": "2026-09-20", "until": "2026-09-27" }],
  "dayNotes": {
    "2026-09-11": ["Felt great, went further than usual"]
  },
  "checkins": {
    "2026-09-11": { "done": true, "mini": false }
  }
}
```

`scheduleDays` (an array of weekday indices, Monday = 0) is set instead of `target` when a
habit uses "specific days" scheduling rather than a raw weekly count. `type` is `"build"` or
`"avoid"`. Settings (`notificationsEnabled`, `weeklyRecapEnabled`) are stored alongside
`habits` at the top level of the saved file.

## Roadmap ideas (not yet built)

- Habit stacking (link a new habit to an existing routine)
- Sound effects on check-off (toggleable, off by default)
- Proper file-picker export/import instead of clipboard copy
- A lightweight to-do list alongside habits, for one-off tasks that don't fit the recurring-habit model
