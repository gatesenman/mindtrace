/**
 * 2.5 R2 · 从文档 / 网页正文落地 Wiki 与记忆
 * 引用活动 id，避免「用了 Word」这类空记忆。
 */
const dayjs = require('dayjs');
const { digest, KIND_CN } = require('./docDigest');
const { redactText } = require('../privacy/redact');
const rules = require('../pipeline/rules');

const GENERIC = /^(?:使用|打开|浏览|处理)了?\s*\S+$|用了\s*\S+\s*\d+\s*(?:分钟|小时)|相关的活动见于|有进展。?$/;
const DECIDE = /(?:决定|定了|拍板|确定|决议)([^。！!\n]{2,40})/;
const TODO = /(?:待办|TODO|需要|负责|截止|周五前|之前交|请在.{0,6}前)([^。！!\n]{2,40})/i;
const PREF = /(?:偏好|习惯用|倾向于|建议将?|推荐)([^。！!\n]{2,30})/;
const MAX_PAGES = 16;
const MAX_MEM = 20;
const QUOTE_MAX = 120;

function hm(ts) { return ts ? dayjs(ts).format('HH:mm') : ''; }
function slugify(prefix, name) {
  const s = String(name || '').replace(/[\\/:*?"<>|#\s]+/g, '-').replace(/\.+$/, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `${prefix}-${s || 'untitled'}`;
}
function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return [...t].length <= n ? t : [...t].slice(0, n - 1).join('') + '…';
}
function isGeneric(text) { return !text || GENERIC.test(String(text).trim()); }

function sessionLinks(d) {
  const ids = d.ids || [];
  const t = d.first ? dayjs(d.first).format('HH:mm') : '';
  const t2 = d.last && d.last !== d.first ? '–' + dayjs(d.last).format('HH:mm') : '';
  const label = [t + t2, d.app, d.name].filter(Boolean).join(' · ');
  return { ids, label, first: d.first || null };
}

function pageMarkdown(d, { day } = {}) {
  const kind = KIND_CN[d.kind] || d.kind;
  const link = sessionLinks(d);
  const quote = d.snippet ? clip(redactText(d.snippet), QUOTE_MAX) : '';
  const byline = [kind, d.app !== d.name ? d.app : '', d.project, day, (d.first ? hm(d.first) : '') + (d.last && d.last !== d.first ? '–' + hm(d.last) : '')].filter(Boolean).join(' · ');
  const lines = [
    `# ${d.name}`,
    '',
    byline,
    '',
    quote ? `> ${quote}` : '',
    '',
    d.path ? `路径：\`${d.path}\`` : '',
    d.url ? `链接：${d.url}` : '',
    '',
    link.ids.length ? `关联会话：${link.label}` : '',
    link.ids.length ? `活动：${link.ids.slice(0, 5).join(', ')}` : ''
  ].filter(x => x !== '');
  return lines.join('\n') + '\n';
}

function wikiKindOf(d) {
  if (d.kind === 'chat') return 'topic';
  if (d.kind === 'browser') return 'topic';
  if (d.kind === 'code' && d.project) return 'project';
  return 'document';
}

function pagesFromDigest(list, { day } = {}) {
  const pages = [];
  for (const d of list.slice(0, MAX_PAGES)) {
    if (!d.name) continue;
    const kind = wikiKindOf(d);
    const prefix = kind === 'project' ? 'proj' : kind === 'document' ? 'doc' : (d.kind === 'chat' ? 'chat' : 'page');
    const title = (kind === 'project' && d.project) ? d.project : d.name;
    pages.push({
      kind: kind === 'project' && d.project ? 'project' : kind,
      slug: slugify(prefix, title),
      title,
      body_md: pageMarkdown(d, { day }),
      backlinks: d.ids || [],
      source: { name: d.name, kind: d.kind, ids: d.ids || [], first: d.first, path: d.path, url: d.url }
    });
    if (d.project && kind !== 'project') {
      pages.push({
        kind: 'project',
        slug: slugify('proj', d.project),
        title: d.project,
        body_md: `# ${d.project}\n\n相关文档：${d.name}${day ? ` · ${day}` : ''}\n\n关联会话：${sessionLinks(d).label}\n`,
        backlinks: d.ids || []
      });
    }
  }
  return pages;
}

function pushMem(out, item) {
  if (!item || !item.text || isGeneric(item.text)) return;
  if (rules.SENSITIVE.test(item.text) || rules.SENSITIVE.test(item.quote || '')) return;
  const text = clip(redactText(item.text), 200);
  if (out.some(m => m.text === text)) return;
  out.push({ ...item, text, quote: item.quote ? clip(redactText(item.quote), QUOTE_MAX) : undefined });
}

function memoriesFromText(text, ctx) {
  const out = [];
  const src = String(text || '');
  if (!src.trim()) return out;
  for (const m of rules.extractMemories(src)) {
    pushMem(out, { type: m.type, text: m.text, subject: m.subject, predicate: m.predicate, object: m.object, quote: m.quote, confidence: m.confidence, ...ctx });
  }
  for (const c of rules.extractClaims(src, ctx.ts)) {
    pushMem(out, { type: 'fact_self', text: `${c.subject}的${c.predicate}是${c.object}`, subject: c.subject, predicate: c.predicate, object: c.object, quote: c.quote, confidence: c.confidence || 0.7, ...ctx });
  }
  for (const s of rules.sentences(src)) {
    let m;
    if ((m = DECIDE.exec(s)) && !/我(?:们)?(?:决定|定了|拍板)/.test(s)) {
      pushMem(out, { type: 'decision', text: clip(s, 120), predicate: '决定', object: m[1].trim(), quote: s, confidence: 0.8, ...ctx });
    }
    if ((m = TODO.exec(s))) {
      pushMem(out, { type: 'decision', text: clip(s, 120), predicate: '待办', object: m[1].trim(), quote: s, confidence: 0.7, ...ctx });
    }
    if ((m = PREF.exec(s))) {
      pushMem(out, { type: 'preference', text: clip(s, 120), predicate: '偏好', object: m[1].trim(), quote: s, confidence: 0.65, ...ctx });
    }
  }
  return out;
}

const RESPONSIBLE = /([\u4e00-\u9fa5]{2,3})(?:负责|来写|来做)/g;
const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤';
const STOP_NAME = new Set(['我们', '你们', '他们', '大家', '今天', '明天', '项目', '会议', '负责', '需要']);
function isPersonish(n) { return n && SURNAMES.includes(n[0]) && !STOP_NAME.has(n) && !/[的了是在有和与]/.test(n.slice(1)); }

function peoplePages(rows, { day, list } = {}) {
  const pages = [];
  const seen = new Set();
  const texts = (list || []).map(d => d.snippet).filter(Boolean).join('\n');
  const ents = rules.extractEntities(texts);
  RESPONSIBLE.lastIndex = 0; let rm;
  while ((rm = RESPONSIBLE.exec(texts))) if (isPersonish(rm[1])) ents.push({ name: rm[1], type: 'person' });
  for (const e of ents) {
    if (e.type !== 'person' || seen.has(e.name)) continue;
    seen.add(e.name);
    const ids = (list || []).filter(d => (d.snippet || '').includes(e.name)).flatMap(d => d.ids || []).slice(0, 8);
    pages.push({
      kind: 'person',
      slug: slugify('person', e.name),
      title: e.name,
      body_md: `# ${e.name}\n\n见于文档/会话摘录${day ? ` · ${day}` : ''}。\n\n关联活动：${ids.join(', ') || '—'}\n`,
      backlinks: ids
    });
  }
  return pages;
}

function build(rows, { day } = {}) {
  const list = digest(rows || [], { limit: 20 });
  const pages = [...pagesFromDigest(list, { day }), ...peoplePages(rows, { day, list })];
  const memories = [];
  for (const d of list) {
    const ctx = { eventIds: d.ids || [], ts: d.first || Date.now(), sourceName: d.name };
    for (const m of memoriesFromText(d.snippet || '', ctx)) {
      if (memories.length >= MAX_MEM) break;
      memories.push(m);
    }
  }
  return { pages, memories, docs: list };
}

function mergeBody(existing, next) {
  if (!existing) return next;
  const mark = (next || '').split('\n').find(l => l.startsWith('> ') || l.startsWith('关联会话'));
  if (mark && existing.includes(mark.slice(0, Math.min(24, mark.length)))) return existing;
  return String(existing).trim() + '\n\n## 证据\n\n' + next;
}

function apply(rows, { day, store: st } = {}) {
  const { pages, memories, docs } = build(rows, { day });
  const store = st || require('../main/store');
  const pageIds = [];
  for (const p of pages) {
    let body = p.body_md;
    try {
      const ex = store.get && store.get(`SELECT body_md FROM wiki_pages WHERE kind=? AND slug=?`, [p.kind, p.slug]);
      if (ex && ex.body_md) body = mergeBody(ex.body_md, p.body_md);
    } catch (_) {}
    if (typeof store.upsertWikiPage === 'function') pageIds.push(store.upsertWikiPage({ ...p, body_md: body }));
  }
  const memIds = [];
  for (const m of memories) {
    try {
      const memory = require('../memory');
      const r = memory.ingest({
        type: m.type, text: m.text, subject: m.subject || 'user', predicate: m.predicate, object: m.object,
        quote: m.quote, confidence: m.confidence || 0.7
      }, { source: 'content', eventIds: m.eventIds || [], ts: m.ts, chunkId: null });
      if (r && r.id) memIds.push(r.id);
    } catch (_) {
      if (typeof store.upsertMemory === 'function') {
        const id = store.upsertMemory({
          kind: m.type === 'fact_self' ? 'fact' : m.type,
          text: m.text, confidence: m.confidence || 0.7,
          evidence: (m.eventIds || []).concat(day ? [day] : [])
        });
        if (id) memIds.push(id);
      }
    }
  }
  return { pages, memories, docs, pageIds, memIds };
}

module.exports = {
  build, apply, pageMarkdown, memoriesFromText, isGeneric, slugify, mergeBody, GENERIC
};
