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

function fmtDur(ms, week) {
  const m = Math.round(ms / 60000);
  if (week) return m < 60 ? `${m} 分钟` : `${(m / 60).toFixed(1)} 小时`;
  return m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}

function workBullets(docs, { limit = 10, snip = 90 } = {}) {
  const { KIND_CN } = require('../content/docDigest');
  const { redactText } = require('../privacy/redact');
  const { clip } = require('../content/sessionSummary');
  return docs.slice(0, limit).map(d => {
    const dur = d.ms ? require('../content/docDigest').fmtMin(d.ms).replace(/分钟/, ' 分钟') : '';
    const line = `- **${d.name}** · ${KIND_CN[d.kind] || d.kind}${dur ? ` · ${dur}` : ''}`;
    const q = d.snippet ? clip(redactText(d.snippet), snip) : '';
    return q ? `${line}\n  > ${q}` : line;
  });
}

function collect(acts) {
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
  const docs = require('../content/docDigest').digest(acts, { limit: 12 });
  return { byApp, byLayer, files, sites, commits, activeMs, topApps, topFiles, topSites, docs };
}

function summarizeDay(storeApi, dateStr) {
  const { day, from, to, key } = dayBounds(dateStr);
  const acts = storeApi.all(
    `SELECT id,type,started_at,ended_at,duration_ms,app_name,process_name,window_title,url,file_path,content,meta FROM activities WHERE started_at>=? AND started_at<=? ORDER BY started_at ASC LIMIT 2000`,
    [from, to]
  );
  if (!acts.length) {
    return {
      status: 'NO_DATA', period: 'daily', period_key: key,
      title: `${key} 日报`, markdown: `# ${key} 日报\n\n> NO_DATA：当日没有采集到活动。\n`,
      stats: { activities: 0 }
    };
  }
  const C = collect(acts);
  const wd = '日一二三四五六'[day.day()];
  const work = workBullets(C.docs);
  const md = [
    `# ${key} 日报`,
    '',
    `> 周${wd} · 活跃约 ${fmtDur(C.activeMs)} · ${acts.length} 条`,
    '',
    '## 今天做了什么',
    ...(work.length ? work : C.topApps.map(([k, v]) => `- **${k}** · ${fmtDur(v)}`)),
    '',
    '## 时间分布',
    ...C.topApps.map(([k, v]) => `- **${k}** · ${fmtDur(v)}`),
    '',
    C.topSites.length ? '## 常去网站' : '',
    ...C.topSites.map(([k, v]) => `- ${k}（${v} 次）`),
    '',
    C.commits.length ? '## 提交线索' : '',
    ...C.commits.slice(0, 8).map(c => `- ${c.slice(0, 120)}`),
    ''
  ].filter(x => x !== undefined && x !== '').join('\n').replace(/\n{3,}/g, '\n\n') + '\n';

  const lead = C.docs[0]?.name || C.topApps[0]?.[0] || '活动';
  return {
    status: 'OK', period: 'daily', period_key: key,
    title: `${key} 日报 · ${lead}`,
    markdown: md,
    stats: { activities: acts.length, activeMs: C.activeMs, docs: C.docs.map(d => d.name), topApps: C.topApps, topFiles: C.topFiles.map(([k]) => k), topSites: C.topSites.map(([k]) => k) }
  };
}

function summarizeWeek(storeApi, dateStr) {
  const { start, end, from, to, key } = weekBounds(dateStr);
  const acts = storeApi.all(
    `SELECT id,started_at,duration_ms,app_name,process_name,window_title,url,file_path,type,content,meta FROM activities WHERE started_at>=? AND started_at<=? LIMIT 5000`,
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
  for (const a of acts) {
    const d = dayjs(a.started_at).format('YYYY-MM-DD');
    byDay.set(d, (byDay.get(d) || 0) + 1);
  }
  const C = collect(acts);
  const work = workBullets(C.docs, { limit: 12, snip: 80 });
  const standup = C.docs.length
    ? C.docs.slice(0, 5).map(d => `  - ${d.name}${d.snippet ? '：' + require('../content/sessionSummary').clip(require('../privacy/redact').redactText(d.snippet), 48) : ''}`)
    : C.topApps.slice(0, 3).map(([k]) => `  - ${k} 相关工作`);
  const md = [
    `# 周报 · ${start.format('MM/DD')} – ${end.format('MM/DD')}`,
    '',
    `> ${acts.length} 条 · 活跃约 ${fmtDur(C.activeMs, true)}`,
    '',
    '## 本周做了什么',
    ...(work.length ? work : ['- 本周未识别到文档或页面']),
    '',
    '## 每日',
    ...[...byDay.entries()].sort().map(([d, n]) => `- ${d}: ${n}`),
    '',
    '## 时间分布',
    ...C.topApps.map(([k, v]) => `- **${k}** · ${fmtDur(v, true)}`),
    '',
    '## Standup 草稿',
    '- 本周完成：',
    ...standup,
    '- 下周计划：',
    '- 阻碍：',
    ''
  ].join('\n');
  return {
    status: 'OK', period: 'weekly', period_key: key,
    title: `周报 ${start.format('MM/DD')}–${end.format('MM/DD')}`,
    markdown: md,
    stats: { activities: acts.length, activeMs: C.activeMs, days: byDay.size, topApps: C.topApps, docs: C.docs.map(d => d.name) }
  };
}

function persist(report) {
  const id = store.upsertJournal({
    period: report.period,
    period_key: report.period_key,
    title: report.title,
    content: report.markdown,
    highlights: (report.stats?.docs || []).slice(0, 5).concat((report.stats?.topApps || []).map(x => Array.isArray(x) ? x[0] : x)).filter(Boolean).slice(0, 5),
    stats: { ...report.stats, status: report.status, generatedBy: 'rules-r6' }
  });
  return { ...report, journalId: id };
}

function draftDaily(dateStr) { return persist(summarizeDay(store, dateStr)); }
function draftWeekly(dateStr) { return persist(summarizeWeek(store, dateStr)); }

module.exports = { summarizeDay, summarizeWeek, draftDaily, draftWeekly, dayBounds, weekBounds };
