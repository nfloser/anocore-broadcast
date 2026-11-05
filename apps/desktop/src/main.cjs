'use strict';
const { app, BrowserWindow, Menu, clipboard, dialog, session, ipcMain } = require('electron');
const { pathToFileURL } = require('node:url');
const { join } = require('node:path');
const { mkdirSync } = require('node:fs');

let window = null;
let controlsWindow = null;
let modeManager = null;
let shutdownStarted = false;
let switching = false;
const controlsPath = join(__dirname, 'controls.html');
const controlsUrl = pathToFileURL(controlsPath).href;
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.on('second-instance', () => {
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});

function restrictNavigation(target, permittedUrl) {
  target.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  target.webContents.on('will-navigate', (event, url) => {
    if (url !== permittedUrl) event.preventDefault();
  });
}

function requireControlsFrame(event) {
  if (!controlsWindow || controlsWindow.isDestroyed() ||
      event.sender !== controlsWindow.webContents ||
      event.senderFrame !== controlsWindow.webContents.mainFrame ||
      event.senderFrame.url !== controlsUrl ||
      !modeManager?.current) {
    throw new Error('Untrusted operator request');
  }
}

function registerControlsHandlers() {
  ipcMain.handle('broadcast:settings:get', event => {
    requireControlsFrame(event);
    return modeManager.current.getSettings();
  });
  ipcMain.handle('broadcast:settings:update', (event, changes) => {
    requireControlsFrame(event);
    return modeManager.current.updateSettings(changes);
  });
  ipcMain.handle('broadcast:session:status', event => {
    requireControlsFrame(event);
    return modeManager.current.getStatus();
  });
}

async function openControls() {
  if (controlsWindow && !controlsWindow.isDestroyed()) {
    controlsWindow.focus();
    return;
  }
  controlsWindow = new BrowserWindow({
    title: 'AnoCore Broadcast · Operator Controls',
    parent: window,
    width: 780,
    height: 790,
    minWidth: 540,
    minHeight: 620,
    backgroundColor: '#0d141e',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'controls-preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: false,
    },
  });
  const target = controlsWindow;
  restrictNavigation(target, controlsUrl);
  target.once('ready-to-show', () => target.show());
  target.on('closed', () => {
    if (controlsWindow === target) controlsWindow = null;
  });
  try {
    await target.loadFile(controlsPath);
  } catch {
    if (!target.isDestroyed()) target.destroy();
    throw new Error('Unable to load operator interface');
  }
}

async function exportGsiConfig() {
  const current = modeManager?.current;
  if (current?.mode !== 'live' || switching) return;
  const { discoverCs2ConfigDirectories } = await import(pathToFileURL(
    join(__dirname, 'steam-discovery.js')
  ).href);
  const { saveObserverConfig, CS2_GSI_FILENAME } = await import(pathToFileURL(
    join(__dirname, 'gsi-save.js')
  ).href);
  const detected = discoverCs2ConfigDirectories();
  let targetDirectory = app.getPath('documents');
  if (detected.length === 1) {
    const selected = await dialog.showMessageBox(window, {
      type: 'question',
      message: 'Counter-Strike 2 installation detected',
      detail: 'Use this CS2 cfg folder?\n' + detected[0] +
        '\n\nThe file will only be saved after you confirm in the next dialog.',
      buttons: ['Use detected CS2 folder', 'Choose manually', 'Cancel'],
      defaultId: 0, cancelId: 2, noLink: true,
    });
    if (selected.response === 2) return;
    if (selected.response === 0) targetDirectory = detected[0];
  } else if (detected.length > 1) {
    const candidates = detected.slice(0, 5);
    const selected = await dialog.showMessageBox(window, {
      type: 'question',
      message: 'Multiple CS2 installations detected',
      detail: candidates.map((path, i) => (i + 1) + '. ' + path).join('\n') +
        '\n\nChoose the matching installation or browse manually.',
      buttons: [...candidates.map((_, i) => 'Library ' + (i + 1)), 'Choose manually', 'Cancel'],
      cancelId: candidates.length + 1, noLink: true,
    });
    if (selected.response === candidates.length + 1) return;
    if (selected.response < candidates.length) targetDirectory = candidates[selected.response];
  }
  const result = await dialog.showSaveDialog(window, {
    title: "Save this session's CS2 GSI configuration",
    defaultPath: join(targetDirectory, CS2_GSI_FILENAME),
    buttonLabel: 'Save GSI configuration',
    filters: [{ name: 'CS2 GSI configuration', extensions: ['cfg'] }],
  });
  if (result.canceled || !result.filePath) return;
  // A switch can occur while the native file picker is open.
  if (current !== modeManager?.current || current.mode !== 'live') return;
  try {
    // CS2 requires a plaintext token inside the user's explicitly exported
    // CFG. Never place it in HUD, frontend IPC, logs or persistent app settings.
    saveObserverConfig(result.filePath, current.getGsiConfig());
    dialog.showMessageBoxSync(window, {
      type: 'info',
      message: 'CS2 observer configuration saved.',
      detail: "Place the CFG in Counter-Strike 2's game/csgo/cfg directory, then restart CS2. Keep it private. A new Live session generates a new key and needs a new CFG.",
    });
  } catch {
    dialog.showErrorBox('Unable to save GSI configuration',
      'The file already exists or cannot be written. Use a new filename or deliberately remove the old file before exporting again.');
  }
}

