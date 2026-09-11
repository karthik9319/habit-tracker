const { app, BrowserWindow, ipcMain, Notification, Menu, Tray, nativeImage, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

function resolveDataFile() {
  const localFile = path.join(app.getPath('userData'), 'habit-data.json');
  if (process.platform !== 'darwin') return { file: localFile, icloud: false };

  try {
    const icloudRoot = path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
    if (!fs.existsSync(icloudRoot)) return { file: localFile, icloud: false };

    const icloudDir = path.join(icloudRoot, 'HabitTracker');
    const icloudFile = path.join(icloudDir, 'habit-data.json');
    if (!fs.existsSync(icloudDir)) fs.mkdirSync(icloudDir, { recursive: true });

    if (!fs.existsSync(icloudFile) && fs.existsSync(localFile)) {
      fs.copyFileSync(localFile, icloudFile); // one-time migration of existing local data
    }

    return { file: icloudFile, icloud: true };
  } catch (err) {
    console.error('iCloud sync unavailable, falling back to local storage:', err);
    return { file: localFile, icloud: false };
  }
}

const { file: DATA_FILE, icloud: USING_ICLOUD } = resolveDataFile();
const BACKUP_DIR = path.join(app.getPath('userData'), 'backups');
const BACKUP_RETENTION_DAYS = 30;

function defaultData() {
  return { habits: [], settings: { notificationsEnabled: true, weeklyRecapEnabled: true } };
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return defaultData();
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.habits) return defaultData();
    return parsed;
  } catch (err) {
    console.error('Failed to load data, starting fresh:', err);
    return defaultData();
  }
}

function writeBackup(data) {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const dateStr = new Date().toISOString().slice(0, 10);
    const file = path.join(BACKUP_DIR, `habit-data-${dateStr}.json`);
    if (fs.existsSync(file)) return; // already have today's snapshot
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
    pruneOldBackups();
  } catch (err) {
    console.error('Failed to write backup:', err);
  }
}

function pruneOldBackups() {
  try {
    const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('habit-data-') && f.endsWith('.json'))
      .forEach((f) => {
        const full = path.join(BACKUP_DIR, f);
        if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
      });
  } catch (err) {
    console.error('Failed to prune backups:', err);
  }
}

function saveData(data) {
  try {
    // write-then-rename is atomic, avoiding a half-written file being picked up mid-sync
    const tmpFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpFile, DATA_FILE);
    lastKnownMtime = fs.statSync(DATA_FILE).mtimeMs;
    writeBackup(data);
    return true;
  } catch (err) {
    console.error('Failed to save data:', err);
    return false;
  }
}

let mainWindow;
let tray;
let quickCheckWindow;
let snoozedReminders = {}; // habitId -> timestamp when reminder should re-fire
let lastKnownMtime = fs.existsSync(DATA_FILE) ? fs.statSync(DATA_FILE).mtimeMs : 0;

