const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadData: () => ipcRenderer.invoke('load-data'),
  saveData: (data) => ipcRenderer.invoke('save-data', data),
  onNavigateToToday: (callback) => ipcRenderer.on('navigate-to-today', callback),
  onDataChanged: (callback) => ipcRenderer.on('data-changed', callback),
});
