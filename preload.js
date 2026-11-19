'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Only these fixed calls are exposed. The renderer never gets ipcRenderer itself.
contextBridge.exposeInMainWorld('prayerPause', {
  getState: () => ipcRenderer.invoke('state:get'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  startTestSession: () => ipcRenderer.invoke('session:test'),
  endSession: () => ipcRenderer.invoke('session:end'),
  requestEndEarly: () => ipcRenderer.invoke('session:end-request'),
  cancelEndEarly: () => ipcRenderer.invoke('session:end-cancel'),
  getKeyStatus: () => ipcRenderer.invoke('secret:status'),
  setApiKey: (key) => ipcRenderer.invoke('secret:set', key),
  onState: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('state:update', handler);
    return () => ipcRenderer.removeListener('state:update', handler);
  },
});
