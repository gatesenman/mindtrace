const dayjs = require('dayjs');
const store = require('../main/store');
const prompts = require('./prompts');
const { chatCompletion, parseJsonLoose } = require('./client');

function formatActivities(rows, limit = 80) {
  return rows.slice(0, limit).map(a => {
    const t = dayjs(a.started_at).format('HH:mm');
    const dur = a.duration_ms ? `${Math.round(a.duration_ms / 60000)}分钟` : '';
    const parts = [t, a.type, a.app_name, a.window_title, a.url, a.file_path];
    if (a.content) parts.push(String(a.content).slice(0, 120).replace(/\s+/g, ' '));
    if (dur) parts.push(dur);
    return parts.filter(Boolean).join(' | ');
  }).join('\n');
}

async function buildDailyJournal(cfg, dateStr) {
  const day = dayjs(dateStr || undefined);
  const from = day.startOf('day').valueOf();
  const to = day.endOf('day').valueOf();
  const acts = store.all(
    `SELECT * FROM activities WHERE started_at>=? AND started_at<=? ORDER BY started_at ASC LIMIT 300`,
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
  const q = question.trim();
  // naive retrieval
  const acts = store.searchActivities({ q, limit: 40 });
  const cards = store.all(
    `SELECT * FROM knowledge_cards WHERE title LIKE ? OR summary LIKE ? OR content LIKE ? ORDER BY updated_at DESC LIMIT 20`,
    [`%${q}%`, `%${q}%`, `%${q}%`]
  );
  const journals = store.all(
    `SELECT * FROM journals WHERE title LIKE ? OR content LIKE ? ORDER BY created_at DESC LIMIT 5`,
    [`%${q}%`, `%${q}%`]
  );
  // if keyword miss, take recent
  const recent = acts.length ? acts : store.all(`SELECT * FROM activities ORDER BY started_at DESC LIMIT 40`);
  const context = [
    '## 知识卡片',
    ...cards.map(c => `- [${c.kind}] ${c.title}: ${c.summary || ''}`),
    '## 日志',
    ...journals.map(j => `- ${j.period_key} ${j.title}: ${(j.content || '').slice(0, 200)}`),
    '## 活动',
    formatActivities(recent, 40)
  ].join('\n');

  store.addChatMessage('user', q);
  const { content } = await chatCompletion(cfg, [
    { role: 'system', content: prompts.systemKnowledge },
    { role: 'user', content: prompts.chatWithHistory(q, context) }
  ], { max_tokens: 2500 });
  store.addChatMessage('assistant', content);
  return content;
}

async function maybeAutoSummarize(cfg) {
  if (!cfg.ai?.autoSummarize || !cfg.ai?.apiKey && !String(cfg.ai?.baseUrl || '').includes('11434')) return;
  try {
    await extractCardsFromRecent(cfg, 2);
  } catch (e) {
    console.error('autoSummarize', e.message);
  }
}

module.exports = { buildDailyJournal, extractCardsFromRecent, askHistory, maybeAutoSummarize, formatActivities };
