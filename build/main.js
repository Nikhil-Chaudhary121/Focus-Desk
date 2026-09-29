const { app, BrowserWindow, ipcMain, shell, Notification, screen } = require('electron');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWin, widgetWin, waterTimer;
const gotLock = app.requestSingleInstanceLock();
const startHidden = process.argv.includes('--hidden');
if (!gotLock) app.quit();
app.on('second-instance', () => { if (mainWin) { mainWin.show(); mainWin.focus(); } });
function applyAutoStart() {
  if (!app.isPackaged) return; // only works from the installed app
  app.setLoginItemSettings({ openAtLogin: !!store.settings.autoStart, args: ['--hidden'] });
}
const defaults = {
  tasks: [], habits: [],
  settings: {
    waterMins: 60, focusMins: 25, breakMins: 5, longBreakMins: 15,
    blockGames: true, blockOnlyFocus: false, autoStart: true, theme: 'classic',
    blockList: [
      'VALORANT-Win64-Shipping.exe', 'cs2.exe', 'csgo.exe', 'dota2.exe', 'GTA5.exe',
      'FortniteClient-Win64-Shipping.exe', 'RocketLeague.exe', 'LeagueClient.exe',
      'League of Legends.exe', 'Overwatch.exe', 'TslGame.exe', 'r5apex.exe',
      'eldenring.exe', 'Minecraft.Windows.exe', 'RobloxPlayerBeta.exe',
      'GenshinImpact.exe', 'HD-Player.exe'
    ]
  }
};
const dataFile = () => path.join(app.getPath('userData'), 'data.json');
const pomoFile = () => path.join(app.getPath('userData'), 'pomo.json');
const todayKey = () => new Date().toLocaleDateString('en-CA');

function readData() {
  try {
    const d = JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
    return { ...defaults, ...d, settings: { ...defaults.settings, ...d.settings } };
  } catch { return structuredClone(defaults); }
}
let store;
const writeData = d => fs.writeFileSync(dataFile(), JSON.stringify(d, null, 2));
const send = (ch, payload) => [mainWin, widgetWin].forEach(w => w && !w.isDestroyed() && w.webContents.send(ch, payload));

/* ---------- Pomodoro (lives here so both windows stay in sync) ---------- */
let pomo = { mode: 'focus', remaining: 1500, running: false, cycle: 0, sessions: 0 };
function modeSecs(mode) {
  const s = store.settings;
  const m = mode === 'focus' ? s.focusMins : mode === 'long' ? s.longBreakMins : s.breakMins;
  return 60 * (Number(m) || 25);
}
function loadSessions() {
  try { const p = JSON.parse(fs.readFileSync(pomoFile(), 'utf8')); return p.date === todayKey() ? p.count : 0; }
  catch { return 0; }
}
const saveSessions = () => fs.writeFileSync(pomoFile(), JSON.stringify({ date: todayKey(), count: pomo.sessions }));
const sendPomo = () => send('pomo', pomo);

function nextMode(counted) {
  if (pomo.mode === 'focus') {
    if (counted) { pomo.sessions++; pomo.cycle++; saveSessions(); }
    pomo.mode = pomo.cycle % 4 === 0 && pomo.cycle > 0 ? 'long' : 'break';
  } else pomo.mode = 'focus';
  pomo.remaining = modeSecs(pomo.mode);
  pomo.running = false;
}
function pomoTick() {
  if (!pomo.running) return;
  pomo.remaining--;
  if (pomo.remaining <= 0) {
    const wasFocus = pomo.mode === 'focus';
    nextMode(true);
    new Notification({
      title: wasFocus ? 'Focus session done' : 'Break over',
      body: wasFocus ? 'Nice work. Take a break.' : 'Ready for the next focus session?'
    }).show();
  }
  sendPomo();
}

