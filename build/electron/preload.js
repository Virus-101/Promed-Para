'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('promedpara', {
  isElectron: true,
  // Silent receipt print; falls back to the standard dialog if the printer refuses.
  remember: {
    info: () => ipcRenderer.invoke('remember:info'),
    save: (name, code) => ipcRenderer.invoke('remember:save', name, code),
    use: () => ipcRenderer.invoke('remember:use'),
    forget: () => ipcRenderer.invoke('remember:forget')
  },
  printReceipt: () => ipcRenderer.invoke('print-receipt').then(result => { if (!result || !result.ok) window.print(); }).catch(() => window.print())
});