function updateMenu() {
  const mode = modeManager?.current?.mode;
  Menu.setApplicationMenu(Menu.buildFromTemplate([{
    label: 'Broadcast',
    submenu: [
      {
        label: 'Start Demo',
        enabled: !switching && mode !== 'demo',
        click: () => switchMode('demo'),
      },
      {
        label: 'Start Live Observer',
        enabled: !switching && mode !== 'live',
        click: () => switchMode('live'),
      },
      {
        label: 'Export CS2 GSI Config…',
        enabled: !switching && mode === 'live',
        click: () => exportGsiConfig(),
      },
      { type: 'separator' },
      {
        label: 'Operator Controls',
        accelerator: 'CmdOrCtrl+,',
        click: () => openControls().catch(() => {
          dialog.showErrorBox('Unable to open controls', 'Unable to load operator controls.');
        }),
      },
      {
        label: 'Copy OBS Browser Source URL',
        click: () => {
          if (modeManager?.current) clipboard.writeText(modeManager.current.hudUrl);
        },
      },
      {
        label: 'Reload preview',
        accelerator: 'CmdOrCtrl+R',
        click: () => window?.webContents.reloadIgnoringCache(),
      },
      { type: 'separator' },
      { label: 'Quit', role: 'quit' },
    ],
  }]));
}

async function switchMode(mode) {
  if (switching || shutdownStarted || !modeManager) return;
  switching = true;
  updateMenu();
  try {
    await modeManager.switchTo(mode);
    if (window && !window.isDestroyed()) {
      await window.loadURL(modeManager.current.hudUrl);
      window.setTitle('AnoCore Broadcast · ' +
        (modeManager.current.mode === 'live' ? 'Live Observer' : 'Demo Preview'));
    }
    if (mode === 'live' && window) {
      dialog.showMessageBoxSync(window, {
        type: 'info',
        message: 'Live Observer is waiting for CS2.',
        detail: 'Choose Broadcast → Export CS2 GSI Config and install the file in your local game/csgo/cfg directory. Restart CS2. The HUD will not fabricate match information.',
      });
    }
  } catch {
    if (modeManager.current && window && !window.isDestroyed()) {
      await window.loadURL(modeManager.current.hudUrl).catch(() => {});
    }
    dialog.showErrorBox('Unable to switch broadcast mode',
      'The mode could not start. Check ports 3008 and 3009 and try again. The app attempts to restore Demo mode on failure.');
  } finally {
    switching = false;
    updateMenu();
  }
}

async function openDesktop() {
  const { startDesktopDemo } = await import(pathToFileURL(
    join(__dirname, 'demo-service.js')
  ).href);
  const { startDesktopLive } = await import(pathToFileURL(
    join(__dirname, 'live-service.js')
  ).href);
  const { createDesktopModes } = await import(pathToFileURL(
    join(__dirname, 'modes.js')
  ).href);
  const userData = app.getPath('userData');
  mkdirSync(userData, { recursive: true });
  const settingsPath = join(userData, 'operator-settings.json');
  modeManager = createDesktopModes({
    demo: () => startDesktopDemo({ settingsPath }),
    live: () => startDesktopLive({ settingsPath }),
  });
  await modeManager.switchTo('demo');
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, answer) => {
    answer(false);
  });
  const hudUrl = modeManager.current.hudUrl;
  window = new BrowserWindow({
    title: 'AnoCore Broadcast · Demo Preview',
    width: 1480,
    height: 940,
    minWidth: 960,
    minHeight: 720,
    backgroundColor: '#0b1119',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: false,
    },
  });
  restrictNavigation(window, hudUrl);
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    window = null;
    app.quit();
  });
  await window.loadURL(hudUrl);
  registerControlsHandlers();
  updateMenu();
}

if (gotLock) {
  app.whenReady().then(openDesktop).catch(() => {
    dialog.showErrorBox('AnoCore Broadcast could not start',
      'Unable to start the local application. Check ports 3008/3009 and saved operator settings.');
    app.quit();
  });
}

app.on('before-quit', event => {
  if (!modeManager || shutdownStarted) return;
  event.preventDefault();
  shutdownStarted = true;
  modeManager.close().catch(() => {}).finally(() => {
    modeManager = null;
    app.quit();
  });
});
app.on('window-all-closed', () => app.quit());
