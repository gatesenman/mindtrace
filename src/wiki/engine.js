const dayjs = require('dayjs');
const store = require('../main/store');
const prompts = require('../ai/prompts');
const { chatCompletion, parseJsonLoose } = require('../ai/client');

function hourKey(ts) { return dayjs(ts).format('YYYY-MM-DD-HH'); }
function dayKey(ts) { return dayjs(ts).format('YYYY-MM-DD'); }
function weekKey(ts) {
  const d = dayjs(ts);
  const start = d.startOf('year');
  const week = Math.floor(d.diff(start, 'day') / 7) + 1;
  return `${d.format('YYYY')}-W${String(week).padStart(2, '0')}`;
}
function monthKey(ts) { return dayjs(ts).format('YYYY-MM'); }

function formatActs(rows, limit = 60) {
  const ss = require('../content/sessionSummary');
  const head = ss.promptBlock(rows, { heading: '本时段处理的文档/页面/会话：' });
  const lines = rows.slice(0, limit).map(a => ss.eventLine(a)).join('\n');
  return head + lines;
}

async function buildHourRollup(cfg, hourPeriodKey) {
  // hourPeriodKey: YYYY-MM-DD-HH
  const [d, h] = [hourPeriodKey.slice(0, 10), parseInt(hourPeriodKey.slice(11), 10)];
  const start = dayjs(d).hour(h).minute(0).second(0).millisecond(0);
  const from = start.valueOf();
  const to = start.add(1, 'hour').valueOf();
  const acts = require('../core/noise').filter(store.all(`SELECT * FROM activities WHERE started_at>=? AND started_at<? ORDER BY started_at ASC LIMIT 800`, [from, to])).slice(0, 200);
  if (!acts.length) return null;
  let summary;
  if (cfg?.ai?.baseUrl) {
    try {
      const { content } = await chatCompletion(cfg, [
        { role: 'system', content: prompts.systemKnowledge },
        { role: 'user', content: prompts.hourlyDigest(`${d} ${h}:00`, formatActs(acts)) }
      ], { max_tokens: 800 });
      const parsed = parseJsonLoose(content);
      summary = parsed
        ? `## ${parsed.headline || hourPeriodKey}\n\n${(parsed.bullets || []).map(b => `- ${b}`).join('\n')}`
        : content;
    } catch (e) {
      summary = require('../content/sessionSummary').hourMarkdown(acts, hourPeriodKey);
    }
  } else {
    summary = require('../content/sessionSummary').hourMarkdown(acts, `${d} ${String(h).padStart(2, '0')}:00`);
  }
  const id = store.upsertRollup({
    level: 'hour', period_key: hourPeriodKey,
    title: `${d} ${String(h).padStart(2, '0')} 时`,
    summary_md: summary,
    stats: { count: acts.length }
  });
  store.upsertWikiPage({
    kind: 'time', slug: `hour-${hourPeriodKey}`,
    title: `${d} ${String(h).padStart(2, '0')}时`,
    body_md: summary,
    backlinks: acts.slice(0, 20).map(a => a.id)
  });
  return id;
}

async function buildDayRollup(cfg, day) {
  const from = dayjs(day).startOf('day').valueOf();
  const to = dayjs(day).endOf('day').valueOf();
  const acts = require('../core/noise').filter(store.all(`SELECT * FROM activities WHERE started_at>=? AND started_at<=? ORDER BY started_at ASC LIMIT 1600`, [from, to])).slice(0, 400);
  const hours = store.getRollups('hour', `${day}-00`, `${day}-23`);
  let summary_md;
  if (cfg?.ai?.baseUrl && acts.length) {
    try {
      const summarizer = require('../ai/summarizer');
      const j = await summarizer.buildDailyJournal(cfg, day);
      summary_md = `# ${day}\n\n> ${j.title || ''}\n\n${j.summary || ''}\n\n## 要点\n${(j.highlights || []).map(h => `- ${h}`).join('\n')}`;
      // memories
      for (const t of (j.todos || [])) {
        store.upsertMemory({ kind: 'todo', text: String(t), confidence: 0.85, evidence: [day] });
      }
      for (const l of (j.learnings || [])) {
        store.upsertMemory({ kind: 'fact', text: String(l), confidence: 0.8, evidence: [day] });
      }
      for (const p of (j.people || [])) {
        store.upsertWikiPage({
          kind: 'person', slug: String(p).slice(0, 40),
          title: String(p), body_md: `与「${p}」相关的活动见于 ${day}。`,
          backlinks: [day]
        });
        store.upsertMemory({ kind: 'person_note', text: `与 ${p} 有互动（${day}）`, confidence: 0.7, evidence: [day] });
      }
      for (const topic of (j.topics || [])) {
        store.upsertWikiPage({
          kind: 'project', slug: String(topic).slice(0, 40),
          title: String(topic), body_md: `项目/主题「${topic}」在 ${day} 有进展。`,
          backlinks: [day]
        });
      }
    } catch (e) {
      summary_md = require('../content/sessionSummary').dayMarkdown(acts, day);
    }
  } else {
    summary_md = require('../content/sessionSummary').dayMarkdown(acts, day);
  }
  store.upsertRollup({ level: 'day', period_key: day, title: `${day} 日卷`, summary_md, stats: { count: acts.length, hours: hours.length } });
  store.upsertWikiPage({ kind: 'time', slug: `day-${day}`, title: day, body_md: summary_md, backlinks: hours.map(h => h.id) });
  return true;
}

async function buildWeekRollup(cfg, weekKeyStr) {
  // Approximate: last 7 days from today if week key is current
  const days = [];
  for (let i = 0; i < 7; i++) days.push(dayjs().subtract(i, 'day').format('YYYY-MM-DD'));
  const rolls = days.map(d => store.get(`SELECT * FROM rollups WHERE level='day' AND period_key=?`, [d])).filter(Boolean);
  const body = `# ${weekKeyStr}\n\n` + rolls.map(r => `## ${r.period_key}\n\n${(r.summary_md || '').slice(0, 400)}\n`).join('\n');
  store.upsertRollup({ level: 'week', period_key: weekKeyStr, title: weekKeyStr, summary_md: body, stats: { days: rolls.length } });
  store.upsertWikiPage({ kind: 'time', slug: `week-${weekKeyStr}`, title: weekKeyStr, body_md: body });
  return true;
}

async function buildMonthRollup(cfg, month) {
  const rolls = store.all(`SELECT * FROM rollups WHERE level='day' AND period_key LIKE ? ORDER BY period_key ASC`, [`${month}%`]);
  const body = `# ${month}\n\n本月日卷 ${rolls.length} 篇。\n\n` + rolls.map(r => `- [[day-${r.period_key}|${r.period_key}]] ${r.title || ''}`).join('\n');
  store.upsertRollup({ level: 'month', period_key: month, title: month, summary_md: body, stats: { days: rolls.length } });
  store.upsertWikiPage({ kind: 'time', slug: `month-${month}`, title: month, body_md: body });
  return true;
}

async function runIncrementalRollups(cfg) {
  const now = Date.now();
  const hk = hourKey(now - 3600000); // previous hour
  await buildHourRollup(cfg, hk);
  if (dayjs().hour() >= 21 || process.env.MINDTRACE_FORCE_DAILY) {
    await buildDayRollup(cfg, dayKey(now));
  }
}

module.exports = {
  hourKey, dayKey, weekKey, monthKey,
  buildHourRollup, buildDayRollup, buildWeekRollup, buildMonthRollup,
  runIncrementalRollups
};
