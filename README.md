# Habit Tracker

A cross-platform habit-tracking desktop app built with Electron. Designed for people who
give up on rigid daily streaks — habits use flexible weekly targets instead, so missing
one day never resets you to zero.

## Features

- **Flexible weekly targets** (1x–7x per week) instead of all-or-nothing daily streaks
- **Weekly momentum streak** (🔥) — counts consecutive weeks you hit your target, not consecutive days
- **Minimum viable fallback** — define a smaller version of a habit (e.g. "Read 1 page") that still counts
- **Today / Week / Habits / Insights tabs** — quick check-in, a 7-day grid per habit, habit management, and a gentle non-judgmental summary
- **Per-habit reminders** with rotating, low-pressure notification copy, and a snooze option (macOS)
- **Local-only storage** — all data lives in a JSON file on your machine, nothing leaves your computer
- **No guilt UI** — broken streaks disappear quietly instead of showing a "you failed" state

## Setup

You'll need [Node.js](https://nodejs.org) (v18+) installed.

```bash
cd habit-tracker
npm install
npm start
```

This launches the app in a window. Your data is saved automatically to your OS's app-data
folder (e.g. `~/Library/Application Support/habit-tracker/habit-data.json` on macOS) as you
use it — no separate save step needed.

## Building a distributable Mac app

```bash
npm run dist
```

This uses `electron-builder` to produce a `.dmg` you can install like any other Mac app.
The first run may take a minute to download build tools.

## Project structure

```
habit-tracker/
├── main.js           Electron main process: window, storage, reminders
├── preload.js         Safe IPC bridge exposed to the renderer as window.api
├── renderer/
│   ├── index.html     App shell with tab structure
│   ├── style.css       Playful, colorful styling
│   └── renderer.js     All app logic (habits, check-ins, streaks, modal, tabs)
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
  "target": 4,
  "reminderTime": "08:00",
  "miniVersion": "Walk to the mailbox",
  "createdAt": "2026-09-11T00:00:00.000Z",
  "archived": false,
  "checkins": {
    "2026-09-11": { "done": true, "mini": false }
  }
}
```

## Roadmap ideas (not yet built)

- Habit stacking (link a new habit to an existing routine)
- Global keyboard shortcut for quick check-off without opening the window
- Cloud sync across devices
- Sound effects on check-off (toggleable, off by default)
- Proper file-picker export/import instead of clipboard copy
