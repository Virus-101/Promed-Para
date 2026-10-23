'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('promedpara', {
  isElectron: true,
  // Silent receipt print; falls back to the standard dialog if the printer refuses.
  printReceipt: () => ipcRenderer.invoke('print-receipt').then(result => { if (!result || !result.ok) window.print(); }).catch(() => window.print())
});
