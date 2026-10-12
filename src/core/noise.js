/**
 * 噪声过滤（2.3.2）——采集入库、时间线、统计、汇总、LLM 抽取共用一套规则。
 *  classify(a) → { drop, low, reason }
 *    drop：确定的垃圾（系统外壳/任务切换、知迹自身、内部 JSON），入库前即丢弃
 *    low ：低价值（驻留过短窗口、过短剪贴板、只有窗口名的界面文本），默认隐藏但保留
 */
const MIN_DWELL_MS = 10 * 1000;     // 窗口驻留阈值
const CLIP_MIN_LEN = 8;             // 剪贴板低价值阈值
const UIA_MIN_LEN = 24;             // 界面文本最少有效字符
const DEDUPE_MS = 60 * 1000;

const SHELL_PROCS = /^(shellexperiencehost|searchhost|searchapp|searchui|startmenuexperiencehost|lockapp|logonui|textinputhost|applicationframehost|windows\.ui\.|systemsettingsbroker|shellhost|dwm|taskmgr_hidden|pickerhost|notificationcenter|widgets|lockscreen)/i;
const SHELL_TITLES = /^(任务切换|task switching|任务视图|task view|开始|start|搜索|search|program manager|通知中心|action center|操作中心|快速设置|quick settings|系统托盘溢出窗口。?|notifyiconoverflowwindow|windows 默认锁屏界面|windows default lock screen|锁屏|新通知|new notification|窗口切换器|cortana|小组件|widgets|桌面|desktop|翻转 3d|win\+tab|windows 输入体验|windows input experience|日期和时间信息|控制中心)$/i;
const EXPLORER = /^(explorer(\.exe)?|资源管理器|文件资源管理器|windows 资源管理器|file explorer)$/i;
const SELF = /^(mindtrace|知迹|electron)(\.exe)?$/i;
const INTERNAL_JSON = /^\s*[{[]\s*"(purpose|prompt_tokens|completion_tokens|isDemo|kind|op|channel|ts_start|usage)"\s*:/;

const norm = (s) => String(s || '').trim();
const procName = (a) => norm(a.process_name || a.process || (a.meta && a.meta.process)).replace(/\.exe$/i, '').toLowerCase();
const meta = (a) => { if (!a.meta) return {}; if (typeof a.meta === 'object') return a.meta; try { return JSON.parse(a.meta); } catch (_) { return {}; } };

function isSelf(a) {
  const app = norm(a.app_name || a.app), p = procName(a), m = meta(a);
  return SELF.test(app) || SELF.test(p) || /^知迹/.test(app) || m.sourceApp === 'self' || SELF.test(norm(m.sourceProcess));
}
function isShellNoise(a) {
  const p = procName(a), title = norm(a.window_title || a.title), app = norm(a.app_name || a.app);
  if (SHELL_PROCS.test(p)) return true;
  if (SHELL_TITLES.test(title)) return true;
  if ((EXPLORER.test(p) || EXPLORER.test(app)) && !title) return true;
  return false;
}

function classify(a, { now = Date.now(), minDwellMs = MIN_DWELL_MS } = {}) {
  const type = a.type;
  const content = norm(a.content);
  const title = norm(a.window_title || a.title);
  if (type !== 'note' && isSelf(a)) return { drop: true, low: true, reason: '知迹自身' };
  if (type === 'window' || type === 'uia') { if (isShellNoise(a)) return { drop: true, low: true, reason: '系统任务切换/外壳' }; }
  if (type === 'clipboard') {
    if (INTERNAL_JSON.test(content)) return { drop: true, low: true, reason: '知迹内部数据' };
    if (/^\[已隐藏/.test(content)) return { drop: false, low: true, reason: '已隐藏内容' };
    if (content.length < CLIP_MIN_LEN) return { drop: false, low: true, reason: '过短复制' };
    if (/^[\w.:-]{1,32}$/.test(content) && !/^https?:/.test(content)) return { drop: false, low: true, reason: '单个标识符' };
  }
  if (type === 'window') {
    const dur = Number(a.duration_ms || 0);
    const ended = a.ended_at != null && a.ended_at !== '';
    const ongoing = !ended && (now - Number(a.started_at || 0)) < 10 * 60000;
    if (!ongoing && dur < minDwellMs) return { drop: false, low: true, reason: '驻留过短' };
  }
  if (type === 'uia') {
    const eff = content.replace(title, '').replace(/\s+/g, '');
    if (eff.length < UIA_MIN_LEN) return { drop: false, low: true, reason: '仅窗口名' };
  }
  return { drop: false, low: false, reason: '' };
}

const dedupeKey = (a) => [a.type, norm(a.app_name || a.app), norm(a.window_title || a.title), norm(a.url), norm(a.file_path || a.path), norm(a.content).slice(0, 300)].join('|');

/** 入库前去重：同一事件 60s 内只记一次（进程内 LRU） */
const recent = new Map();
function seenRecently(a, ts = Date.now()) {
  if (a.type === 'window') return false; // 窗口由 tracker 自行合并
  const k = dedupeKey(a);
  const prev = recent.get(k);
  recent.set(k, ts);
  if (recent.size > 500) { const cut = ts - DEDUPE_MS; for (const [kk, v] of recent) if (v < cut) recent.delete(kk); }
  return prev != null && ts - prev < DEDUPE_MS;
}
function resetDedupe() { recent.clear(); }

/** 读侧过滤：去掉 drop、可选去掉 low、60s 内重复 */
function filter(rows, { hideLow = true, now = Date.now() } = {}) {
  const desc = rows.length > 1 && (rows[0].started_at || 0) > (rows[rows.length - 1].started_at || 0);
  const out = []; const last = new Map();
  const sorted = [...rows].sort((x, y) => (x.started_at || 0) - (y.started_at || 0));
  for (const r of sorted) {
    const c = classify(r, { now });
    if (c.drop) continue;
    if (hideLow && c.low) continue;
    const k = dedupeKey(r); const t = r.started_at || 0;
    if (r.type !== 'window' && last.has(k) && t - last.get(k) < DEDUPE_MS) continue;
    last.set(k, t);
    out.push(c.low ? { ...r, _low: c.reason } : r);
  }
  return desc ? out.reverse() : out;
}

/** 合并连续同应用窗口为会话块（输入可为升序或降序，输出保持原序） */
function sessionize(rows, { gapMs = 5 * 60000 } = {}) {
  const desc = rows.length > 1 && (rows[0].started_at || 0) > (rows[rows.length - 1].started_at || 0);
  const asc = desc ? [...rows].reverse() : rows;
  const out = []; let cur = null;
  const endOf = (r) => Number(r.ended_at || 0) || (Number(r.started_at || 0) + Number(r.duration_ms || 0));
  for (const r of asc) {
    const app = norm(r.app_name || r.process_name);
    if (r.type === 'window' && cur && cur.app === app && Number(r.started_at) - cur.end <= gapMs) {
      cur.items.push(r); cur.end = Math.max(cur.end, endOf(r)); cur.total_ms += Number(r.duration_ms || 0);
      continue;
    }
    if (cur) out.push(finish(cur));
    cur = r.type === 'window' ? { kind: 'session', app, start: Number(r.started_at), end: endOf(r), total_ms: Number(r.duration_ms || 0), items: [r] } : null;
    if (!cur) out.push(r);
  }
  if (cur) out.push(finish(cur));
  function finish(s) {
    if (s.items.length === 1) return s.items[0];
    const titles = [...new Set(s.items.map(i => norm(i.window_title)).filter(Boolean))];
    return { ...s, type: 'session', id: 'sess-' + s.items[0].id, started_at: s.start, ended_at: s.end, app_name: s.app, titles, windowCount: titles.length || s.items.length };
  }
  return desc ? out.reverse() : out;
}

/** 给 SQL 用：粗粒度排除（剩余由 classify 精筛） */
const SQL_EXCLUDE = `NOT (type='window' AND ended_at IS NOT NULL AND COALESCE(duration_ms,0) < ${MIN_DWELL_MS})`;

module.exports = { classify, filter, sessionize, seenRecently, resetDedupe, isSelf, isShellNoise, dedupeKey, SQL_EXCLUDE, MIN_DWELL_MS, CLIP_MIN_LEN, UIA_MIN_LEN, DEDUPE_MS };
