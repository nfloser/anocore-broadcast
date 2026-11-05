'use strict';
const { app, BrowserWindow, Menu, clipboard, dialog, session } = require('electron');
const { pathToFileURL } = require('node:url');

let window = null;
let service = null;
let shutdownStarted = false;
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.on('second-instance', () => {
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});

async function openDemo() {
  const { startDesktopDemo } = await import(pathToFileURL(
    require('node:path').join(__dirname, 'demo-service.js')
  ).href);
  service = await startDesktopDemo();
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
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== hudUrl) event.preventDefault();
  });
  window.once('ready-to-show', () => window.show());
  await window.loadURL(hudUrl);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Broadcast',
      submenu: [
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
  app.whenReady().then(openDemo).catch(async error => {
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
