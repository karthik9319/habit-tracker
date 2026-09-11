const { app, BrowserWindow, ipcMain, Notification, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const DATA_FILE = path.join(app.getPath('userData'), 'habit-data.json');

function defaultData() {
  return { habits: [], settings: { notificationsEnabled: true } };
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

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Failed to save data:', err);
    return false;
  }
}

let mainWindow;
let snoozedReminders = {}; // habitId -> timestamp when reminder should re-fire

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

function checkReminders() {
  const data = loadData();
  if (!data.settings.notificationsEnabled) return;
  if (!Notification.isSupported()) return;

  const now = new Date();
  const hhmm = now.toTimeString().slice(0, 5); // "HH:MM"

  data.habits.forEach((habit) => {
    if (habit.archived || !habit.reminderTime) return;

    const snoozeUntil = snoozedReminders[habit.id];
    if (snoozeUntil && Date.now() < snoozeUntil) return;
    if (snoozeUntil && Date.now() >= snoozeUntil) delete snoozedReminders[habit.id];

    const alreadyDoneToday = !!(habit.checkins && habit.checkins[todayKey()]);
    if (alreadyDoneToday) return;

    if (habit.reminderTime === hhmm && habit._lastNotified !== todayKey()) {
      habit._lastNotified = todayKey();
      const phrases = [
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

app.whenReady().then(() => {
  createWindow();
  setInterval(checkReminders, 60 * 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('load-data', () => loadData());
ipcMain.handle('save-data', (_event, data) => saveData(data));
