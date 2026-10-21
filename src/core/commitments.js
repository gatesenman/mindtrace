/**
 * 2.4 R6 · 从沟通层抽出「我答应…」→ 日历承诺（proposed）
 * 复用 zhtime 的 COMMIT_RE / parse；不解密微信数据库，只看已采集的可见文本。
 */
const crypto = require('crypto');
const zh = require('../calendar/zhtime');
const calendar = require('../calendar');
const store = require('../main/store');

const SELF = /我来|我会|我负责|回头发你|我去|我明天|我今晚|我稍后|我答应|记得提醒我/;
const ASK = /帮我|麻烦你|请你|能不能|可以帮|记得|别忘/;

function extractFromText(text, { now = Date.now(), sourceApp = null, activityId = null } = {}) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s || s.length < 4) return [];
  const pf = zh.prefilter(s);
  if (!pf.has_commit) return [];
  const out = [];
  const parts = s.split(/[。！？\n；;]/).map(x => x.trim()).filter(x => x.length >= 4);
  for (const part of parts) {
    if (!zh.prefilter(part).has_commit) continue;
    const isSelf = SELF.test(part);
    const isAsk = ASK.test(part);
    if (!isSelf && !isAsk) continue;
    const t = (zh.parse(part, now) || [])[0];
    const title = part.replace(/^(好的|嗯|行|ok|OK)[,，\s]*/, '').slice(0, 60);
    out.push({
      title,
      kind: 'commitment',
      start_at: t?.start || null,
      time_certainty: t ? (t.certainty || 'approx') : 'none',
      notes: part.slice(0, 200),
      source_app: sourceApp,
      confidence: isSelf ? 0.75 : 0.55,
      dedupe_key: 'cmt:' + crypto.createHash('sha1').update(title.toLowerCase().replace(/\s+/g, '')).digest('hex').slice(0, 12),
      quote: part.slice(0, 120),
      activityId
    });
  }
  return out;
}

function scanRecent({ hours = 48, limit = 200 } = {}) {
  const since = Date.now() - hours * 3600 * 1000;
  let rows = [];
  try {
    rows = store.all(
      `SELECT id, content, app_name, started_at, meta FROM activities
       WHERE started_at>=? AND content IS NOT NULL AND length(content)>8
         AND (type IN ('uia','clipboard','screenshot','note') OR json_extract(meta,'$.layer')='communication')
       ORDER BY started_at DESC LIMIT ?`,
      [since, limit]
    );
  } catch (_) {
    rows = store.all(
      `SELECT id, content, app_name, started_at, meta FROM activities
       WHERE started_at>=? AND content IS NOT NULL AND length(content)>8
       ORDER BY started_at DESC LIMIT ?`,
      [since, limit]
    );
  }
  const found = [];
  const seen = new Set();
  for (const r of rows) {
    for (const it of extractFromText(r.content, { now: r.started_at || Date.now(), sourceApp: r.app_name, activityId: r.id })) {
      if (seen.has(it.dedupe_key)) continue;
      seen.add(it.dedupe_key);
      found.push(it);
    }
  }
  return found;
}

function ingestRecent(opts = {}) {
  const found = scanRecent(opts);
  const created = [];
  for (const ev of found) {
    try {
      // 已有同 dedupe_key 则跳过
      const exist = store.get(`SELECT id FROM calendar_events WHERE dedupe_key=? AND status NOT IN ('dismissed','cancelled')`, [ev.dedupe_key]);
      if (exist) continue;
      const id = calendar.create({
        layer: 'plan',
        kind: 'commitment',
        title: ev.title,
        notes: ev.notes,
        start_at: ev.start_at,
        status: 'proposed',
        confidence: ev.confidence,
        time_certainty: ev.time_certainty,
        direction: 'mine',
        dedupe_key: ev.dedupe_key,
        source_app: ev.source_app,
        quote: ev.quote
      }, { by: 'rules-r6', ctx: ev.activityId ? { eventIds: [ev.activityId], quote: ev.quote } : undefined });
      created.push({ id, title: ev.title, start_at: ev.start_at });
    } catch (_) {}
  }
  return { scanned: found.length, created };
}

module.exports = { extractFromText, scanRecent, ingestRecent };
