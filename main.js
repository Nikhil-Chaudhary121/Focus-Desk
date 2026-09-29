const { app, BrowserWindow, ipcMain, shell, Notification, screen, Tray, Menu, nativeImage, dialog } = require('electron');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWin, widgetWin, waterTimer, tray, quitting = false, ticks = 0;
const gotLock = app.requestSingleInstanceLock();
const startHidden = process.argv.includes('--hidden');
if (!gotLock) app.quit();
const showMain = () => { if (mainWin) { mainWin.show(); mainWin.focus(); } };
app.on('second-instance', showMain);
const win32 = process.platform === 'win32';
const notify = (title, body) => new Notification({ title, body }).show();

function applyAutoStart() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!store.settings.autoStart, args: ['--hidden'] });
}
const defaults = {
  tasks: [], habits: [], templates: [], water: {}, daily: {},
  settings: {
    waterMins: 60, waterGoal: 8, focusMins: 25, breakMins: 5, longBreakMins: 15,
    blockGames: true, blockOnlyFocus: false, autoStart: true, theme: 'classic',
    sound: true, widgetOpacity: 1,
    blockSites: false, blockSitesAlways: false,
    siteList: ['youtube.com', 'reddit.com', 'instagram.com', 'twitter.com', 'x.com', 'facebook.com', 'tiktok.com'],
    blockList: [
      'VALORANT-Win64-Shipping.exe', 'cs2.exe', 'csgo.exe', 'dota2.exe', 'GTA5.exe',
      'FortniteClient-Win64-Shipping.exe', 'RocketLeague.exe', 'LeagueClient.exe',
      'League of Legends.exe', 'Overwatch.exe', 'TslGame.exe', 'r5apex.exe',
      'eldenring.exe', 'Minecraft.Windows.exe', 'RobloxPlayerBeta.exe',
      'GenshinImpact.exe', 'HD-Player.exe'
    ]
  }
};
const U = f => path.join(app.getPath('userData'), f);
const dataFile = () => U('data.json'), bakFile = () => U('data.bak.json'), histFile = () => U('focus.json'), winFile = () => U('win.json');
const todayKey = () => new Date().toLocaleDateString('en-CA');
const merge = d => ({ ...structuredClone(defaults), ...d, settings: { ...defaults.settings, ...d.settings } });

/* data.json is backed up on every clean start; if it is corrupt we fall back to the backup */
function readData() {
  for (const f of [dataFile(), bakFile()]) {
    try {
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (f === dataFile()) try { fs.copyFileSync(f, bakFile()); } catch {}
      return merge(d);
    } catch {}
  }
  return structuredClone(defaults);
}
let store;
const writeData = d => { const t = dataFile() + '.tmp'; fs.writeFileSync(t, JSON.stringify(d, null, 2)); fs.renameSync(t, dataFile()); };
const send = (ch, payload) => [mainWin, widgetWin].forEach(w => w && !w.isDestroyed() && w.webContents.send(ch, payload));

/* ---------- Focus history: { days: {date: {n, secs, tasks:{id:secs}}}, tasks: {id: {secs, n}} } ---------- */
let hist = { days: {}, tasks: {} };
function loadHist() { try { hist = JSON.parse(fs.readFileSync(histFile(), 'utf8')); } catch {} hist.days ||= {}; hist.tasks ||= {}; }
const saveHist = () => { try { fs.writeFileSync(histFile(), JSON.stringify(hist)); } catch {} };
const day = () => (hist.days[todayKey()] ||= { n: 0, secs: 0, tasks: {} });

