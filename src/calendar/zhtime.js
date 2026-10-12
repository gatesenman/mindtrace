/**
 * zhtime — 中文时间表达解析器（chrono 风格，规则 + 组合），零依赖、与运行机器时区无关。
 * parse(text, anchor, opts) → [{ text, index, start, end?, certainty, deadline?, rrule?, allDay? }]
 *   start/end：UTC epoch 毫秒；certainty：exact | approx | date_only | none
 * 所有日期运算在“目标时区墙钟”上进行（默认 Asia/Shanghai，UTC+8）。
 */
const DAY = 86400000;
const CN = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const WD = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7, 末: 6 };
const BYDAY = ['', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

// 2026 国务院节假日（含调休）。可通过 opts.holidays 覆盖。
const HOLIDAYS_2026 = {
  元旦: ['2026-01-01', '2026-01-03'], 春节: ['2026-02-15', '2026-02-23'], 清明: ['2026-04-04', '2026-04-06'],
  劳动节: ['2026-05-01', '2026-05-05'], 端午: ['2026-06-19', '2026-06-21'], 中秋: ['2026-09-25', '2026-09-27'],
  国庆: ['2026-10-01', '2026-10-08']
};
const MAKEUP_WORKDAYS_2026 = ['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10'];

function cnNum(s) {
  if (/^\d+$/.test(s)) return Number(s);
  if (s === '十') return 10;
  let m = /^([一二两三四五六七八九])?十([一二三四五六七八九])?$/.exec(s);
  if (m) return (m[1] ? CN[m[1]] : 1) * 10 + (m[2] ? CN[m[2]] : 0);
  if (s.length === 1 && s in CN) return CN[s];
  return NaN;
}
/** 中文数字 → 阿拉伯数字（只替换紧跟时间单位的数字） */
function normalizeNumbers(text) {
  return text
    .replace(/([零〇一二两三四五六七八九十]{1,3})(?=\s*(点|时|月|号|日|天|周|个|分|刻))/g, (m, n) => { const v = cnNum(n); return Number.isNaN(v) ? m : String(v); })
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/：/g, ':');
}

// ── 墙钟工具（以 offset 小时表示的固定时区） ──
const W = (ms, off) => { const d = new Date(ms + off * 3600000); return { y: d.getUTCFullYear(), M: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), m: d.getUTCMinutes(), dow: d.getUTCDay() || 7 }; };
const toMs = (y, M, d, h, m, off) => Date.UTC(y, M - 1, d, h, m) - off * 3600000;
const ymd = (o) => `${o.y}-${String(o.M).padStart(2, '0')}-${String(o.d).padStart(2, '0')}`;
const addDays = (o, n) => { const t = new Date(Date.UTC(o.y, o.M - 1, o.d) + n * DAY); return { ...o, y: t.getUTCFullYear(), M: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: t.getUTCDay() || 7 }; };
const dateObj = (y, M, d) => addDays({ y, M, d, dow: 1 }, 0);

function isWorkday(o, opts) {
  const s = ymd(o);
  if ((opts.makeupWorkdays || MAKEUP_WORKDAYS_2026).includes(s)) return true;
  for (const [a, b] of Object.values(opts.holidays || HOLIDAYS_2026)) if (s >= a && s <= b) return false;
  return o.dow <= 5;
}

/** 美国夏令时：3 月第二个周日 ~ 11 月第一个周日 */
function usDst(ms) {
  const y = new Date(ms).getUTCFullYear();
  const nthSunday = (M, n) => { const first = new Date(Date.UTC(y, M - 1, 1)).getUTCDay(); return 1 + ((7 - first) % 7) + (n - 1) * 7; };
  return ms >= Date.UTC(y, 2, nthSunday(3, 2), 10) && ms < Date.UTC(y, 10, nthSunday(11, 1), 9);
}
const ZONES = [
  [/美西时间|太平洋时间|\bPT\b|\bPST\b|\bPDT\b/i, (ms) => usDst(ms) ? -7 : -8],
  [/美东时间|\bET\b|\bEST\b|\bEDT\b/i, (ms) => usDst(ms) ? -4 : -5],
  [/\bUTC\b|\bGMT\b|格林尼治/i, () => 0],
  [/东京时间|日本时间|\bJST\b/i, () => 9],
  [/北京时间|\bCST\b/i, () => 8]
];

