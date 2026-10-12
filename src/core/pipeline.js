/**
 * 统一流水线：activities → KB(documents/chunks) → 统一抽取（每批 ≤8 块一次调用）→ 分发到 KB / MEMORY / CALENDAR
 */
const store = require('../main/store');
const schema = require('./schema');
const budget = require('./budget');
const kb = require('../kb');
const memory = require('../memory');
const calendar = require('../calendar');
const zhtime = require('../calendar/zhtime');
const rules = require('../pipeline/rules');
const U = require('../common/util');

const BATCH = 8;
const PROMPT = `你是「知迹」的统一抽取器（UNIFIED_EXTRACT）。从以下资料块中一次性抽取：
1) entities：人物/项目/工具/组织/主题 {name,type,aliases[],chunk}
2) claims：关于实体的客观事实 {subject,predicate,object,quote,confidence,chunk}
3) memories：只关于"我"（用户本人）的偏好/习惯/技能/关系/个人事实/决策 {type,subject,predicate,object,text,quote,confidence,sensitive,chunk}
4) calendar：带时间的承诺/会议/截止/提醒 {kind,title,time_text,quote,change,direction,participants[],confidence,chunk}
规则：每条必须引用输入中的 chunk 键；quote 必须是原文片段；不确定就不输出；涉及密码/证件/健康/财务的内容 sensitive=true。
只输出 JSON 对象 {"entities":[],"claims":[],"memories":[],"calendar":[]}，不要 markdown。`;

let cfgGetter = () => ({});
function setConfigGetter(fn) { cfgGetter = fn; }

function knownEntities(limit = 200) {
  return store.all(`SELECT e.name, e.type, (SELECT group_concat(alias,'|') FROM entity_aliases a WHERE a.entity_id=e.id) al FROM entities e WHERE status='active' ORDER BY salience DESC LIMIT ?`, [limit]).map(r => ({ name: r.name, type: r.type, aliases: (r.al || '').split('|').filter(Boolean) }));
}

async function extractBatch(batch, cfg) {
  const items = batch.map((c, i) => ({ key: 'c' + i, text: c.text.slice(0, 1500), ts: c.observed_at, app: c.app }));
  const known = knownEntities(60);
  const ai = cfg?.ai || {};
  const canLLM = ai.baseUrl && ai.enabled !== false && cfg?.v23?.llmExtract !== false;
  const prompt = `${PROMPT}\n<known>${JSON.stringify(known.map(k => ({ name: k.name, type: k.type, aliases: k.aliases.slice(0, 4) })))}</known>\n<chunks>${JSON.stringify(items)}</chunks>`;
  const est = U.estTokens(prompt) + 600;
  let out = null; let mode = 'rules';
  if (canLLM && budget.allow('extract', cfg, est)) {
    try {
      const { chatCompletion, parseJsonLoose } = require('../ai/client');
      const r = await chatCompletion(cfg, [{ role: 'system', content: 'UNIFIED_EXTRACT' }, { role: 'user', content: prompt }], { purpose: 'extract', max_tokens: 1800, temperature: 0.1 });
      out = parseJsonLoose(r.content); mode = 'llm';
    } catch (e) { console.error('[pipeline] llm extract failed, fallback rules:', e.message); }
  }
  if (!out || typeof out !== 'object') { out = rules.extractChunks(items, known); mode = canLLM ? 'rules-fallback' : 'rules'; }
  return { out, items, mode };
}

