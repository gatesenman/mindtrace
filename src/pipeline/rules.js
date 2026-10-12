/**
 * 规则抽取器（无 LLM 回退 + mock LLM 共用）。纯函数，不依赖 Electron/DB。
 * 输入: chunks [{key, text, ts}], known [{name, type, aliases}]
 * 输出: UNIFIED_EXTRACT schema { entities:[], claims:[], memories:[], calendar:[] }
 */
const zhtime = require('../calendar/zhtime');

const TOOLS = ['Electron', 'React', 'Vue', 'SQLite', 'better-sqlite3', 'TypeScript', 'Python', 'Rust', 'Go', 'Node.js', 'VS Code', 'Cursor', 'Figma', 'Notion', 'Obsidian', 'Docker', 'Kubernetes', 'PostgreSQL', 'Redis', 'Git', 'GitHub', 'Vite', 'Webpack', 'DeepSeek', 'OpenAI', 'MCP'];
const PERSON_CUE = /(?:和|与|跟|找|给|@|联系|问|请|让|通知)([\u4e00-\u9fa5]{2,3}?)(?=(?:开|讨论|说|开会|确认|对一下|同步|聊|沟通|商量|评审|过一下|发|约|，|。|\s|$|的|一起|$))/g;
const PERSON_HEAD = /(?:^|[\s，。；：:])([\u4e00-\u9fa5]{2,3})(?:\(|（)([\u4e00-\u9fa5A-Za-z]{1,6})(?:\)|）)/g;
const PERSON_SAY = /([\u4e00-\u9fa5]{2,3})(?:说|提到|回复|表示|建议|：|:)/g;
const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤';
const STOP = new Set(['我们', '你们', '他们', '大家', '今天', '明天', '后天', '下午', '上午', '晚上', '这个', '那个', '项目', '会议', '一下', '同事', '老板', '客户', '自己', '一起', '张三丰']);
const LATIN_NAME = /\b([A-Z][a-z]{1,10} [A-Z][a-z]{1,10})\b/g;
const PROJECT = /(?:项目|产品)\s*[「《“"]?([\u4e00-\u9fa5A-Za-z0-9 ]{2,16}?)[」》”"]|[「《]([^」》]{2,16})[」》]/g;

function isPersonish(n) { return n && SURNAMES.includes(n[0]) && !STOP.has(n) && !/[的了是在有和与]/.test(n.slice(1)); }

function sentences(text) { return String(text || '').split(/(?<=[。！？!?；;\n])/).map(s => s.trim()).filter(Boolean); }

function extractEntities(text, known = []) {
  const out = new Map();
  const add = (name, type, alias) => {
    name = String(name).trim(); if (!name || name.length < 2) return;
    const k = name.toLowerCase();
    if (!out.has(k)) out.set(k, { name, type, aliases: alias ? [alias] : [] });
    else if (alias && !out.get(k).aliases.includes(alias)) out.get(k).aliases.push(alias);
  };
  for (const k of known) {
    for (const a of [k.name, ...(k.aliases || [])]) if (a && a.length >= 2 && text.toLowerCase().includes(a.toLowerCase())) { add(a, k.type); break; }
  }
  let m;
  for (const re of [PERSON_CUE, PERSON_SAY]) { re.lastIndex = 0; while ((m = re.exec(text))) if (isPersonish(m[1])) add(m[1], 'person'); }
  PERSON_HEAD.lastIndex = 0; while ((m = PERSON_HEAD.exec(text))) if (isPersonish(m[1])) add(m[1] + '(' + m[2] + ')', 'person');
  LATIN_NAME.lastIndex = 0; while ((m = LATIN_NAME.exec(text))) { if (!TOOLS.includes(m[1])) add(m[1], 'person'); }
  PROJECT.lastIndex = 0; while ((m = PROJECT.exec(text))) add((m[1] || m[2]).trim(), 'project');
  for (const t of TOOLS) if (new RegExp('(^|[^A-Za-z])' + t.replace(/[.+]/g, '\\$&') + '([^A-Za-z]|$)').test(text)) add(t, 'tool');
  return [...out.values()];
}

