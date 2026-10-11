const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let logPath = null;

function initLogger() {
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    logPath = path.join(dir, 'crash.log');
  } catch (e) {
    logPath = path.join(require('os').tmpdir(), 'mindtrace-crash.log');
  }
  return logPath;
}

function appendLog(level, msg, err) {
  try {
    if (!logPath) initLogger();
    const line = `[${new Date().toISOString()}] [${level}] ${msg}${err ? ' | ' + (err.stack || err.message || err) : ''}\n`;
    fs.appendFileSync(logPath, line, 'utf8');
  } catch (_) {}
}

function installProcessHandlers() {
  initLogger();
  process.on('uncaughtException', (err) => {
    appendLog('FATAL', 'uncaughtException', err);
    console.error('uncaughtException', err);
  });
  process.on('unhandledRejection', (err) => {
    appendLog('ERROR', 'unhandledRejection', err);
    console.error('unhandledRejection', err);
  });
}

function getLogPath() { return logPath; }

module.exports = { initLogger, appendLog, installProcessHandlers, getLogPath };
