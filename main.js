'use strict';
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, powerMonitor, dialog, nativeImage, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { Store } = require('./src/main/settings');
const { getSchedule } = require('./src/main/prayerTimes');
const { Scheduler } = require('./src/main/scheduler');
const { Restrictor } = require('./src/main/restrictions');
const { ProofServer } = require('./src/main/proofServer');
const { verifyPrayerMat } = require('./src/main/verify');
const { makeIcon } = require('./src/main/icons');

const APP_ID = 'com.example.prayerpause'; // keep identical to build.appId in package.json
const NAMES = { fajr: 'Fajr', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha', test: 'Test' };
let win = null, sessionWin = null, tray = null, quitting = false, lastTip = '', lastMenuSig = '';
let store, scheduler, restrictor, endFlow = null;
const proof = new ProofServer();
const realSession = () => !!(scheduler && scheduler.session && scheduler.session.prayer !== 'test');

if (!app.requestSingleInstanceLock()) { app.quit(); } else { boot(); }

function boot() {
  app.setAppUserModelId(APP_ID);
  app.on('second-instance', showMain);
  app.on('window-all-closed', () => { /* stay alive in the tray */ });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => { scheduler?.stop(); restrictor?.stop(); proof.stop(); });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null); // removes default Ctrl+W / Ctrl+Q / F11 style shortcuts
    const data = app.getPath('userData');
    store = new Store(path.join(data, 'settings.json'));
    restrictor = new Restrictor({ getSettings: () => store.get() });
    scheduler = new Scheduler({ getSettings: () => store.get(), getSchedule, statePath: path.join(data, 'scheduler-state.json') });

    store.on('change', () => { scheduler.refresh(); applyStartup(); const st = scheduler.getState(); broadcast(st); updateTray(st); });
    scheduler.on('error', (e) => console.error('Scheduler error:', e));
    scheduler.on('warning', (id) => notify(`${NAMES[id]} is coming up`, 'Save your work. Restricted apps will close at prayer time.'));
    scheduler.on('session-start', (s) => {
      restrictor.start(); openSession();
      notify(`Time for ${NAMES[s.prayer]}`, `Prayer Pause is on for ${Math.max(1, Math.ceil((s.endsAt - Date.now()) / 60000))} min.`);
    });
    scheduler.on('session-end', (_s, reason) => {
      restrictor.stop(); proof.stop(); endFlow = null;
      if (sessionWin && !sessionWin.isDestroyed()) sessionWin.close();
      if (reason === 'completed') notify('Prayer Pause finished', 'Your apps are available again.');
    });
    scheduler.on('tick', (state) => { broadcast(state); updateTray(state); });
    proof.on('photo', onPhoto);

    registerIpc(); createTray(); applyStartup();
    powerMonitor.on('resume', () => { scheduler.refresh(); scheduler.tick(); setTimeout(() => scheduler.tick(), 3000); });
    powerMonitor.on('unlock-screen', () => scheduler.tick());
    scheduler.start();
    if (!process.argv.includes('--hidden')) showMain();
  });
}

const snapshot = (state = scheduler.getState()) => ({
  ...state, restriction: restrictor.status(), sound: store.get().sound,
  endFlow: endFlow ? { status: endFlow.status, message: endFlow.message } : null,
});
function broadcast(state = scheduler.getState()) {
  const snap = snapshot(state);
  for (const w of [win, sessionWin]) if (w && !w.isDestroyed() && w.isVisible()) w.webContents.send('state:update', snap);
}

// ---- API key (encrypted with Windows DPAPI via safeStorage; never stored in settings.json) ----
const keyFile = () => path.join(app.getPath('userData'), 'api-key.bin');
function getKey() { try { return safeStorage.decryptString(fs.readFileSync(keyFile())); } catch { return ''; } }
function setKey(k) {
  if (!k) { fs.rmSync(keyFile(), { force: true }); return; }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this PC.');
  fs.writeFileSync(keyFile(), safeStorage.encryptString(k));
}