const CLAIM_RE = /([\u4e00-\u9fa5A-Za-z0-9]{2,16}?)(?:的)?(发布日期|发布时间|上线时间|上线日期|截止日期|负责人|技术栈|版本号|预算)\s*(?:是|为|定在|定于|改到|改为|:|：)\s*([^\s，。,;；]{1,30})/g;
const CLAIM_RE2 = /([\u4e00-\u9fa5A-Za-z0-9]{2,16}?)\s*(?:计划|预计|将|定于|定在)\s*(\d{1,2}\s*月\s*\d{1,2}\s*[日号])\s*(发布|上线)/g;
function extractClaims(text, ts) {
  const out = []; let m;
  const normDate = (s) => { const r = zhtime.parse(s, ts)[0]; return r ? zhtime.fmt(r.start).slice(0, 10) : s; };
  CLAIM_RE.lastIndex = 0;
  while ((m = CLAIM_RE.exec(text))) {
    let pred = m[2].replace('时间', '日期').replace('上线日期', '发布日期');
    const obj = /日期/.test(pred) ? normDate(m[3]) : m[3];
    out.push({ subject: m[1].split(/了|和|与|跟|说|：|:|，|讨论/).pop().replace(/^(项目|产品)/, '') || m[1], predicate: pred, object: obj, quote: m[0], confidence: 0.75 });
  }
  CLAIM_RE2.lastIndex = 0;
  while ((m = CLAIM_RE2.exec(text))) out.push({ subject: m[1], predicate: '发布日期', object: normDate(m[2]), quote: m[0], confidence: 0.7 });
  return out;
}