/** 把抽取结果分发到三个子系统 */
function apply(batch, items, out) {
  const byKey = new Map(items.map((it, i) => [it.key, batch[i]]));
  const valid = new Set(batch.map(c => c.id));
  const res = { entities: 0, mentions: 0, claims: 0, memories: {}, calendar: {}, dropped: 0 };
  const chunkEnts = new Map();
  for (const e of out.entities || []) {
    const ch = byKey.get(e.chunk); if (!ch) { res.dropped++; continue; }
    const ent = kb.resolveEntity(e.name, e.type || 'topic'); if (!ent) continue;
    for (const a of e.aliases || []) kb.addAlias(ent.id, a, 'llm');
    kb.addMention(ent, ch, ch.observed_at); res.mentions++;
    (chunkEnts.get(ch.id) || chunkEnts.set(ch.id, new Set()).get(ch.id)).add(ent.id);
  }
  for (const [, set] of chunkEnts) { const ids = [...set]; for (const a of ids) for (const b of ids) if (a !== b) store.run(`INSERT INTO links (src,dst,kind,weight) VALUES (?,?,'co',1) ON CONFLICT(src,dst,kind) DO UPDATE SET weight=weight+1`, [a, b]); }
  for (const c of out.claims || []) {
    const ch = byKey.get(c.chunk); if (!ch || !c.predicate || !c.object) { res.dropped++; continue; }
    const ent = kb.resolveEntity(c.subject, 'project'); if (!ent) continue;
    kb.addMention(ent, ch, ch.observed_at);
    kb.upsertClaim(ent, c, { chunkId: ch.id, eventIds: JSON.parse(ch.event_ids || '[]'), ts: ch.observed_at }); res.claims++;
  }
  for (const m of out.memories || []) {
    const ch = byKey.get(m.chunk);
    const r = memory.ingest(m, { chunkId: ch?.id || m.chunk || null, validChunks: valid, eventIds: ch ? JSON.parse(ch.event_ids || '[]') : [], ts: ch?.observed_at, source: 'auto' });
    res.memories[r.op] = (res.memories[r.op] || 0) + 1;
  }
  for (const c of out.calendar || []) {
    const ch = byKey.get(c.chunk); if (!ch) { res.dropped++; continue; }
    // 时间由本地 zhtime 以 observed_at 为锚点重算（不信任模型给的时间戳）
    const anchor = ch.observed_at || Date.now();
    const t = zhtime.parse(c.time_text || c.quote || '', anchor);
    const pick = c.change ? t[t.length - 1] : t[0];
    const cand = { ...c, start: pick ? pick.start : (Number.isFinite(c.start) ? c.start : NaN), end: pick?.end || c.end || null, certainty: pick?.certainty || c.certainty, all_day: pick?.allDay || c.all_day, rrule: pick?.rrule || c.rrule };
    if (cand.kind === 'meeting' && !cand.end && Number.isFinite(cand.start)) cand.end = cand.start + 3600000;
    const r = calendar.ingest(cand, { chunkId: ch.id, eventIds: JSON.parse(ch.event_ids || '[]'), ts: ch.observed_at, app: ch.app, privacy: ch.privacy_level });
    res.calendar[r.op] = (res.calendar[r.op] || 0) + 1;
    if (r.op === 'ADD' && c.kind === 'meeting') for (const p of c.participants || []) { const e = kb.resolveEntity(p, 'person'); if (e) kb.maybePromote(e.id, '会议参与者'); }
  }
  return res;
}

let running = false;
/** 一次完整增量处理 */
async function run({ cfg = cfgGetter(), maxBatches = 50 } = {}) {
  if (running) return { skipped: true };
  running = true;
  const t0 = Date.now();
  try {
    schema.migrate();
    const ing = kb.ingestNew();
    const summary = { events: ing.events || 0, docs: ing.docs, newChunks: ing.chunks.length, batches: 0, modes: {}, applied: [] };
    for (let i = 0; i < maxBatches; i++) {
      const batch = store.all(`SELECT c.*, d.app, d.title FROM chunks c LEFT JOIN documents d ON d.id=c.doc_id WHERE c.extracted_at IS NULL AND c.privacy_level='full' ORDER BY c.observed_at LIMIT ?`, [BATCH]);
      if (!batch.length) break;
      // 预过滤标签：无时间/无实体线索的块仍抽取实体，标签供 LLM 关注
      for (const c of batch) { const pf = zhtime.prefilter(c.text); store.run(`UPDATE chunks SET tags=? WHERE id=?`, [JSON.stringify(pf), c.id]); }
      const { out, items, mode } = await extractBatch(batch, cfg);
      store.transaction(() => {
        summary.applied.push(apply(batch, items, out));
        const now = Date.now();
        for (const c of batch) store.run(`UPDATE chunks SET extracted_at=? WHERE id=?`, [now, c.id]);
      });
      summary.batches++; summary.modes[mode] = (summary.modes[mode] || 0) + 1;
    }
    summary.pages = kb.compileDirty();
    summary.ms = Date.now() - t0;
    U.kvSet('pipeline_last', { ts: Date.now(), ...summary, applied: undefined });
    return summary;
  } finally { running = false; }
}
function lastRun() { return U.kvGet('pipeline_last', null); }

module.exports = { run, apply, extractBatch, setConfigGetter, lastRun, PROMPT };