const PERIODS = [
  ['凌晨', 0, 5, 3], ['早上', 6, 11, 9], ['早晨', 6, 11, 9], ['上午', 6, 12, 9], ['中午', 11, 13, 12],
  ['下午', 13, 18, 14], ['傍晚', 17, 19, 18], ['晚上', 19, 23, 20], ['今晚', 19, 23, 20], ['明晚', 19, 23, 20], ['明早', 6, 11, 9], ['夜里', 21, 23, 22], ['晚', 19, 23, 20]
];

function parse(input, anchor = Date.now(), opts = {}) {
  const anchorMs = anchor instanceof Date ? anchor.getTime() : Number(anchor);
  const workEnd = opts.workEndHour ?? 18;
  let raw = String(input || '');
  // 时区
  let off = opts.tzOffset ?? 8, zoneHit = null;
  for (const [re, fn] of ZONES) { const m = re.exec(raw); if (m) { off = fn(anchorMs); zoneHit = m[0]; break; } }
  const text = normalizeNumbers(raw).replace(/(\d{1,2})\s*(am|pm)\b/ig, (m, h, ap) => `${ap.toLowerCase() === 'pm' ? '下午' : '上午'}${h}点`);
  const A = W(anchorMs, off);
  let date = null, dateCert = null, idx = -1, matched = '';
  const hit = (m) => { if (idx < 0 || m.index < idx) idx = m.index; matched += m[0]; };
  let m, rrule = null, deadline = false, allDayHint = false;

  // ── 重复 ──
  if ((m = /每(?:个)?(?:周|星期|礼拜)([一二三四五六日天])/.exec(text))) {
    const wd = WD[m[1]]; rrule = `FREQ=WEEKLY;BYDAY=${BYDAY[wd]}`; hit(m);
    let diff = (wd - A.dow + 7) % 7; date = addDays(A, diff); dateCert = 'date';
  } else if ((m = /每(?:天|日)/.exec(text))) { rrule = 'FREQ=DAILY'; hit(m); date = { ...A }; dateCert = 'date'; }
  else if ((m = /每(?:个)?月\s*(\d{1,2})\s*[号日]/.exec(text))) {
    const d = Number(m[1]); rrule = `FREQ=MONTHLY;BYMONTHDAY=${d}`; hit(m);
    date = d >= A.d ? dateObj(A.y, A.M, d) : dateObj(A.y, A.M + 1 > 12 ? 1 : A.M + 1, d); if (A.M === 12 && d < A.d) date = dateObj(A.y + 1, 1, d); dateCert = 'date';
  }

  // ── 绝对日期 ──
  if (!date && (m = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/.exec(text))) { date = dateObj(+m[1], +m[2], +m[3]); dateCert = 'date'; hit(m); }
  if (!date && (m = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/.exec(text))) {
    let y = A.y; if (+m[1] < A.M - 6) y++; date = dateObj(y, +m[1], +m[2]); dateCert = 'date'; hit(m);
  }
  if (!date && (m = /(?<![\d:])(\d{1,2})\/(\d{1,2})(?![\d/])/.exec(text))) { let y = A.y; if (+m[1] < A.M - 6) y++; date = dateObj(y, +m[1], +m[2]); dateCert = 'date'; hit(m); }
  if (!date && (m = /(?<![\d月])(\d{1,2})\s*[号](?!码)/.exec(text))) {
    const d = +m[1]; date = d >= A.d ? dateObj(A.y, A.M, d) : (A.M === 12 ? dateObj(A.y + 1, 1, d) : dateObj(A.y, A.M + 1, d)); dateCert = 'date'; hit(m);
  }
  // ── 节假日 ──
  if (!date && (m = /(元旦|春节|清明|劳动节|五一|端午|中秋|国庆)?\s*(?:节|假期|长假)?\s*(前|后)/.exec(text)) && (m[1] || /节[前后]/.test(text))) {
    const hol = opts.holidays || HOLIDAYS_2026;
    let name = m[1] === '五一' ? '劳动节' : m[1];
    if (!name) { // 最近的节日
      const today = ymd(A); let best = null;
      for (const [k, [a, b]] of Object.entries(hol)) { if (m[2] === '后' && b < today && (!best || b > hol[best][1])) best = k; if (m[2] === '前' && a > today && (!best || a < hol[best][0])) best = k; }
      name = best;
    }
    if (name && hol[name]) {
      const [a, b] = hol[name];
      if (m[2] === '后') { let [y, M, d] = b.split('-').map(Number); let o = addDays(dateObj(y, M, d), 1); while (!isWorkday(o, opts)) o = addDays(o, 1); date = o; }
      else { let [y, M, d] = a.split('-').map(Number); let o = addDays(dateObj(y, M, d), -1); while (!isWorkday(o, opts)) o = addDays(o, -1); date = o; deadline = true; }
      dateCert = 'date'; hit(m);
    }
  }
  // ── 月底/月初/年底 ──
  if (!date && (m = /(下个?月|本月|这个月)?\s*(月底|月末|月初|年底|年末)/.exec(text))) {
    let y = A.y, M = A.M; if (m[1] && /下/.test(m[1])) { M++; if (M > 12) { M = 1; y++; } }
    if (/月初/.test(m[2])) { date = dateObj(y, M, 1); while (!isWorkday(date, opts)) date = addDays(date, 1); }
    else {
      if (/年/.test(m[2])) M = 12;
      date = addDays(dateObj(M === 12 ? y + 1 : y, M === 12 ? 1 : M + 1, 1), -1);
      while (!isWorkday(date, opts)) date = addDays(date, -1);
      deadline = true;
    }
    dateCert = 'date'; hit(m);
  }
  // ── 相对日 ──
  const REL = { 今天: 0, 今日: 0, 今晚: 0, 明天: 1, 明日: 1, 明早: 1, 明晚: 1, 后天: 2, 大后天: 3, 昨天: -1, 昨日: -1, 前天: -2 };
  if (!date && (m = /(大后天|今天|今日|今晚|明天|明日|明早|明晚|后天|昨天|昨日|前天)/.exec(text))) { date = addDays(A, REL[m[1]]); dateCert = 'date'; hit(m); }
  if (!date && (m = /(\d{1,3})\s*(天|周|个月)\s*(后|之后|以后)/.exec(text))) {
    const n = +m[1]; date = m[2] === '天' ? addDays(A, n) : m[2] === '周' ? addDays(A, n * 7) : dateObj(A.y, A.M + n, A.d); dateCert = 'date'; hit(m);
  }
  // ── 星期 ──
  if (!date && (m = /(下下|下个?|本|这个?|上个?)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天末])/.exec(text))) {
    const wd = WD[m[2]], p = m[1] || '';
    const monday = addDays(A, 1 - A.dow);
    let base;
    if (/^下下/.test(p)) base = addDays(monday, 14);
    else if (/^下/.test(p)) base = addDays(monday, 7);
    else if (/^上/.test(p)) base = addDays(monday, -7);
    else if (/^(本|这)/.test(p)) base = monday;
    else base = wd >= A.dow ? monday : addDays(monday, 7);
    date = addDays(base, wd - 1); dateCert = 'date'; hit(m);
    if (m[2] === '末') allDayHint = true;
  }

  // ── 时段 + 钟点 ──
  let period = null;
  for (const [name, lo, hi, def] of PERIODS) { const i = text.indexOf(name); if (i >= 0) { period = { name, lo, hi, def }; hit({ index: i, 0: name }); break; } }
  let h = null, mi = 0, timeCert = null, endH = null, endM = 0;
  const T = /(\d{1,2})\s*(?:[:点时])\s*(?:(一刻|1刻)|(三刻|3刻)|(半)|(\d{1,2})\s*分?)?/;
  const RG = /(\d{1,2})\s*(?:-|~|到|至)\s*(\d{1,2})\s*点/;
  if ((m = RG.exec(text)) && !(T.exec(text) && T.exec(text).index < m.index)) {
    h = +m[1]; endH = +m[2]; hit(m);
  } else if ((m = T.exec(text))) {
    h = +m[1]; mi = m[1 + 1] ? 15 : m[3] ? 45 : m[4] ? 30 : m[5] ? +m[5] : 0; hit(m);
    const rest = text.slice(m.index + m[0].length);
    const r = /^\s*(?:-|~|－|—|到|至)\s*(\d{1,2})\s*(?:[:点时])?\s*(?:(\d{1,2})|(半))?/.exec(rest);
    if (r) { endH = +r[1]; endM = r[2] ? +r[2] : r[3] ? 30 : 0; matched += r[0]; }
  }
  const adj = (hh) => {
    if (hh == null) return hh;
    if (period) { if (period.lo >= 12 && hh < 12) return hh + 12; if (period.name === '凌晨' && hh === 12) return 0; return hh; }
    return hh;
  };
  if (h != null) {
    if (period) { h = adj(h); timeCert = 'exact'; }
    else if (h >= 13 || h === 0) timeCert = 'exact';
    else if (h >= 1 && h <= 6) { h += 12; timeCert = 'approx'; }
    else timeCert = 'approx';
    if (endH != null) { endH = period ? adj(endH) : (endH < h % 12 + (h >= 12 ? 12 : 0) && endH < 12 ? endH + 12 : endH); if (endH <= h && endH + 12 <= 23) endH += 12; }
  } else if (period) { h = period.def; timeCert = 'approx'; }

  // ── 截止语义 ──
  if (/(之前|以前|截止|截至|\S前(?!天|台|端|面|往))/.test(text) && (date || h != null)) deadline = true;
  if (/下班前/.test(text)) { deadline = true; if (h == null) { h = workEnd; mi = 0; timeCert = 'approx'; } if (!date) { date = { ...A }; dateCert = 'date'; } }
  if (/\bEOD\b/i.test(text)) { deadline = true; if (!date) date = { ...A }; h = 23; mi = 59; timeCert = 'approx'; dateCert = 'date'; }

  if (!date && h == null) return [];
  if (!date) { // 只有钟点：今天，若已过则明天
    date = { ...A }; dateCert = 'date';
    if (toMs(A.y, A.M, A.d, h, mi, off) < anchorMs) date = addDays(A, 1);
  }
  let certainty;
  if (h == null) {
    if (deadline) { h = workEnd; mi = 0; certainty = 'date_only'; }
    else { h = 9; mi = 0; certainty = 'date_only'; }
  } else certainty = timeCert === 'exact' ? 'exact' : 'approx';
  const start = toMs(date.y, date.M, date.d, h, mi, off);
  const res = { text: matched || raw, index: Math.max(0, idx), start, certainty };
  if (endH != null) res.end = toMs(date.y, date.M, date.d, endH, endM, off);
  if (deadline) res.deadline = true;
  if (rrule) res.rrule = rrule;
  if (certainty === 'date_only' && !deadline) res.allDay = true;
  if (allDayHint) res.allDay = true;
  if (zoneHit) res.zone = zoneHit;
  return [res];
}