// ---- "End early" proof flow: phone photo of the prayer mat ----
async function onPhoto(buffer, reply) {
  if (!realSession()) return reply({ ok: false, message: 'No prayer session is active.' });
  endFlow = { status: 'checking', message: 'Checking your photo...' }; broadcast();
  try {
    const img = nativeImage.createFromBuffer(buffer);
    if (img.isEmpty()) throw new Error('Could not read that photo. Try again.');
    const w = Math.min(1024, img.getSize().width);
    const small = img.resize({ width: w }).toJPEG(80);
    const key = getKey();
    const ok = key ? await verifyPrayerMat(small, key) : true;
    if (ok) {
      reply({ ok: true, message: 'Accepted. Your session has ended.' });
      endFlow = null; scheduler.endEarly(); return;
    }
    endFlow = { status: 'rejected', message: "That doesn't look like a prayer mat. Try another photo." };
    reply({ ok: false, message: endFlow.message });
  } catch (err) {
    endFlow = { status: 'error', message: err.message };
    reply({ ok: false, message: err.message });
  }
  broadcast();
}

function makeWindow(file, opts) {
  const w = new BrowserWindow({
    backgroundColor: '#08090c', icon: makeIcon(256), show: false, ...opts,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, autoplayPolicy: 'no-user-gesture-required' },
  });
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.loadFile(path.join(__dirname, 'src', 'renderer', file));
  return w;
}
function showMain() {
  if (win && !win.isDestroyed()) { win.show(); win.focus(); return; }
  win = makeWindow('index.html', {
    width: 1240, height: 800, minWidth: 980, minHeight: 640, title: 'Prayer Pause',
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#08090c', symbolColor: '#ffffff', height: 36 },
  });
  win.setMenuBarVisibility(false);
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } }); // close = minimise to tray
  win.once('ready-to-show', () => { win.show(); askStartupConsent(); });
}
function openSession() {
  if (sessionWin && !sessionWin.isDestroyed()) return;
  const test = !realSession();
  // Real prayers: fullscreen, on top, and F11/Esc/Alt+F4/Ctrl+W do nothing. Alt+Tab, the Win key,
  // Task Manager and shutdown/restart are deliberately left alone.
  sessionWin = makeWindow('session.html', { fullscreen: true, frame: false, alwaysOnTop: !test, minimizable: test, maximizable: false, resizable: false, title: 'Prayer Pause' });
  sessionWin.setMenuBarVisibility(false);
  if (!test) {
    sessionWin.webContents.on('before-input-event', (e, input) => {
      const k = String(input.key).toLowerCase();
      if (input.type === 'keyDown' && (k === 'f11' || k === 'escape' || (input.alt && k === 'f4') || (input.control && (k === 'w' || k === 'q')))) e.preventDefault();
    });
    sessionWin.on('leave-full-screen', () => { if (realSession() && sessionWin && !sessionWin.isDestroyed()) sessionWin.setFullScreen(true); });
    // If it gets closed anyway, put it straight back. (Not blocking "close" keeps Windows shutdown/restart unblocked.)
    sessionWin.on('closed', () => { if (realSession() && !quitting) setTimeout(openSession, 250); });
  }
  sessionWin.once('ready-to-show', () => sessionWin.show());
}
function notify(title, body) {
  if (store.get().notifications && Notification.isSupported()) new Notification({ title, body, silent: true, icon: makeIcon(256) }).show();
}