/* ---------- Pomodoro ---------- */
let pomo = { mode: 'focus', remaining: 1500, running: false, cycle: 0, taskId: null };
const getPomo = () => ({ ...pomo, sessions: day().n, totals: hist.tasks });
const sendPomo = () => { syncSites(); send('pomo', getPomo()); };
function modeSecs(mode) {
  const s = store.settings;
  const m = mode === 'focus' ? s.focusMins : mode === 'long' ? s.longBreakMins : s.breakMins;
  return 60 * (Number(m) || 25);
}
function nextMode(counted) {
  if (pomo.mode === 'focus') {
    if (counted) {
      pomo.cycle++; day().n++;
      (hist.tasks[pomo.taskId || '_'] ||= { secs: 0, n: 0 }).n++;
      saveHist();
    }
    pomo.mode = pomo.cycle % 4 === 0 && pomo.cycle > 0 ? 'long' : 'break';
  } else pomo.mode = 'focus';
  pomo.remaining = modeSecs(pomo.mode);
  pomo.running = false;
}
function pomoTick() {
  if (!pomo.running) return;
  if (pomo.mode === 'focus') {
    const k = pomo.taskId || '_', d = day();
    d.secs++; d.tasks[k] = (d.tasks[k] || 0) + 1;
    (hist.tasks[k] ||= { secs: 0, n: 0 }).secs++;
    if (++ticks % 30 === 0) saveHist();
  }
  pomo.remaining--;
  if (pomo.remaining <= 0) {
    const wasFocus = pomo.mode === 'focus';
    nextMode(true);
    notify(wasFocus ? 'Focus session done' : 'Break over', wasFocus ? 'Nice work. Take a break.' : 'Ready for the next focus session?');
    send('pomo-end', wasFocus ? 'focus' : 'break');
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
  exec(win32 ? 'tasklist /FO CSV /NH' : 'ps -A -o comm=', { maxBuffer: 1 << 24 }, (err, out) => {
    if (err) return;
    const names = win32
      ? out.split('\n').map(l => (l.match(/^"([^"]+)"/) || [])[1]).filter(Boolean)
      : out.split('\n').map(l => path.basename(l.trim())).filter(Boolean);
    [...new Set(names)].filter(n => list.has(n.toLowerCase())).forEach(n => {
      exec(win32 ? `taskkill /F /IM "${n}"` : `pkill -x "${n}"`);
      notify('Game closed', `${n} was closed. Back to work.`);
    });
  });
}

/* ---------- Website blocker (hosts file, needs admin rights) ---------- */
const HOSTS = win32 ? 'C:\\Windows\\System32\\drivers\\etc\\hosts' : '/etc/hosts';
const B0 = '# FOCUSDESK-BEGIN', B1 = '# FOCUSDESK-END';
let sitesBlocked = false;
function setSites(want) {
  try {
    let t = fs.readFileSync(HOSTS, 'utf8');
    if (!want && !t.includes(B0)) return;
    t = t.replace(new RegExp(`\\r?\\n?${B0}[\\s\\S]*?${B1}\\r?\\n?`, 'g'), '\n');
    if (want) {
      const lines = (store.settings.siteList || [])
        .map(x => x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
        .filter(Boolean).flatMap(h => [`127.0.0.1 ${h}`, `127.0.0.1 www.${h}`]);
      if (!lines.length) return;
      t = t.trimEnd() + `\n${B0}\n${lines.join('\n')}\n${B1}\n`;
    }
    fs.writeFileSync(HOSTS, t);
    if (win32) exec('ipconfig /flushdns');
  } catch {
    if (want) notify('Website blocker needs admin rights', 'Run Focus Desk as administrator to block websites.');
  }
}
function syncSites() {
  if (!store) return;
  const s = store.settings;
  const want = !!s.blockSites && (!!s.blockSitesAlways || (pomo.running && pomo.mode === 'focus'));
  if (want === sitesBlocked) return;
  sitesBlocked = want; setSites(want);
}

/* ---------- Habit reminders ---------- */
const reminded = new Set();
function checkReminders() {
  const hm = new Date().toTimeString().slice(0, 5), k = todayKey();
  (store.habits || []).forEach(h => {
    if (h.remind !== hm || (h.log && h.log[k]) || reminded.has(k + h.id)) return;
    reminded.add(k + h.id);
    notify('Habit reminder', h.name);
  });
}

/* ---------- Windows ---------- */
function createMain() {
  mainWin = new BrowserWindow({
    width: 900, height: 700, minWidth: 640, minHeight: 480,
    show: !startHidden, backgroundColor: '#14201f', autoHideMenuBar: true, title: 'Focus Desk',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  mainWin.loadFile('index.html', { query: { view: 'main' } });
  mainWin.on('close', e => { if (!quitting) { e.preventDefault(); mainWin.hide(); } });
}
const applyOpacity = () => widgetWin && !widgetWin.isDestroyed() &&
  widgetWin.setOpacity(Math.min(1, Math.max(0.3, Number(store.settings.widgetOpacity) || 1)));
function createWidget() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  let p = {}; try { p = JSON.parse(fs.readFileSync(winFile(), 'utf8')); } catch {}
  const onScreen = p.x != null && screen.getAllDisplays().some(d => {
    const b = d.workArea; return p.x >= b.x - 50 && p.x < b.x + b.width - 50 && p.y >= b.y && p.y < b.y + b.height - 40;
  });
  widgetWin = new BrowserWindow({
    width: 300, height: 440, x: onScreen ? p.x : width - 320, y: onScreen ? p.y : 20,
    frame: false, resizable: false, alwaysOnTop: true,
    backgroundColor: '#14201f', title: 'Focus Desk Widget',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false }
  });
  widgetWin.setAlwaysOnTop(true, 'screen-saver');
  widgetWin.loadFile('index.html', { query: { view: 'widget' } });
  applyOpacity();
  let t;
  widgetWin.on('moved', () => {
    clearTimeout(t);
    t = setTimeout(() => { const [x, y] = widgetWin.getPosition(); try { fs.writeFileSync(winFile(), JSON.stringify({ x, y })); } catch {} }, 400);
  });
}
function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Focus Desk');
  tray.on('click', showMain);
  tray.on('right-click', () => tray.popUpContextMenu(Menu.buildFromTemplate([
    { label: 'Open Focus Desk', click: showMain },
    { label: pomo.running ? 'Pause timer' : 'Start timer', click: () => { pomo.running = !pomo.running; sendPomo(); } },
    { label: 'Show or hide widget', click: () => widgetWin.isVisible() ? widgetWin.hide() : widgetWin.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } }
  ])));
}

function remindWater() {
  notify('Time for water', 'Drink a glass of water.');
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
    else if (win32) exec(`start "" ${v}`, { shell: 'cmd.exe' });
    else if (process.platform === 'darwin') exec(`open -a ${v}`);
    else exec(v);
  }
}

