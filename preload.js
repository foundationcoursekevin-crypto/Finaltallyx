'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The only things the page can ask the desktop shell to do.
contextBridge.exposeInMainWorld('tally', {
  saveAs: (opts) => ipcRenderer.invoke('file:save-as', opts),
  write: (path, content) => ipcRenderer.invoke('file:write', { path, content }),
  open: (opts) => ipcRenderer.invoke('file:open', opts),
  confirm: (opts) => ipcRenderer.invoke('dialog:confirm', opts),
  setDirty: (v) => ipcRenderer.send('doc:dirty', !!v),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action))
});
