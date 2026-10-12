/**
 * v2.3 示例数据：写入带 isDemo 标记的活动 → 走真实流水线（规则抽取）→ 记录派生对象 id 以便标注「示例」与清除
 */
const store = require('../main/store');
const U = require('../common/util');
const TABLES = ['documents', 'chunks', 'entities', 'claims', 'memories', 'calendar_events', 'wiki_pages', 'episodes', 'merge_suggestions'];
const snap = () => Object.fromEntries(TABLES.map(t => [t, new Set(store.all(`SELECT id FROM ${t}`).map(r => r.id))]));

function script(now) {
  const H = 3600e3, M = 60e3, D = 86400e3;
  const day0 = (() => { const d = new Date(now + 8 * H); d.setUTCHours(0, 0, 0, 0); return d.getTime() - 8 * H; })();
  const at = (dd, h, m = 0) => day0 - dd * D + h * H + m * M;
  const A = [];
  const add = (ts, app, title, text, extra = {}) => A.push({ type: extra.type || (extra.url ? 'browser' : 'document'), started_at: ts, duration_ms: extra.dur || 5 * M, app_name: app, window_title: title, url: extra.url, file_path: extra.file, content: text, meta: { isDemo: true } });
  // 三天前 —— 项目启动
  add(at(3, 10), '飞书', '知迹 2.3 立项', '「知迹 2.3」立项会纪要：目标是把电脑上的一切沉淀为知识库、记忆与日历。和张三讨论了技术方案，李四负责交互设计。');
  add(at(3, 11), 'Notion', '知迹 2.3 计划', '知迹 2.3的发布日期是10月28日。知迹 2.3的负责人是张三。知迹 2.3的技术栈是Electron+better-sqlite3+FTS5。');
  add(at(3, 15), 'Chrome', 'SQLite FTS5 文档', 'SQLite FTS5 全文检索扩展：支持 bm25 排序、unicode61 分词器、前缀查询与 snippet 高亮函数。中文需要自行做 bigram 预分词。', { url: 'https://www.sqlite.org/fts5.html?utm_source=demo' });
  add(at(3, 16), 'Notepad', '个人笔记', '我习惯先写测试再写实现，这样重构更安心。我偏好在上午处理需要深度专注的编码任务。');
  // 两天前
  add(at(2, 9, 30), '微信', '张三', 'Zhang San 说 Windows 安装包的签名证书已经续期，周五前提交安装包冒烟测试报告。');
  add(at(2, 14), 'Outlook', '会议邀请：交互评审', '邀请：后天下午2点和李四开交互评审会，议题：日历页的计划/实际双轨。');
  add(at(2, 16), 'Notion', '技术选型', '我的主力语言是 Python，平时写数据处理脚本。我决定 2.3 版本先用模板编译实体页，LLM 增量编译放到下个版本。');
  add(at(2, 17), 'VS Code', 'zhtime.js - mindtrace', '中文时间解析器 zhtime：支持「明天下午3点」「下周一」「三点一刻」「10月20号下午2-4点」等表达，含 2026 国庆调休。', { file: 'D:/code/mindtrace/src/calendar/zhtime.js', type: 'ide' });
  // 昨天
  add(at(1, 10), '飞书', '产品群', '，张三(产品)：评审材料已上传到共享盘，请大家提前阅读并准备问题。');
  add(at(1, 11), 'Notion', '「知迹 2.3」周报', '「知迹 2.3」本周完成统一抽取与实体解析，KB-01..16 验收用例全部通过。');
  add(at(1, 15), '微信', '市场群', '知迹 2.3的发布日期是11月3日，渠道审核需要额外时间。');
  add(at(1, 16), 'Notepad', '技术选型', '最近我改用 TypeScript 作为主力语言，类型系统对大型重构很有帮助。王芳是我的同事，负责测试平台。');
  add(at(1, 20), '微信', '李磊磊', '和李磊磊确认了下周的用户访谈安排，共约了 6 位用户。');
  // 今天
  add(at(0, 9), 'Chrome', 'RFC 5545 iCalendar', 'iCalendar 规范：VEVENT、VTODO、VALARM、RRULE 重复规则与时区 VTIMEZONE 的定义。', { url: 'https://datatracker.ietf.org/doc/html/rfc5545#section-3.6' });
  add(at(0, 9, 40), '微信', '李雷雷', '和李雷雷讨论了访谈提纲，明天上午10点在会议室过一遍。');
  add(at(0, 10, 5), '钉钉', '每日站会', '每天上午9点半站会，同步进度与风险。我来今晚8点前把 2.3 发布说明初稿发给张三。');
  add(at(0, 11), '微信', '李四', '和李四的交互评审会改到周五下午3点。');
  add(at(0, 14), 'Notepad', '待办', '提醒我明天下午4点给王芳回复测试平台的接入方案。');
  // 实际轨：会议窗口 + 编码 + 浏览
  for (let i = 0; i < 9; i++) A.push({ type: 'window', started_at: at(0, 10) + i * 4 * M, duration_ms: 4 * M, app_name: '腾讯会议', window_title: '腾讯会议 - 知迹 2.3 周会', meta: { isDemo: true } });
  for (let i = 0; i < 12; i++) A.push({ type: 'window', started_at: at(0, 13) + i * 5 * M, duration_ms: 5 * M, app_name: 'Code', window_title: 'pipeline.js - mindtrace - Visual Studio Code', meta: { isDemo: true } });
  for (let i = 0; i < 6; i++) A.push({ type: 'window', started_at: at(0, 15) + i * 5 * M, duration_ms: 5 * M, app_name: 'Chrome', window_title: 'RFC 5545 - Google Chrome', meta: { isDemo: true } });
  for (let i = 0; i < 8; i++) A.push({ type: 'window', started_at: at(1, 14) + i * 5 * M, duration_ms: 5 * M, app_name: 'Code', window_title: 'store.js - mindtrace - Visual Studio Code', meta: { isDemo: true } });
  return { A, at };
}