const MEM_RULES = [
  [/我(?:比较|更|一直)?(?:喜欢|偏好|倾向于?|更爱)(?:用)?([^。！!，,\n]{2,30})/, 'preference', '偏好'],
  [/我(?:习惯|通常|一般|每天都?)([^。！!，,\n]{2,30})/, 'habit', '习惯'],
  [/我(?:们)?(?:决定|定了|拍板)([^。！!\n]{2,40})/, 'decision', '决定'],
  [/我(?:是|作为)(?:一名|一个)?([^。！!，,\n]{2,20}?)(?:工程师|开发|设计师|产品经理|经理|研究员)/, 'fact_self', '职业', (m) => m[0].replace(/^我(?:是|作为)(?:一名|一个)?/, '')],
  [/我(?:正在|在)学(?:习)?([^。！!，,\n]{2,15})/, 'skill', '在学'],
  [/(?:我的)?主力语言(?:是|为|改为|换成|改成)\s*([A-Za-z+#]+|[\u4e00-\u9fa5]{2,6})/, 'fact_self', '主力语言'],
  [/(?:我)?(?:改用|转向|换成|切换到)\s*([A-Za-z+#]{2,15})\s*(?:作为主力|做主力|当主力)/, 'fact_self', '主力语言'],
  [/([\u4e00-\u9fa5]{2,3})是我的(同事|合作方|老板|上级|客户|朋友|导师|下属)/, 'relationship', null]
];
const SENSITIVE = /(\d{17}[\dXx])|((?:\d[ -]?){16,19})|(密码|口令|验证码)\s*[:：是为]?\s*\S{4,}|sk-[A-Za-z0-9]{16,}|病历|诊断为|银行卡/;
function extractMemories(text) {
  const out = [];
  for (const s of sentences(text)) {
    if (!/我|主力语言/.test(s)) continue;
    for (const [re, type, pred, objFn] of MEM_RULES) {
      const m = re.exec(s); if (!m) continue;
      if (type === 'relationship') { out.push({ type, subject: m[1], predicate: m[2], object: m[2], text: `${m[1]}是我的${m[2]}`, quote: s, confidence: 0.7, sensitive: false }); continue; }
      const obj = (objFn ? objFn(m) : m[1]).trim().replace(/[。.!！]$/, '');
      out.push({ type, subject: 'user', predicate: pred, object: obj, text: s.replace(/[。！!]$/, ''), quote: s, confidence: type === 'decision' || /改用|换成|改为|改成|转向|切换/.test(s) ? 0.85 : 0.75, sensitive: SENSITIVE.test(s) });
    }
  }
  return out;
}

const MEETING_W = /会议|开会|评审|站会|周会|例会|面试|约了|会面|call|沟通会|复盘会|同步会/i;
function extractCalendar(text, ts, people = []) {
  const out = [];
  for (const s of sentences(text)) {
    const pf = zhtime.prefilter(s);
    if (!pf.has_time) continue;
    const isMeeting = MEETING_W.test(s);
    const change = /改到|改成|推迟到|延期到|提前到|挪到|顺延/.test(s);
    if (!pf.has_commit && !isMeeting && !change && !/截止|之前|前交|deadline|ddl|提醒/i.test(s)) continue;
    const times = zhtime.parse(s, ts);
    if (!times.length) continue;
    const t = change ? times[times.length - 1] : times[0];
    const kind = isMeeting ? 'meeting' : (/截止|之前|deadline|ddl/i.test(s) || s.includes(t.text + '前')) ? 'deadline' : /提醒/.test(s) ? 'reminder' : 'todo';
    const direction = /我来|我会|我负责|我去|我这边|我明天|我今晚/.test(s) ? 'mine' : /帮我|麻烦你|请你|你来/.test(s) ? 'theirs' : 'mine';
    let title = s;
    for (const x of times) title = title.replace(x.text, '');
    title = title.replace(/^(好的?|嗯|那|我们|我来|我会|麻烦|请|帮我|记得)[，,\s]*/g, '').replace(/^(之?前|以前)/, '').replace(/[。！!？?，,；;：:\s]+$/g, '').replace(/改到|改成|推迟到|延期到|提前到|挪到/, '').trim().slice(0, 30) || '待办事项';
    out.push({
      kind, title, quote: s, start: t.start, end: t.end || (kind === 'meeting' ? t.start + 3600000 : null),
      time_text: t.text, certainty: t.certainty, all_day: !!t.allDay, rrule: t.rrule || null, change, direction,
      participants: people.filter(p => s.includes(p)), confidence: t.certainty === 'exact' ? 0.85 : 0.65
    });
  }
  return out;
}

function extractChunks(chunks, known = []) {
  const res = { entities: [], claims: [], memories: [], calendar: [] };
  for (const c of chunks) {
    const ents = extractEntities(c.text, known);
    for (const e of ents) res.entities.push({ ...e, chunk: c.key });
    for (const cl of extractClaims(c.text, c.ts)) res.claims.push({ ...cl, chunk: c.key });
    for (const m of extractMemories(c.text)) res.memories.push({ ...m, chunk: c.key });
    const people = ents.filter(e => e.type === 'person').map(e => e.name.replace(/[（(].*$/, ''));
    for (const k of extractCalendar(c.text, c.ts, people)) res.calendar.push({ ...k, chunk: c.key });
  }
  return res;
}

/** mock 服务器用：解析 prompt 中的 <chunks> JSON */
function answerPrompt(promptText) {
  const m = /<chunks>([\s\S]*?)<\/chunks>/.exec(promptText);
  const k = /<known>([\s\S]*?)<\/known>/.exec(promptText);
  let chunks = []; let known = [];
  try { chunks = JSON.parse(m[1]); } catch (_) {}
  try { known = JSON.parse(k[1]); } catch (_) {}
  return extractChunks(chunks, known);
}

module.exports = { extractChunks, extractEntities, extractClaims, extractMemories, extractCalendar, answerPrompt, SENSITIVE, TOOLS, sentences };
