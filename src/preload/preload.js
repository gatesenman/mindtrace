const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mindtrace', {
  clearChat: () => ipcRenderer.invoke('clear-chat'),
  proAudit: (o) => ipcRenderer.invoke('pro-audit', o),
  proWipeRange: (o) => ipcRenderer.invoke('pro-wipe-range', o),
  proGetRules: () => ipcRenderer.invoke('pro-get-rules'),
  proSetRules: (o) => ipcRenderer.invoke('pro-set-rules', o),
  proUsage: () => ipcRenderer.invoke('pro-usage'),
  proJobs: () => ipcRenderer.invoke('pro-jobs'),
  proRetryJob: (id) => ipcRenderer.invoke('pro-retry-job', id),
  proReviewQueue: (s) => ipcRenderer.invoke('pro-review-queue', s),
  proReview: (o) => ipcRenderer.invoke('pro-review', o),
  proMemoryCounts: () => ipcRenderer.invoke('pro-memory-counts'),
  proAnalytics: (o) => ipcRenderer.invoke('pro-analytics', o),
  proWeekly: () => ipcRenderer.invoke('pro-weekly'),
  proBackup: (o) => ipcRenderer.invoke('pro-backup', o),
  proRestore: (o) => ipcRenderer.invoke('pro-restore', o),
  proDiagnostics: () => ipcRenderer.invoke('pro-diagnostics'),
  proMcpInfo: () => ipcRenderer.invoke('pro-mcp-info'),

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
  clusterTopics: () => ipcRenderer.invoke('cluster-topics'),
  extractCards: () => ipcRenderer.invoke('extract-cards'),
  exportVault: (p) => ipcRenderer.invoke('export-vault', p),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  testAi: () => ipcRenderer.invoke('test-ai'),
  captureNow: () => ipcRenderer.invoke('capture-now'),
  getPresets: () => ipcRenderer.invoke('get-presets'),
  seedDemo: () => ipcRenderer.invoke('seed-demo'),
  setDemoMode: (on) => ipcRenderer.invoke('set-demo-mode', on),
  getCollectorStatus: () => ipcRenderer.invoke('get-collector-status'),
  getTopics: () => ipcRenderer.invoke('get-topics'),
  getById: (kind, id) => ipcRenderer.invoke('get-by-id', { kind, id }),
  getLogPath: () => ipcRenderer.invoke('get-log-path'),
  openLog: () => ipcRenderer.invoke('open-log'),
  getRollups: (opts) => ipcRenderer.invoke('get-rollups', opts),
  getWiki: (kind) => ipcRenderer.invoke('get-wiki', kind),
  getMemories: (kind) => ipcRenderer.invoke('get-memories', kind),
  searchFts: (q) => ipcRenderer.invoke('search-fts', q),
  getBudget: () => ipcRenderer.invoke('get-budget'),
  addQuickNote: (p) => ipcRenderer.invoke('add-quick-note', p),
  buildRollup: (opts) => ipcRenderer.invoke('build-rollup', opts),
  onQuickNote: (cb) => { const fn=(_e,d)=>cb(d); ipcRenderer.on('quick-note-open', fn); return ()=>ipcRenderer.removeListener('quick-note-open', fn); },
  onStatus: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on('status', fn);
    return () => ipcRenderer.removeListener('status', fn);
  },
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  // v2.3
  v23: (channel, arg) => {
    if (!/^v23-[a-z0-9-]+$/.test(channel)) return Promise.reject(new Error('bad channel'));
    return ipcRenderer.invoke(channel, arg);
  },
  onV23: (event, cb) => {
    if (!['v23-changed', 'reminder', 'open-view'].includes(event)) return () => {};
    const fn = (_e, d) => cb(d); ipcRenderer.on(event, fn); return () => ipcRenderer.removeListener(event, fn);
  },
  getAppVersion: () => ipcRenderer.invoke('get-app-version')
});