async function seed(now = Date.now()) {
  require('./schema').migrate();
  clear();
  const before = snap();
  const { A, at } = script(now);
  store.transaction(() => { for (const a of A) store.insertActivity(a); });
  await require('./pipeline').run({ cfg: { ai: {} } });
  const cal = require('../calendar');
  cal.create({ kind: 'focus', title: '专注：实现日历页', start_at: at(0, 13), end_at: at(0, 15), status: 'confirmed' });
  cal.create({ kind: 'meeting', title: '知迹 2.3 周会', start_at: at(0, 10), end_at: at(0, 10, 30), status: 'confirmed', participants: ['张三', '李四'] });
  cal.create({ kind: 'deadline', title: '2.3 发布候选版冻结', start_at: at(-3, 18), status: 'confirmed', all_day: 0 });
  cal.create({ kind: 'todo', title: '整理用户访谈纪要', start_at: at(-1, 17), status: 'confirmed' });
  require('../calendar/blocks').buildEpisodes(at(3, 0), now + 86400e3);
  const after = snap();
  const ids = {};
  for (const t of TABLES) ids[t] = [...after[t]].filter(x => !before[t].has(x));
  U.kvSet('demo_v23', ids); cache = null;
  return Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, v.length]));
}
function ids() { return U.kvGet('demo_v23', {}) || {}; }
let cache = null;
function isDemo(table, id) { if (!cache) { cache = {}; for (const [t, v] of Object.entries(ids())) cache[t] = new Set(v); } return !!cache[table]?.has(id); }
function clear() {
  const all = ids();
  store.transaction(() => {
    for (const [t, list] of Object.entries(all)) for (const id of list || []) {
      try {
        if (t === 'chunks') { const r = store.get(`SELECT rowid FROM chunks WHERE id=?`, [id]); if (r) try { store.run(`DELETE FROM chunks_fts WHERE rowid=?`, [r.rowid]); } catch (_) {} store.run(`DELETE FROM mentions WHERE chunk_id=?`, [id]); }
        if (t === 'entities') { store.run(`DELETE FROM entity_aliases WHERE entity_id=?`, [id]); store.run(`DELETE FROM mentions WHERE entity_id=?`, [id]); store.run(`DELETE FROM links WHERE src=? OR dst=?`, [id, id]); }
        if (t === 'wiki_pages') store.run(`DELETE FROM page_revisions WHERE page_id=?`, [id]);
        const ot = { claims: 'claim', memories: 'memory', calendar_events: 'calendar' }[t];
        if (ot) store.run(`DELETE FROM evidence WHERE owner_type=? AND owner_id=?`, [ot, id]);
        store.run(`DELETE FROM ${t} WHERE id=?`, [id]);
      } catch (_) {}
    }
  });
  U.kvSet('demo_v23', {}); cache = null;
}
module.exports = { seed, clear, isDemo, ids };
