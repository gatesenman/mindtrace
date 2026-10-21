/**
 * 2.4 R6 · 日报 / 周报草稿（规则优先，AI 可选）
 * 借鉴 Screenpipe pipes：scheduled day-recap / standup，先可验证的本地草稿，再考虑模型。
 * https://docs.screenpipe.com/pipes
 * https://docs.screenpipe.com/reliable-reports
 * 无数据时写 NO_DATA，不编造完成项。
 */
const dayjs = require('dayjs');
const store = require('../main/store');
const crypto = require('crypto');

function dayBounds(dateStr) {
  const d = dayjs(dateStr || undefined);
  return { day: d, from: d.startOf('day').valueOf(), to: d.endOf('day').valueOf(), key: d.format('YYYY-MM-DD') };
}

function weekBounds(dateStr) {
  const d = dayjs(dateStr || undefined);
  const dow = (d.day() + 6) % 7; // Mon=0
  const start = d.subtract(dow, 'day').startOf('day');
  const end = start.add(6, 'day').endOf('day');
  return { start, end, from: start.valueOf(), to: end.valueOf(), key: start.format('YYYY-MM-DD') };
}

function layerOf(row) {
  try { const m = typeof row.meta === 'string' ? JSON.parse(row.meta) : (row.meta || {}); return m.layer || null; } catch (_) { return null; }
}

function summarizeDay(storeApi, dateStr) {
  const { day, from, to, key } = dayBounds(dateStr);
  const acts = storeApi.all(
    `SELECT id,type,started_at,ended_at,duration_ms,app_name,window_title,url,file_path,content,meta FROM activities WHERE started_at>=? AND started_at<=? ORDER BY started_at ASC LIMIT 800`,
    [from, to]
  );
  if (!acts.length) {
    return {
      status: 'NO_DATA', period: 'daily', period_key: key,
      title: `${key} 日报`, markdown: `# ${key} 日报\n\n> NO_DATA：当日没有采集到活动。\n`,
      stats: { activities: 0 }
    };
  }
  const byApp = new Map();
  const byLayer = new Map();
  const files = new Map();
  const sites = new Map();
  const commits = [];
  let activeMs = 0;
  for (const a of acts) {
    const dur = Number(a.duration_ms || 0) || Math.max(0, (a.ended_at || a.started_at) - a.started_at);
    activeMs += dur;
    const app = a.app_name || a.type || '其他';
    byApp.set(app, (byApp.get(app) || 0) + dur);
    const L = layerOf(a) || a.type;
    byLayer.set(L, (byLayer.get(L) || 0) + 1);
    if (a.file_path && a.type !== 'screenshot') files.set(a.file_path, (files.get(a.file_path) || 0) + 1);
    if (a.url) { try { const h = new URL(a.url).host.replace(/^www\./, ''); sites.set(h, (sites.get(h) || 0) + 1); } catch (_) {} }
    if (a.type === 'ide' && a.content) {
      const lines = String(a.content).split('\n').filter(l => /^[a-f0-9]{7,}/i.test(l) || /commit/i.test(l));
      commits.push(...lines.slice(0, 5));
    }
  }
  const topApps = [...byApp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topFiles = [...files.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const topSites = [...sites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const fmt = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时 ${m % 60} 分`; };
  const md = [
    `# ${key} 日报`,
    '',
    `> 由知迹规则生成 · ${day.format('dddd')} · 活跃约 ${fmt(activeMs)} · ${acts.length} 条记录`,
    '',
    '## 今天做了什么',
    ...topApps.map(([k, v]) => `- **${k}** · ${fmt(v)}`),
    '',
    topFiles.length ? '## 反复打开的文件' : '',
    ...topFiles.map(([k, v]) => `- \`${k}\`（${v} 次）`),
    '',
    topSites.length ? '## 常去网站' : '',
    ...topSites.map(([k, v]) => `- ${k}（${v} 次）`),
    '',
    commits.length ? '## 提交线索' : '',
    ...commits.slice(0, 8).map(c => `- ${c.slice(0, 120)}`),
    '',
    '## 信号层分布',
    ...[...byLayer.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`),
    '',
    '---',
    '_可一键复制到飞书/邮件；如已配置 AI，可在设置中开启「AI 润色日报」。_'
  ].filter(x => x !== undefined).join('\n');

  return {
    status: 'OK', period: 'daily', period_key: key,
    title: `${key} 日报 · ${topApps[0]?.[0] || '活动'}`,
    markdown: md,
    stats: { activities: acts.length, activeMs, topApps, topFiles: topFiles.map(([k]) => k), topSites: topSites.map(([k]) => k) }
  };
}

function summarizeWeek(storeApi, dateStr) {
  const { start, end, from, to, key } = weekBounds(dateStr);
  const acts = storeApi.all(
    `SELECT started_at,duration_ms,app_name,url,file_path,type,meta FROM activities WHERE started_at>=? AND started_at<=? LIMIT 5000`,
    [from, to]
  );
  if (!acts.length) {
    return {
      status: 'NO_DATA', period: 'weekly', period_key: key,
      title: `${key} 周报`, markdown: `# 周报（${key} 起）\n\n> NO_DATA：本周没有采集到活动。\n`,
      stats: { activities: 0 }
    };
  }
  const byDay = new Map();
  const byApp = new Map();
  let activeMs = 0;
  for (const a of acts) {
    const d = dayjs(a.started_at).format('YYYY-MM-DD');
    byDay.set(d, (byDay.get(d) || 0) + 1);
    const dur = Number(a.duration_ms || 0);
    activeMs += dur;
    const app = a.app_name || a.type;
    byApp.set(app, (byApp.get(app) || 0) + dur);
  }
  const topApps = [...byApp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const fmt = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} 分钟` : `${(m / 60).toFixed(1)} 小时`; };
  const md = [
    `# 周报 · ${start.format('MM/DD')} – ${end.format('MM/DD')}`,
    '',
    `> 规则生成 · ${acts.length} 条 · 活跃约 ${fmt(activeMs)}`,
    '',
    '## 每日活跃条数',
    ...[...byDay.entries()].sort().map(([d, n]) => `- ${d}: ${n}`),
    '',
    '## 时间花在哪',
    ...topApps.map(([k, v]) => `- **${k}** · ${fmt(v)}`),
    '',
    '## Standup 草稿',
    '- 本周完成：',
    ...topApps.slice(0, 3).map(([k]) => `  - ${k} 相关工作`),
    '- 下周计划：',
    '- 阻碍：',
    ''
  ].join('\n');
  return {
    status: 'OK', period: 'weekly', period_key: key,
    title: `周报 ${start.format('MM/DD')}–${end.format('MM/DD')}`,
    markdown: md,
    stats: { activities: acts.length, activeMs, days: byDay.size, topApps }
  };
}

function persist(report) {
  const id = store.upsertJournal({
    period: report.period,
    period_key: report.period_key,
    title: report.title,
    content: report.markdown,
    highlights: report.stats?.topApps?.slice(0, 5).map(x => Array.isArray(x) ? x[0] : x) || [],
    stats: { ...report.stats, status: report.status, generatedBy: 'rules-r6' }
  });
  return { ...report, journalId: id };
}

function draftDaily(dateStr) { return persist(summarizeDay(store, dateStr)); }
function draftWeekly(dateStr) { return persist(summarizeWeek(store, dateStr)); }

module.exports = { summarizeDay, summarizeWeek, draftDaily, draftWeekly, dayBounds, weekBounds };