function buildMenu(state) {
  const fmt = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: state.timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
  const locked = !!state.session && state.session.prayer !== 'test';
  const times = state.prayers.map((p) => ({
    label: `${NAMES[p.id]}   ${fmt(p.time)}${p.source === 'mosque' ? '  (mosque)' : ''}${p.enabled ? '' : '  (off)'}`, enabled: false,
  }));
  return Menu.buildFromTemplate([
    { label: 'Open Prayer Pause', click: showMain },
    { type: 'separator' }, ...times, { type: 'separator' },
    { label: 'Start test session', enabled: !state.session, click: () => scheduler.startManual() },
    { label: locked ? 'Quit (locked during prayer)' : 'Quit', enabled: !locked, click: () => { quitting = true; app.quit(); } },
  ]);
}
function createTray() { tray = new Tray(makeIcon(32)); tray.on('click', showMain); }
function updateTray(state) {
  let tip = 'Prayer Pause';
  if (state.session) tip += ` - ${NAMES[state.session.prayer]} session`;
  else if (state.next) {
    const mins = Math.max(0, Math.ceil((new Date(state.next.time) - Date.now()) / 60000));
    tip += ` - ${NAMES[state.next.id]} in ${Math.floor(mins / 60)}h ${mins % 60}m`;
  }
  if (tip !== lastTip) { lastTip = tip; tray.setToolTip(tip); }
  const sig = state.prayers.map((p) => `${p.time}${p.source}${p.enabled}`).join('|') + (state.session ? `|${state.session.prayer}` : '');
  if (sig !== lastMenuSig) { lastMenuSig = sig; tray.setContextMenu(buildMenu(state)); }
}
function applyStartup() {
  if (!app.isPackaged) return; // in dev this would register electron.exe itself
  app.setLoginItemSettings({ openAtLogin: store.get().startup.openAtLogin, args: ['--hidden'] });
}
async function askStartupConsent() {
  if (store.get().startup.asked) return;
  const r = await dialog.showMessageBox(win, {
    type: 'question', buttons: ['Yes, start with Windows', 'No thanks'], defaultId: 0, cancelId: 1,
    title: 'Start with Windows?', message: 'Start Prayer Pause automatically when you sign in?',
    detail: 'It runs quietly in the system tray so prayer times are never missed. You can change this later.',
  });
  store.update({ startup: { asked: true, openAtLogin: r.response === 0 } });
}

function registerIpc() {
  const trusted = (e) => [win, sessionWin].some((w) => w && !w.isDestroyed() && w.webContents === e.sender);
  const handle = (ch, fn) => ipcMain.handle(ch, (e, ...args) => { if (!trusted(e)) throw new Error('Untrusted sender'); return fn(...args); });
  handle('state:get', () => snapshot());
  handle('settings:get', () => store.get());
  handle('settings:save', (patch) => {
    try { return { ok: true, settings: store.update(patch) }; } catch (err) { return { ok: false, error: err.message }; }
  });
  handle('session:test', () => ({ ok: scheduler.startManual() }));
  handle('session:end', () => { // instant end: test sessions only
    if (!scheduler.session || scheduler.session.prayer !== 'test') return { ok: false, error: 'Real prayer sessions need a photo to end early.' };
    scheduler.endEarly(); return { ok: true };
  });
  handle('session:end-request', async () => {
    if (!realSession()) return { ok: false, error: 'No prayer session is active.' };
    try {
      const url = await proof.start();
      let qr = '';
      try { qr = await require('qrcode').toDataURL(url, { margin: 1, width: 220 }); } catch { /* show the link only */ }
      endFlow = { status: 'waiting', message: 'Scan the code with your phone, then photograph your prayer mat.' };
      return { ok: true, url, qr };
    } catch (err) { return { ok: false, error: `Could not start the photo page: ${err.message}` }; }
  });
  handle('session:end-cancel', () => { proof.stop(); endFlow = null; return { ok: true }; });
  handle('secret:status', () => ({ hasKey: !!getKey() }));
  handle('secret:set', (key) => {
    const k = typeof key === 'string' ? key.trim() : null;
    if (k === null || (k && !/^sk-ant-[\w-]{20,300}$/.test(k))) return { ok: false, error: "That doesn't look like an Anthropic API key (it starts with sk-ant-)." };
    try { setKey(k); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
  });
}
