const dayjs = require('dayjs');
function defaultStore() { return require('../main/store'); }
const prompts = require('./prompts');
const { chatCompletion, parseJsonLoose } = require('./client');
const { redactText } = require('../privacy/redact');
const { isSelfApp } = require('../main/appNames');

const PROMPT_MAX_CHARS = 8000;

function formatActivities(rows, limit = 80, opts = {}) {
  // 2.3.2：先去噪（任务切换/过短窗口/过短复制/仅窗口名），不浪费 token
  try { rows = require('../core/noise').filter(rows, { hideLow: true }); } catch (_) {}
  const clean = rows.filter(a => !isSelfApp({ app: a.app_name, process: a.process_name, title: a.window_title }));
  const ss = require('../content/sessionSummary');
  const head = ss.promptBlock(clean);
  const maxChars = opts.maxChars != null ? opts.maxChars : PROMPT_MAX_CHARS;
  const budget = Math.max(0, maxChars - head.length);
  const lines = [];
  let used = 0;
  for (const a of clean.slice(0, limit)) {
    const line = ss.eventLine(a);
    if (used + line.length + 1 > budget && lines.length) break;
    lines.push(line);
    used += line.length + 1;
  }
  return (head + lines.join('\n')).slice(0, maxChars);
}

/** 2.4.8 / 2.5：先给模型一份「今天处理了哪些文档/页面/会话 + 内容片段」，再给事件抽样 */
function docSection(acts) {
  try {
    let rows = acts; try { rows = require('../core/noise').filter(acts, { hideLow: false }); } catch (_) {}
    return require('../content/sessionSummary').promptBlock(rows);
  } catch (_) { return ''; }
}

async function buildDailyJournal(cfg, dateStr) {
  const store = defaultStore();
  const day = dayjs(dateStr || undefined);
  const from = day.startOf('day').valueOf();
  const to = day.endOf('day').valueOf();
  const acts = store.all(
    `SELECT * FROM activities WHERE started_at>=? AND started_at<=? ORDER BY started_at ASC LIMIT 1500`,
    [from, to]
  );
  const stats = store.getTodayStats();
  if (!acts.length) {
    return { title: `${day.format('YYYY-MM-DD')} 暂无活动`, summary: '当日没有采集到活动数据。', highlights: [] };
  }
  const { content } = await chatCompletion(cfg, [
    { role: 'system', content: prompts.systemKnowledge },
    { role: 'user', content: prompts.dailyJournal(day.format('YYYY-MM-DD'), stats, formatActivities(acts)) }
  ]);
  const parsed = parseJsonLoose(content) || { title: day.format('YYYY-MM-DD'), summary: content, highlights: [] };
  store.upsertJournal({
    period: 'daily',
    period_key: day.format('YYYY-MM-DD'),
    title: parsed.title,
    content: parsed.summary || content,
    highlights: parsed.highlights || [],
    stats: { ...stats, topics: parsed.topics, todos: parsed.todos, learnings: parsed.learnings, people: parsed.people, links: parsed.links }
  });
  // also create cards
  if (Array.isArray(parsed.learnings)) {
    for (const l of parsed.learnings) {
      store.upsertKnowledgeCard({ kind: 'learning', title: String(l).slice(0, 80), summary: String(l) });
    }
  }
  if (Array.isArray(parsed.todos)) {
    for (const t of parsed.todos) {
      store.upsertKnowledgeCard({ kind: 'todo', title: String(t).slice(0, 80), summary: String(t) });
    }
  }
  if (Array.isArray(parsed.people)) {
    for (const p of parsed.people) {
      store.upsertKnowledgeCard({ kind: 'person', title: String(p).slice(0, 80), summary: `相关人物：${p}` });
    }
  }
  if (Array.isArray(parsed.links)) {
    for (const l of parsed.links) {
      store.upsertKnowledgeCard({ kind: 'link', title: l.title || l.url || '链接', summary: l.url || '', links: [l] });
    }
  }
  if (Array.isArray(parsed.topics)) {
    for (const t of parsed.topics) {
      store.upsertKnowledgeCard({ kind: 'project', title: String(t).slice(0, 80), summary: `主题/项目：${t}` });
    }
  }
  return parsed;
}

