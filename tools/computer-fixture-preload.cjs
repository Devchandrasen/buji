const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fixture', { save: text => ipcRenderer.invoke('fixture-save', text) });