app.whenReady().then(() => {
  if (!gotLock) return;
  store = readData();
  loadHist();
  setSites(false); // clear any block left behind by a crash
  applyAutoStart();
  pomo.remaining = modeSecs('focus');

  ipcMain.handle('load', () => store);
  ipcMain.handle('save', (e, d) => {
    const prevWater = store.settings.waterMins;
    store = d; writeData(d);
    [mainWin, widgetWin].forEach(w => {
      if (w && !w.isDestroyed() && w.webContents !== e.sender) w.webContents.send('data-changed', d);
    });
    if (prevWater !== d.settings.waterMins) startWaterTimer();
    applyAutoStart(); applyOpacity();
    if (!pomo.running) pomo.remaining = modeSecs(pomo.mode);
    sitesBlocked = !sitesBlocked; syncSites(); // re-apply site list changes
    sendPomo();
  });
  ipcMain.handle('pomo-get', () => getPomo());
  ipcMain.on('pomo', (e, action) => {
    if (action === 'toggle') pomo.running = !pomo.running;
    else if (action === 'reset') { pomo.running = false; pomo.remaining = modeSecs(pomo.mode); }
    else if (action === 'skip') nextMode(false);
    sendPomo();
  });
  ipcMain.on('pomo-task', (e, id) => { pomo.taskId = id || null; sendPomo(); });
  ipcMain.on('launch', (e, items) => launch(items));
  ipcMain.on('widget-collapse', (e, collapsed) => {
    const [x, y] = widgetWin.getPosition();
    widgetWin.setResizable(true);
    widgetWin.setSize(300, collapsed ? 44 : 440);
    widgetWin.setResizable(false);
    widgetWin.setPosition(x, y);
  });
  ipcMain.on('open-main', showMain);
  ipcMain.on('test-water', remindWater);

  ipcMain.handle('export', async () => {
    const r = await dialog.showSaveDialog(mainWin, {
      defaultPath: `focus-desk-backup-${todayKey()}.json`, filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (r.canceled) return false;
    fs.writeFileSync(r.filePath, JSON.stringify({ app: 'focus-desk', data: store, hist }, null, 2));
    return true;
  });
  ipcMain.handle('import', async () => {
    const r = await dialog.showOpenDialog(mainWin, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled) return false;
    try {
      const j = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
      const d = j.app === 'focus-desk' ? j.data : j;
      if (!d || !Array.isArray(d.tasks) || !Array.isArray(d.habits)) return false;
      store = merge(d); writeData(store);
      if (j.hist) { hist = { days: {}, tasks: {}, ...j.hist }; saveHist(); }
      startWaterTimer(); applyOpacity();
      send('data-changed', store); sendPomo();
      return true;
    } catch { return false; }
  });

  createMain();
  createWidget();
  createTray();
  startWaterTimer();
  setInterval(pomoTick, 1000);
  setInterval(scanGames, 5000);
  setInterval(checkReminders, 20000);
});

app.on('before-quit', () => { quitting = true; setSites(false); saveHist(); });
