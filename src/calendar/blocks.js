/** 活动时间块（实际轨）：同应用连续活动合并；抖动 ≤3 分钟；AFK ≥5 分钟断开；会议识别 */
const store = require('../main/store');
const JITTER = 3 * 60000, AFK = 5 * 60000;
const MEETING_APPS = /zoom|wemeet|腾讯会议|飞书会议|lark|feishu|teams|钉钉|dingtalk|webex|会议/i;
const MEETING_URL = /meeting\.tencent\.com|zoom\.us\/j|teams\.microsoft\.com\/l\/meetup|meet\.google\.com|vc\.feishu\.cn/i;
const MEETING_TITLE = /会议中|正在开会|meeting|共享屏幕|视频会议/i;
function isMeeting(a) { return MEETING_APPS.test(a.app_name || '') || MEETING_URL.test(a.url || '') || MEETING_TITLE.test(a.window_title || ''); }
const CAT = [[/code|cursor|idea|pycharm|terminal|powershell|wsl|vim/i, '编码'], [/chrome|edge|firefox|safari/i, '浏览'], [/word|excel|ppt|wps|notion|obsidian|typora|飞书文档/i, '文档'], [/微信|wechat|qq|slack|钉钉|飞书|teams|outlook|mail/i, '沟通'], [/figma|photoshop|sketch/i, '设计']];
function category(app) { for (const [re, c] of CAT) if (re.test(app || '')) return c; return '其他'; }

function computeBlocks(from, to) {
  const rows = store.all(`SELECT id,type,app_name,window_title,url,started_at,COALESCE(ended_at, started_at+duration_ms, started_at+60000) ended_at FROM activities WHERE started_at>=? AND started_at<? AND type<>'clipboard' ORDER BY started_at`, [from, to]);
  const blocks = []; let cur = null;
  for (const a of rows) {
    if (a.type === 'idle') { if (cur) { blocks.push(cur); cur = null; } continue; }
    const meet = isMeeting(a);
    const key = meet ? 'meeting' : category(a.app_name) + '|' + (a.app_name || '');
    const end = Math.max(a.ended_at || a.started_at, a.started_at + 30000);
    if (cur && (a.started_at - cur.end > AFK)) { blocks.push(cur); cur = null; }
    if (cur && (cur.key === key || a.started_at - cur.end <= 0 && end - a.started_at < JITTER)) {
      cur.end = Math.max(cur.end, end); cur.events.push(a.id); if (a.window_title) cur.titles.add(a.window_title.slice(0, 60));
      continue;
    }
    if (cur && end - a.started_at < JITTER && blocks.length >= 0 && cur.key !== key) {
      // 短暂切换（<3 分钟）视为抖动，吸收到当前块
      const nxt = rows[rows.indexOf(a) + 1];
      if (nxt && (nxt.app_name === cur.app || (cur.key === 'meeting' && isMeeting(nxt)))) { cur.end = Math.max(cur.end, end); cur.events.push(a.id); continue; }
    }
    if (cur) blocks.push(cur);
    cur = { key, kind: meet ? 'meeting' : 'activity', category: meet ? '会议' : category(a.app_name), app: a.app_name, start: a.started_at, end, events: [a.id], titles: new Set(a.window_title ? [a.window_title.slice(0, 60)] : []) };
  }
  if (cur) blocks.push(cur);
  // 第二遍：<10 分钟的碎片块并入相邻块（间隔 ≤3 分钟），按时长取主导类别 → 10 分钟粒度的可读块
  const merged = [];
  for (const b of blocks) {
    const prev = merged[merged.length - 1];
    const short = (x) => x.end - x.start < 10 * 60000;
    if (prev && b.kind !== 'meeting' && prev.kind !== 'meeting' && b.start - prev.end <= AFK && (short(b) || short(prev))) {
      prev.mix = prev.mix || { [prev.category]: prev.end - prev.start };
      prev.mix[b.category] = (prev.mix[b.category] || 0) + (b.end - b.start);
      prev.end = Math.max(prev.end, b.end); prev.events.push(...b.events); for (const x of b.titles) prev.titles.add(x);
      prev.apps = prev.apps || new Set([prev.app]); prev.apps.add(b.app);
      const top = Object.entries(prev.mix).sort((x, y) => y[1] - x[1])[0][0]; prev.category = top;
      continue;
    }
    merged.push(b);
  }
  blocks.length = 0; blocks.push(...merged);
  return blocks.map(b => ({ id: `blk-${b.start}`, kind: b.kind, category: b.category, app: b.app, start: b.start, end: b.end, minutes: Math.round((b.end - b.start) / 60000), title: b.kind === 'meeting' ? `会议 · ${[...b.titles][0] || b.app}` : b.apps && b.apps.size > 1 ? `${b.category} · ${[...b.apps].filter(Boolean).slice(0, 3).join(' / ')}` : `${b.category} · ${b.app || ''}`, titles: [...b.titles].slice(0, 5), event_ids: b.events.slice(0, 50) }));
}

/** ≥15 分钟的块 → episodes(level=block) */
function buildEpisodes(from, to) {
  let n = 0;
  for (const b of computeBlocks(from, to)) {
    if (b.minutes < 15) continue;
    store.run(`INSERT OR REPLACE INTO episodes (id,level,period_key,start_at,end_at,title,summary,block_ids,importance) VALUES (?,?,?,?,?,?,?,?,?)`,
      ['ep-' + b.start, 'block', new Date(b.start + 8 * 3600000).toISOString().slice(0, 10), b.start, b.end, b.title, `${b.minutes} 分钟 · ${b.titles.join(' / ').slice(0, 160)}`, JSON.stringify(b.event_ids.slice(0, 20)), Math.min(1, b.minutes / 120)]);
    n++;
  }
  return n;
}
function getEpisodes({ from = 0, to = Date.now(), q, limit = 50 } = {}) {
  const w = ['start_at>=?', 'start_at<?']; const p = [from, to];
  if (q) { w.push('(title LIKE ? OR summary LIKE ?)'); p.push('%' + q + '%', '%' + q + '%'); }
  return store.all(`SELECT * FROM episodes WHERE ${w.join(' AND ')} ORDER BY start_at DESC LIMIT ?`, [...p, limit]);
}
module.exports = { computeBlocks, buildEpisodes, getEpisodes, isMeeting, category };
