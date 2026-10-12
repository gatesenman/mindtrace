/**
 * Collector host: batches events onto store via EventBus.
 * Runs in Main process but off hot UI path (timers only). Ready to move to utilityProcess.
 */
const { EventBus } = require('./bus');
const store = require('../main/store');
const windowTracker = require('../collectors/windowTracker');
const browserHistory = require('../collectors/browserHistory');
const clipboardCollector = require('../collectors/clipboard');
const documents = require('../collectors/documents');
const screenshots = require('../collectors/screenshots');
const notes = require('../collectors/notes');
const ide = require('../collectors/ide');
const downloads = require('../collectors/downloads');
const recentFiles = require('../collectors/recentFiles');
const uia = require('../collectors/uia');
const collectorStatus = require('../main/collectorStatus');
const { appendLog } = require('../main/logger');
const wiki = require('../wiki/engine');

let bus = null;
let getConfig = () => ({});
let rollupTimer = null;
let started = false;

function createBus() {
  return new EventBus({
    intervalMs: 2500,
    maxBatch: 40,
    flush: (batch) => {
      try { store.insertActivityBatch(batch); }
      catch (e) { appendLog('ERROR', 'bus.flush', e); }
    }
  });
}

/** Bridge legacy collectors that write directly to store — still OK.
 *  New collectors use bus.push.
 */
function start(opts = {}) {
  getConfig = opts.getConfig || getConfig;
  const clipboard = opts.clipboard;
  const desktopCapturer = opts.desktopCapturer;
  const BrowserWindow = opts.BrowserWindow;
  stop();
  bus = createBus();
  bus.start();
  const cfg = getConfig();
  const cols = cfg.collectors || {};
  const safe = (name, fn) => {
    try { fn(); } catch (e) { collectorStatus.err(name, e); appendLog('ERROR', 'worker:' + name, e); }
  };

  // Legacy direct-store collectors
  if (cols.window) safe('window', () => windowTracker.start({ getConfig, intervalMs: 2000 }));
  else collectorStatus.disabled('window');
  if (cols.browser) safe('browser', () => browserHistory.start({ getConfig, intervalMs: 60000 }));
  else collectorStatus.disabled('browser');
  if (cols.clipboard) safe('clipboard', () => clipboardCollector.start({ getConfig, clipboard, intervalMs: 1500 }));
  else collectorStatus.disabled('clipboard');
  if (cols.documents) safe('documents', () => documents.start({ getConfig }));
  else collectorStatus.disabled('documents');
  if (cols.screenshots) safe('screenshots', () => screenshots.start({ getConfig, desktopCapturer, BrowserWindow, bus }));
  else collectorStatus.disabled('screenshots');

  // v2 bus collectors
  if (cols.notes) safe('notes', () => notes.start({ getConfig, bus, intervalMs: 8000 }));
  else collectorStatus.disabled('notes');
  if (cols.ide) safe('ide', () => ide.start({ getConfig, bus, intervalMs: 10 * 60 * 1000 }));
  else collectorStatus.disabled('ide');
  if (cols.downloads) safe('downloads', () => downloads.start({ getConfig, bus }));
  else collectorStatus.disabled('downloads');
  if (cols.files) safe('files', () => recentFiles.start({ getConfig, bus }));
  else collectorStatus.disabled('files');
  if (cols.uia) safe('uia', () => uia.start({ getConfig, bus, windowTracker, intervalMs: 8000 }));
  else collectorStatus.disabled('uia');

  rollupTimer = setInterval(() => {
    wiki.runIncrementalRollups(getConfig()).catch(e => appendLog('ERROR', 'rollup', e));
  }, 30 * 60 * 1000);

  started = true;
  return { bus };
}

function stop() {
  try { windowTracker.stop(); } catch (_) {}
  try { browserHistory.stop(); } catch (_) {}
  try { clipboardCollector.stop(); } catch (_) {}
  try { documents.stop(); } catch (_) {}
  try { screenshots.stop(); } catch (_) {}
  try { notes.stop(); } catch (_) {}
  try { ide.stop(); } catch (_) {}
  try { downloads.stop(); } catch (_) {}
  try { recentFiles.stop(); } catch (_) {}
  try { uia.stop(); } catch (_) {}
  if (bus) bus.stop();
  bus = null;
  if (rollupTimer) clearInterval(rollupTimer);
  rollupTimer = null;
  started = false;
}

function getBudget() { return bus ? bus.budget.snapshot() : null; }
function getBus() { return bus; }
function isStarted() { return started; }

module.exports = { start, stop, getBudget, getBus, isStarted, notes };
