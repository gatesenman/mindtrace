const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  authorized: false,
  onboardingCompleted: false,
  authorizedAt: null,
  theme: 'light',
  language: 'zh-CN',
  startOnBoot: false,
  startCollectingOnLaunch: true,
  demoMode: false,
  collectors: {
    window: false,
    browser: false,
    documents: false,
    clipboard: false,
    screenshots: false
  },
  privacy: {
    paused: false,
    blacklistApps: ['密码', 'Password', '1Password', 'Bitwarden', 'KeePass', '银行', 'Bank', '微信安全'],
    blacklistSites: ['password', 'banking', '支付宝', '网银', 'login'],
    blacklistKeywords: ['密码', '验证码', '身份证号', '银行卡', 'cvv'],
    clipboardMaxLen: 5000,
    screenshotIntervalSec: 300,
    idleThresholdSec: 300,
    autoRedact: true,
    pauseHotkey: 'CommandOrControl+Shift+M',
    onlyScreenshotApps: ['WeChat', 'WXWork', 'Feishu', 'DingTalk', '微信', '企业微信', '飞书', '钉钉'],
    screenshotRetainDays: 14,
    activityRetainDays: 90,
    chatMaxMessages: 500
  },
  watchFolders: [],
  ai: {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    visionModel: '',
    temperature: 0.3,
    autoSummarize: true,
    summarizeIntervalMin: 60
  },
  api: {
    enabled: false,
    port: 17321,
    token: ''
  },
  export: {
    vaultPath: ''
  }
};

const PRESETS = {
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', label: 'DeepSeek' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', label: '通义千问' },
  kimi: { baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', label: 'Kimi' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', label: 'OpenAI' },
  ollama: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.2', label: 'Ollama 本地' },
  custom: { baseUrl: '', model: '', label: '自定义' }
};

function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig() {
  try {
    const p = getConfigPath();
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      return deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), raw);
    }
  } catch (e) {
    console.error('loadConfig', e);
  }
  return JSON.parse(JSON.stringify(DEFAULTS));
}

function saveConfig(cfg) {
  const p = getConfigPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf8');
}

function deepMerge(a, b) {
  for (const k of Object.keys(b || {})) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) {
      a[k] = deepMerge(a[k] || {}, b[k]);
    } else {
      a[k] = b[k];
    }
  }
  return a;
}

module.exports = { DEFAULTS, PRESETS, loadConfig, saveConfig, getConfigPath };
