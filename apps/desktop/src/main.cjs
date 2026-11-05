'use strict';
const { app, BrowserWindow, Menu, clipboard, dialog, session, ipcMain } = require('electron');
const { pathToFileURL } = require('node:url');
const { join } = require('node:path');
const { mkdirSync } = require('node:fs');

let window = null;
let controlsWindow = null;
let service = null;
let shutdownStarted = false;
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
      !service) {
    throw new Error('Untrusted operator request');
  }
}

function registerControlsHandlers() {
  ipcMain.handle('broadcast:settings:get', event => {
    requireControlsFrame(event);
    return service.getSettings();
  });
  ipcMain.handle('broadcast:settings:update', (event, changes) => {
    requireControlsFrame(event);
    return service.updateSettings(changes);
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
    height: 740,
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
  } catch (error) {
    if (!target.isDestroyed()) target.destroy();
    throw error;
  }
}

async function openDemo() {
  const { startDesktopDemo } = await import(pathToFileURL(
    join(__dirname, 'demo-service.js')
  ).href);
  const userData = app.getPath('userData');
  mkdirSync(userData, { recursive: true });
  service = await startDesktopDemo({ settingsPath: join(userData, 'operator-settings.json') });

  session.defaultSession.setPermissionRequestHandler((_contents, _permission, answer) => {
    answer(false);
  });
  const hudUrl = service.hudUrl;
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
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Broadcast',
      submenu: [
        {
          label: 'Operator Controls',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            openControls().catch(error => {
              dialog.showErrorBox('Unable to open controls', String(error.message ?? error));
            });
          },
        },
        { label: 'Copy OBS Browser Source URL', click: () => clipboard.writeText(hudUrl) },
        { label: 'Reload preview', accelerator: 'CmdOrCtrl+R',
          click: () => window?.webContents.reloadIgnoringCache() },
        { type: 'separator' },
        { label: 'Quit', role: 'quit' },
      ],
    },
  ]));
}

if (gotLock) {
  app.whenReady().then(openDemo).catch(error => {
    dialog.showErrorBox('AnoCore Broadcast could not start',
      'The local HUD could not start. Another process may already use port 3008 or 3009.\n\n' +
      String(error.message ?? error));
    app.quit();
  });
}
app.on('before-quit', event => {
  if (!service || shutdownStarted) return;
  event.preventDefault();
  shutdownStarted = true;
  service.close().catch(() => {}).finally(() => {
    service = null;
    app.quit();
  });
});
app.on('window-all-closed', () => app.quit());