function watchForExternalChanges() {
  if (!fs.existsSync(DATA_FILE)) return;
  fs.watchFile(DATA_FILE, { interval: 4000 }, (curr) => {
    if (curr.mtimeMs === lastKnownMtime) return;
    lastKnownMtime = curr.mtimeMs;
    buildTrayMenu();
    if (mainWindow) mainWindow.webContents.send('data-changed');
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 720,
    minWidth: 380,
    minHeight: 560,
    title: 'Habit Tracker',
    backgroundColor: '#faf8f3',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  Menu.setApplicationMenu(null);
}

function todayKey() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function toggleHabitCheckin(habitId) {
  const data = loadData();
  const habit = data.habits.find((h) => h.id === habitId);
  if (!habit) return;

  const key = todayKey();
  habit.checkins = habit.checkins || {};
  if (habit.checkins[key]) {
    delete habit.checkins[key];
  } else {
    habit.checkins[key] = { done: true, mini: false };
  }

  saveData(data);
  buildTrayMenu();
  if (mainWindow) {
    mainWindow.webContents.send('data-changed');
  }
}

function openQuickCheck() {
  if (quickCheckWindow) {
    quickCheckWindow.focus();
    return;
  }
  quickCheckWindow = new BrowserWindow({
    width: 320,
    height: 420,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    center: true,
    show: false,
    backgroundColor: '#faf8f3',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  quickCheckWindow.loadFile(path.join(__dirname, 'renderer', 'quickcheck.html'));
  quickCheckWindow.once('ready-to-show', () => quickCheckWindow.show());
  quickCheckWindow.on('blur', () => {
    if (quickCheckWindow) quickCheckWindow.close();
  });
  quickCheckWindow.on('closed', () => {
    quickCheckWindow = null;
  });
}

function buildTrayMenu() {
  if (!tray) return;

  const data = loadData();
  const todayStr = todayKey();
  const active = data.habits.filter((h) => !h.archived);
  const doneCount = active.filter((h) => h.checkins && h.checkins[todayStr]).length;

  const habitItems = active.map((h) => {
    const done = !!(h.checkins && h.checkins[todayStr]);
    return {
      label: `${done ? '✓' : '○'}  ${h.name}`,
      click: () => toggleHabitCheckin(h.id),
    };
  });

  const menu = Menu.buildFromTemplate([
    { label: active.length ? `${doneCount} of ${active.length} done today` : 'No habits yet', enabled: false },
    { type: 'separator' },
    ...(habitItems.length ? habitItems : [{ label: 'Add a habit to get started', enabled: false }]),
    { type: 'separator' },
    {
      label: 'Open Habit Tracker',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
        } else {
          createWindow();
        }
      },
    },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setContextMenu(menu);
  tray.setTitle(active.length ? `${doneCount}/${active.length}` : '');
}

function isPausedOn(habit, key) {
  if (!habit.pauseWindows) return false;
  return habit.pauseWindows.some((w) => key >= w.from && key <= w.until);
}

function checkReminders() {
  const data = loadData();
  if (!data.settings.notificationsEnabled) return;
  if (!Notification.isSupported()) return;

  const now = new Date();
  const hhmm = now.toTimeString().slice(0, 5); // "HH:MM"

  data.habits.forEach((habit) => {
    if (habit.archived || !habit.reminderTime) return;
    if (habit.scheduleDays && !habit.scheduleDays.includes(now.getDay())) return;
    if (isPausedOn(habit, todayKey())) return;

    const snoozeUntil = snoozedReminders[habit.id];
    if (snoozeUntil && Date.now() < snoozeUntil) return;
    if (snoozeUntil && Date.now() >= snoozeUntil) delete snoozedReminders[habit.id];

    const alreadyDoneToday = !!(habit.checkins && habit.checkins[todayKey()]);
    if (alreadyDoneToday) return;

    if (habit.reminderTime === hhmm && habit._lastNotified !== todayKey()) {
      habit._lastNotified = todayKey();
      const phrases =
        habit.type === 'avoid'
          ? [
              `Still staying clean on ${habit.name} today?`,
              `Check in: ${habit.name}, still going strong?`,
              `${habit.name} — mark today clean whenever you're ready.`,
            ]
          : [
              `Got a couple minutes for ${habit.name}?`,
              `Quick one: ${habit.name} today?`,
              `${habit.name} is still open today.`,
              `Small step: ${habit.name}?`,
            ];
      const body = phrases[Math.floor(Math.random() * phrases.length)];

      const notification = new Notification({
        title: 'Habit Tracker',
        body,
        actions: process.platform === 'darwin' ? [{ type: 'button', text: 'Snooze 1h' }] : undefined,
      });

      notification.on('click', () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.webContents.send('navigate-to-today');
        }
      });

      notification.on('action', (_event, index) => {
        if (index === 0) {
          snoozedReminders[habit.id] = Date.now() + 60 * 60 * 1000;
        }
      });

      notification.show();
    }
  });

  saveData(data);
}

function getWeekStartKey(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  return dateKeyMain(date);
}

function dateKeyMain(d) {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
}

function weeklyCountForRecap(habit, weekStartKey) {
  const [y, m, d] = weekStartKey.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const dt = new Date(start);
    dt.setDate(dt.getDate() + i);
    if (habit.checkins && habit.checkins[dateKeyMain(dt)]) count++;
  }
  return count;
}

function checkWeeklyRecap() {
  const data = loadData();
  if (data.settings.weeklyRecapEnabled === false) return;
  if (!Notification.isSupported()) return;

  const now = new Date();
  if (now.getDay() !== 0) return; // Sunday only
  const hhmm = now.toTimeString().slice(0, 5);
  if (hhmm !== '20:00') return;

  const weekStartKey = getWeekStartKey(now);
  if (data._lastRecapWeek === weekStartKey) return;

  const active = data.habits.filter((h) => !h.archived);
  if (active.length === 0) return;

  const hitCount = active.filter((h) => weeklyCountForRecap(h, weekStartKey) >= h.target).length;

  data._lastRecapWeek = weekStartKey;
  saveData(data);

  const notification = new Notification({
    title: 'Habit Tracker',
    body: `This week: ${hitCount} of ${active.length} habits hit their target.`,
  });

  notification.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.webContents.send('navigate-to-today');
    }
  });

  notification.show();
}

app.whenReady().then(() => {
  watchForExternalChanges();

  if (process.platform === 'darwin' && app.dock) {
    const iconPath = path.join(__dirname, 'build', 'icon.png');
    if (fs.existsSync(iconPath)) {
      app.dock.setIcon(nativeImage.createFromPath(iconPath));
    }
  }

  createWindow();
  setInterval(() => {
    checkReminders();
    checkWeeklyRecap();
  }, 60 * 1000);

  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('Habit Tracker');
  buildTrayMenu();
  setInterval(buildTrayMenu, 60 * 1000);

  const registered = globalShortcut.register('CommandOrControl+Shift+H', () => {
    openQuickCheck();
  });
  if (!registered) {
    console.error('Failed to register global quick-check shortcut (may be in use by another app).');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

ipcMain.handle('load-data', () => loadData());
ipcMain.handle('get-storage-info', () => ({ icloud: USING_ICLOUD }));
ipcMain.handle('save-data', (_event, data) => {
  const ok = saveData(data);
  buildTrayMenu();
  return ok;
});
ipcMain.handle('toggle-habit', (_event, habitId) => {
  toggleHabitCheckin(habitId);
  return true;
});