/* ---------- Game blocker ---------- */
function scanGames() {
  const s = store.settings;
  if (!s.blockGames) return;
  if (s.blockOnlyFocus && !(pomo.running && pomo.mode === 'focus')) return;
  const list = new Set((s.blockList || []).map(x => x.trim().toLowerCase()).filter(Boolean));
  if (!list.size) return;
  const win = process.platform === 'win32';
  exec(win ? 'tasklist /FO CSV /NH' : 'ps -A -o comm=', { maxBuffer: 1 << 24 }, (err, out) => {
    if (err) return;
    const names = win
      ? out.split('\n').map(l => (l.match(/^"([^"]+)"/) || [])[1]).filter(Boolean)
      : out.split('\n').map(l => path.basename(l.trim())).filter(Boolean);
    [...new Set(names)].filter(n => list.has(n.toLowerCase())).forEach(n => {
      exec(win ? `taskkill /F /IM "${n}"` : `pkill -x "${n}"`);
      new Notification({ title: 'Game closed', body: `${n} was closed. Back to work.` }).show();
    });
  });
}

/* ---------- Windows ---------- */
function createMain() {
  mainWin = new BrowserWindow({
    width: 900, height: 640, minWidth: 640, minHeight: 480,
    show: !startHidden, backgroundColor: '#14201f', autoHideMenuBar: true, title: 'Focus Desk',
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  mainWin.loadFile('index.html', { query: { view: 'main' } });
  mainWin.on('closed', () => app.quit());
}
function createWidget() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  widgetWin = new BrowserWindow({
    width: 300, height: 440, x: width - 320, y: 20,
    frame: false, resizable: false, alwaysOnTop: true,
    backgroundColor: '#14201f', title: 'Focus Desk Widget',
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  widgetWin.setAlwaysOnTop(true, 'screen-saver');
  widgetWin.loadFile('index.html', { query: { view: 'widget' } });
}

function remindWater() {
  new Notification({ title: 'Time for water', body: 'Drink a glass of water.' }).show();
  send('water');
}
function startWaterTimer() {
  clearInterval(waterTimer);
  const mins = Math.max(1, Number(store.settings.waterMins) || 60);
  waterTimer = setInterval(remindWater, mins * 60 * 1000);
}

function launch(items) {
  for (const it of items || []) {
    const v = (it.value || '').trim();
    if (!v) continue;
    if (it.type === 'link') shell.openExternal(/^https?:\/\//i.test(v) ? v : 'https://' + v);
    else if (process.platform === 'win32') exec(`start "" ${v}`, { shell: 'cmd.exe' });
    else if (process.platform === 'darwin') exec(`open -a ${v}`);
    else exec(v);
  }
}

app.whenReady().then(() => {
  if (!gotLock) return;
  store = readData();
  applyAutoStart();
  pomo.remaining = modeSecs('focus');
  pomo.sessions = loadSessions();

  ipcMain.handle('load', () => store);
  ipcMain.handle('save', (e, d) => {
    const prevWater = store.settings.waterMins;
    store = d; writeData(d);
    [mainWin, widgetWin].forEach(w => {
      if (w && !w.isDestroyed() && w.webContents !== e.sender) w.webContents.send('data-changed', d);
    });
    if (prevWater !== d.settings.waterMins) startWaterTimer();
    applyAutoStart();
    if (!pomo.running) { pomo.remaining = modeSecs(pomo.mode); sendPomo(); }
  });
  ipcMain.handle('pomo-get', () => pomo);
  ipcMain.on('pomo', (e, action) => {
    if (action === 'toggle') pomo.running = !pomo.running;
    else if (action === 'reset') { pomo.running = false; pomo.remaining = modeSecs(pomo.mode); }
    else if (action === 'skip') nextMode(false);
    sendPomo();
  });
  ipcMain.on('launch', (e, items) => launch(items));
  ipcMain.on('widget-collapse', (e, collapsed) => {
    const [x, y] = widgetWin.getPosition();
    widgetWin.setResizable(true);
    widgetWin.setSize(300, collapsed ? 44 : 440);
    widgetWin.setResizable(false);
    widgetWin.setPosition(x, y);
  });
  ipcMain.on('open-main', () => { if (mainWin) { mainWin.show(); mainWin.focus(); } });
  ipcMain.on('test-water', remindWater);

  createMain();
  createWidget();
  startWaterTimer();
  setInterval(pomoTick, 1000);
  setInterval(scanGames, 5000);
});

app.on('window-all-closed', () => app.quit());