async function extractCardsFromRecent(cfg, hours = 6) {
  const store = defaultStore();
  const from = Date.now() - hours * 3600 * 1000;
  const acts = store.all(`SELECT * FROM activities WHERE started_at>=? ORDER BY started_at DESC LIMIT 150`, [from]);
  if (!acts.length) return [];
  const { content } = await chatCompletion(cfg, [
    { role: 'system', content: prompts.systemKnowledge },
    { role: 'user', content: prompts.knowledgeCards(formatActivities(acts)) }
  ]);
  const parsed = parseJsonLoose(content) || [];
  const list = Array.isArray(parsed) ? parsed : (parsed.cards || []);
  const ids = [];
  for (const c of list) {
    if (!c.title) continue;
    ids.push(store.upsertKnowledgeCard({
      kind: c.kind || 'note',
      title: String(c.title).slice(0, 120),
      summary: c.summary || '',
      tags: c.tags || [],
      importance: c.importance || 3
    }));
  }
  return ids;
}

async function askHistory(cfg, question) {
  const store = defaultStore();
  const q = question.trim();
  const acts = store.searchActivities({ q, limit: 40 });
  const cards = store.all(
    `SELECT * FROM knowledge_cards WHERE title LIKE ? OR summary LIKE ? OR content LIKE ? ORDER BY updated_at DESC LIMIT 20`,
    [`%${q}%`, `%${q}%`, `%${q}%`]
  );
  const journals = store.all(
    `SELECT * FROM journals WHERE title LIKE ? OR content LIKE ? ORDER BY created_at DESC LIMIT 5`,
    [`%${q}%`, `%${q}%`]
  );
  const recent = (acts.length ? acts : store.all(`SELECT * FROM activities ORDER BY started_at DESC LIMIT 80`))
    .filter(a => !isSelfApp({ app: a.app_name, process: a.process_name, title: a.window_title }))
    .slice(0, 40);

  const citationIndex = {};
  const actLines = recent.map((a, i) => {
    const key = `E${i + 1}`;
    citationIndex[key] = {
      key, kind: 'activity', id: a.id, type: a.type,
      label: `${a.app_name || ''} ${a.window_title || a.url || ''}`.trim().slice(0, 80),
      started_at: a.started_at, url: a.url || null, file_path: a.file_path || null
    };
    const t = dayjs(a.started_at).format('HH:mm');
    const snippet = a.content ? redactText(String(a.content).slice(0, 100).replace(/\s+/g, ' ')) : '';
    return `[${key}] ${t} ${a.type} | ${a.app_name || ''} | ${a.window_title || ''} | ${a.url || a.file_path || ''} | ${snippet}`;
  });
  const cardLines = cards.map((c, i) => {
    const key = `C${i + 1}`;
    citationIndex[key] = { key, kind: 'card', id: c.id, type: c.kind, label: c.title, summary: c.summary };
    return `[${key}] [${c.kind}] ${c.title}: ${c.summary || ''}`;
  });
  const journalLines = journals.map((j, i) => {
    const key = `J${i + 1}`;
    citationIndex[key] = { key, kind: 'journal', id: j.id, type: 'daily', label: `${j.period_key} ${j.title || ''}`, period_key: j.period_key };
    return `[${key}] ${j.period_key} ${j.title}: ${(j.content || '').slice(0, 200)}`;
  });

  const context = [
    '## 知识卡片', ...cardLines,
    '## 日刊', ...journalLines,
    '## 活动（时间线）', ...actLines
  ].join('\n');

  store.addChatMessage('user', q);
  const { content } = await chatCompletion(cfg, [
    { role: 'system', content: prompts.systemKnowledge },
    { role: 'user', content: prompts.chatWithHistory(q, context) }
  ], { max_tokens: 2500 });

  let answer = content;
  let used = [];
  const m = content.match(/CITATIONS:\s*([^\n]+)/i);
  if (m) {
    answer = content.replace(/\n?CITATIONS:\s*[^\n]+/i, '').trim();
    const raw = m[1].trim();
    if (!/^none$/i.test(raw)) {
      used = raw.split(/[,，\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean)
        .map(k => citationIndex[k] || citationIndex[k.replace(/^\[|\]$/g, '')])
        .filter(Boolean);
    }
  }
  // fallback: collect markers appearing in answer
  if (!used.length) {
    const found = [...answer.matchAll(/\[([ECJ]\d+)\]/g)].map(x => x[1].toUpperCase());
    used = [...new Set(found)].map(k => citationIndex[k]).filter(Boolean);
  }
  store.addChatMessage('assistant', answer, used);
  return { answer, citations: used };
}

function buildClusterPayload(cards, acts, { max = 12000 } = {}) {
  const { redactText } = require('../privacy/redact');
  const { redactUrl } = require('../content/sessionSummary');
  const cleanCards = (cards || []).map(c => ({
    id: c.id, title: redactText(String(c.title || '')), kind: c.kind,
    summary: redactText(String(c.summary || '')).slice(0, 200),
    tags: c.tags || []
  }));
  const cleanActs = (acts || []).map(a => ({
    app_name: a.app_name, process_name: a.process_name, type: a.type,
    window_title: a.window_title,
    content: a.content ? redactText(String(a.content).slice(0, 160)) : '',
    started_at: a.started_at, ended_at: a.ended_at, duration_ms: a.duration_ms,
    url: a.url ? redactUrl(a.url) : undefined
  }));
  return JSON.stringify({ cards: cleanCards, activities: cleanActs }, null, 0).slice(0, max);
}

async function clusterTopics(cfg) {
  const store = defaultStore();
  const cards = store.all(`SELECT id, title, kind, summary, tags FROM knowledge_cards ORDER BY updated_at DESC LIMIT 80`);
  const acts = require('../core/noise').filter(store.all(`SELECT app_name, process_name, window_title, type, content, started_at, ended_at, duration_ms, url FROM activities ORDER BY started_at DESC LIMIT 240`)).slice(0, 80);
  if (!cards.length && !acts.length) return [];
  const payload = buildClusterPayload(cards, acts, { max: 12000 });
  const { content } = await chatCompletion(cfg, [
    { role: 'system', content: prompts.systemKnowledge },
    { role: 'user', content: prompts.clusterTopics(payload) }
  ], { max_tokens: 2000 });
  const parsed = parseJsonLoose(content) || [];
  const list = Array.isArray(parsed) ? parsed : [];
  const ids = [];
  for (const t of list) {
    if (!t.name) continue;
    const related = cards.filter(c => (t.cardTitles || []).some(n => String(c.title).includes(String(n)) || String(n).includes(String(c.title))));
    ids.push(store.upsertTopic({
      name: String(t.name).slice(0, 80),
      summary: t.summary || '',
      card_ids: related.map(c => c.id || c.title),
      activity_count: acts.length,
      last_seen: Date.now()
    }));
  }
  return ids;
}

async function maybeAutoSummarize(cfg) {
  if (!cfg.ai?.autoSummarize || !cfg.ai?.apiKey && !String(cfg.ai?.baseUrl || '').includes('11434')) return;
  try {
    await extractCardsFromRecent(cfg, 2);
  } catch (e) {
    console.error('autoSummarize', e.message);
  }
}

module.exports = { docSection, buildDailyJournal, extractCardsFromRecent, askHistory, clusterTopics, maybeAutoSummarize, formatActivities, buildClusterPayload, PROMPT_MAX_CHARS };
