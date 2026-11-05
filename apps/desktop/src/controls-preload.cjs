'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Narrow capability surface. No generic IPC, Node, tokens or HTTP access.
contextBridge.exposeInMainWorld('broadcastControls', Object.freeze({
  getSettings: () => ipcRenderer.invoke('broadcast:settings:get'),
  updateSettings: changes => ipcRenderer.invoke('broadcast:settings:update', changes),
  getStatus: () => ipcRenderer.invoke('broadcast:session:status'),
}));
