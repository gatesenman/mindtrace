const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mindtrace', {
  getState: () => ipcRenderer.invoke('get-state'),
  setConfig: (patch) => ipcRenderer.invoke('set-config', patch),
  authorize: (ok, collectors) => ipcRenderer.invoke('authorize', ok, collectors),
  setPaused: (paused) => ipcRenderer.invoke('set-paused', paused),
  getTodayStats: () => ipcRenderer.invoke('get-today-stats'),
  getTimeline: (opts) => ipcRenderer.invoke('get-timeline', opts),
  getCards: (opts) => ipcRenderer.invoke('get-cards', opts),
  getJournals: () => ipcRenderer.invoke('get-journals'),
  getChat: () => ipcRenderer.invoke('get-chat'),
  ask: (q) => ipcRenderer.invoke('ask', q),
  summarizeToday: () => ipcRenderer.invoke('summarize-today'),
  extractCards: () => ipcRenderer.invoke('extract-cards'),
  exportVault: (p) => ipcRenderer.invoke('export-vault', p),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  testAi: () => ipcRenderer.invoke('test-ai'),
  captureNow: () => ipcRenderer.invoke('capture-now'),
  getPresets: () => ipcRenderer.invoke('get-presets'),
  seedDemo: () => ipcRenderer.invoke('seed-demo'),
  onStatus: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on('status', fn);
    return () => ipcRenderer.removeListener('status', fn);
  }
});
