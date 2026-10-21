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
    screenshots: false,
    notes: false,
    ide: false,
    downloads: false,
    files: false,
    uia: false,
    context: false
  },
  noteFolders: [],
  downloadFolder: '',
  noteHotkey: 'CommandOrControl+Shift+N',
  wiki: {
    autoHourly: true,
    autoDaily: true,
    memoryMinConfidence: 0.75
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
    chatMaxMessages: 500,
    rules: [],
    sensitiveDetection: true,
    localOnly: false
  },
  watchFolders: [],
  ai: {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-flash',
    visionModel: '',
    temperature: 0.3,
    autoSummarize: true,
    summarizeIntervalMin: 60,
    monthlyBudgetUsd: 0
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
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash', models: ['deepseek-flash', 'deepseek-v4-pro'], label: 'DeepSeek', visionHint: 'DeepSeek 对话模型默认不用于识图；如需识图请填写多模态模型，测试连接会单独校验。' },
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
      const cfg = deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), raw);
      // 2.3.1：deepseek-chat / deepseek-reasoner 已于 2026-07 下线 → 迁移到 deepseek-flash
      if (cfg.ai && /deepseek\.com/.test(cfg.ai.baseUrl || '') && /^deepseek-(chat|reasoner)$/.test(String(cfg.ai.model || '').trim())) cfg.ai.model = 'deepseek-flash';
      if (cfg.ai && typeof cfg.ai.model === 'string') cfg.ai.model = cfg.ai.model.trim();
      if (cfg.ai && typeof cfg.ai.visionModel === 'string') cfg.ai.visionModel = cfg.ai.visionModel.trim();
      return cfg;
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