/** OCR 消息头（如“昨天 14:20”“10月11日 09:05”）→ 消息时间，作为后续相对时间锚点 */
function resolveAnchor(header, captureTs) {
  const r = parse(header, captureTs)[0];
  return r ? r.start : captureTs;
}

/** 便捷：Shanghai 墙钟字符串，用于测试与展示 */
function fmt(ms, off = 8) { const o = W(ms, off); return `${ymd(o)} ${String(o.h).padStart(2, '0')}:${String(o.m).padStart(2, '0')}`; }

/** 预筛：是否含时间词/承诺词（零成本） */
const TIME_RE = /今天|明天|后天|大后天|周[一二三四五六日天末]|星期.|礼拜.|下周|本周|月底|月初|\d+月\d+[日号]|\d{1,2}[:：点]\d{0,2}|[一二两三四五六七八九十]+点|上午|下午|晚上|中午|节[前后]|ASAP|EOD|deadline|截止|之前/i;
const COMMIT_RE = /我来|我会|我负责|回头发你|帮我|麻烦|请在|之前|截止|交付|提交|开会|会议|约个?|对一下|过一下|评审|同步一下|答应|记得|别忘/;
function prefilter(text) { const s = String(text || ''); return { has_time: TIME_RE.test(s), has_commit: COMMIT_RE.test(s) }; }

module.exports = { parse, resolveAnchor, fmt, prefilter, normalizeNumbers, isWorkday, HOLIDAYS_2026 };
