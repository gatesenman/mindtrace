/**
 * CALENDAR：承诺/待办/会议（计划轨）+ 活动块（实际轨）+ 提醒 + ICS
 */
const store = require('../main/store');
const evidence = require('../common/evidence');
const bigram = require('../common/bigram');
const U = require('../common/util');
const blocks = require('./blocks');

const KIND_LABEL = { meeting: '会议', todo: '待办', deadline: '截止', reminder: '提醒', commitment: '承诺', focus: '专注', event: '事件' };
const H2 = 2 * 3600000;
const titleKey = (t) => String(t || '').replace(/[\s，。,.!！?？:：、]/g, '').replace(/^(和|与|跟)/, '').toLowerCase();
const sim = (a, b) => bigram.jaccard(bigram.bigramSet(titleKey(a)), bigram.bigramSet(titleKey(b)));
function dedupeKey(title, start) { return U.sha1(titleKey(title) + '|' + (start ? U.dayOf(start) : 'none')).slice(0, 16); }

let notifier = null;
function setNotifier(fn) { notifier = fn; }

function row(id) { return store.get(`SELECT * FROM calendar_events WHERE id=?`, [id]); }

function create(ev, { by = 'user', ctx } = {}) {
  const now = Date.now(); const id = ev.id || U.uid();
  const status = ev.status || (by === 'user' ? 'confirmed' : 'proposed');
  store.run(`INSERT INTO calendar_events (id,layer,kind,title,notes,start_at,end_at,all_day,rrule,location,participants,status,priority,confidence,time_certainty,direction,dedupe_key,source_app,reminders,created_by,change_of,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, ev.layer || 'plan', ev.kind || 'todo', String(ev.title).slice(0, 80), ev.notes || null, ev.start_at ?? null, ev.end_at ?? null, ev.all_day ? 1 : 0, ev.rrule || null, ev.location || null, JSON.stringify(ev.participants || []), status, ev.priority ?? 2, ev.confidence ?? (by === 'user' ? 1 : 0.6), ev.time_certainty || (ev.start_at ? 'exact' : 'none'), ev.direction || 'mine', ev.dedupe_key || dedupeKey(ev.title, ev.start_at), ev.source_app || null, JSON.stringify(ev.reminders || [10]), by, ev.change_of || null, now, now]);
  if (ctx) for (const e of (ctx.eventIds || [null]).slice(0, 3)) evidence.add('calendar', id, { chunkId: ctx.chunkId, eventId: e, ts: ctx.ts, quote: ev.quote });
  return id;
}

/**
 * 摄入 AI 候选（统一抽取产物）。默认 proposed（T15）；跨来源合并（T13）；改期 → 变更建议（T14）
 */
function ingest(c, ctx = {}) {
  if (!c || !c.title || !Number.isFinite(c.start)) return { op: 'SKIP', reason: 'invalid' };
  if (ctx.privacy && ctx.privacy !== 'full') return { op: 'SKIP', reason: 'privacy' };
  const key = dedupeKey(c.title, c.start);
  if (U.tombstoned('cal:' + key)) return { op: 'SKIP', reason: 'tombstone' };
  const near = store.all(`SELECT * FROM calendar_events WHERE layer='plan' AND status NOT IN ('dismissed','cancelled') AND (start_at BETWEEN ? AND ? OR dedupe_key=?)`, [c.start - H2, c.start + H2, key]);
  if (!c.change) {
    const dup = near.find(e => e.dedupe_key === key || sim(e.title, c.title) >= 0.5 || (c.kind === 'meeting' && e.kind === 'meeting' && Math.abs(e.start_at - c.start) <= 15 * 60000 && overlapPeople(e, c)));
    if (dup) {
      const parts = [...new Set([...JSON.parse(dup.participants || '[]'), ...(c.participants || [])])];
      store.run(`UPDATE calendar_events SET confidence=?, participants=?, source_app=CASE WHEN source_app IS NULL THEN ? WHEN instr(source_app, ?)>0 THEN source_app ELSE source_app||','||? END, updated_at=? WHERE id=?`,
        [Math.min(0.99, 1 - (1 - dup.confidence) * (1 - (c.confidence || 0.6) * 0.5)), JSON.stringify(parts), ctx.app || null, ctx.app || '~', ctx.app || '', Date.now(), dup.id]);
      for (const e of (ctx.eventIds || [null]).slice(0, 3)) evidence.add('calendar', dup.id, { chunkId: ctx.chunkId, eventId: e, ts: ctx.ts, quote: c.quote });
      return { op: 'MERGE', id: dup.id };
    }
  } else {
    // 改期：在全部未来计划里找最相似的原事件（不看时间）
    const pool = store.all(`SELECT * FROM calendar_events WHERE layer='plan' AND status IN ('confirmed','proposed') AND change_of IS NULL ORDER BY updated_at DESC LIMIT 200`);
    let best = null, bs = 0;
    for (const e of pool) { const s = sim(e.title, c.title) + (overlapPeople(e, c) ? 0.3 : 0); if (s > bs) { bs = s; best = e; } }
    if (best && bs >= 0.35) {
      const id = create({ kind: best.kind, title: best.title, start_at: c.start, end_at: c.end || (best.end_at && best.start_at ? c.start + (best.end_at - best.start_at) : null), participants: JSON.parse(best.participants || '[]'), change_of: best.id, confidence: c.confidence, time_certainty: c.certainty, notes: `改期建议：${U.fmtTs(best.start_at)} → ${U.fmtTs(c.start)}`, quote: c.quote, source_app: ctx.app, status: 'proposed' }, { by: 'ai', ctx });
      return { op: 'CHANGE', id, of: best.id };
    }
  }
  const id = create({ kind: c.kind || 'todo', title: c.title, start_at: c.start, end_at: c.end || null, all_day: c.all_day, rrule: c.rrule, participants: c.participants, confidence: c.confidence, time_certainty: c.certainty, direction: c.direction, quote: c.quote, source_app: ctx.app, status: applyRules(c) || 'proposed', notes: c.quote ? `原文：${c.quote.slice(0, 120)}` : null }, { by: 'ai', ctx });
  return { op: 'ADD', id };
}
function overlapPeople(e, c) { const a = JSON.parse(e.participants || '[]'); return (c.participants || []).some(p => a.includes(p)); }
function applyRules(c) {
  for (const r of store.all(`SELECT * FROM calendar_rules WHERE enabled=1`)) {
    try { const m = JSON.parse(r.match || '{}'); if ((!m.kind || m.kind === c.kind) && (!m.title || String(c.title).includes(m.title))) return JSON.parse(r.action || '{}').status || null; } catch (_) {}
  }
  return null;
}

function accept(id) {
  const e = row(id); if (!e) return false;
  if (e.change_of) { // 采纳改期：更新原事件时间，删除建议
    store.run(`UPDATE calendar_events SET start_at=?, end_at=?, status='confirmed', updated_at=?, reminded_at=NULL WHERE id=?`, [e.start_at, e.end_at, Date.now(), e.change_of]);
    store.run(`UPDATE calendar_events SET status='applied' WHERE id=?`, [id]);
    return e.change_of;
  }
  store.run(`UPDATE calendar_events SET status='confirmed', updated_at=? WHERE id=?`, [Date.now(), id]);
  return id;
}
function dismiss(id) {
  const e = row(id); if (!e) return false;
  store.run(`UPDATE calendar_events SET status='dismissed', updated_at=? WHERE id=?`, [Date.now(), id]);
  U.tombstone('cal:' + e.dedupe_key, 'calendar', e.title);
  return true;
}
function update(id, patch) {
  const e = row(id); if (!e) return false;
  const allowed = ['title', 'notes', 'start_at', 'end_at', 'all_day', 'kind', 'status', 'priority', 'location'];
  const keys = Object.keys(patch).filter(k => allowed.includes(k)); if (!keys.length) return false;
  const locked = [...new Set([...(JSON.parse(e.locked_fields || '[]')), ...keys])];
  store.run(`UPDATE calendar_events SET ${keys.map(k => k + '=?').join(',')}, locked_fields=?, updated_at=? ${patch.status === 'done' ? ', completed_at=' + Date.now() : ''} WHERE id=?`, [...keys.map(k => patch[k]), JSON.stringify(locked), Date.now(), id]);
  return true;
}
function complete(id) { return update(id, { status: 'done' }); }
function remove(id) { store.run(`DELETE FROM calendar_events WHERE id=?`, [id]); evidence.removeOwner('calendar', id); return true; }

function expandRRule(e, from, to) {
  if (!e.rrule || !e.start_at) return [e];
  const m = /FREQ=(DAILY|WEEKLY)(?:;BYDAY=([A-Z,]+))?/.exec(e.rrule); if (!m) return [e];
  const out = []; const dur = (e.end_at || e.start_at) - e.start_at;
  const days = m[2] ? m[2].split(',').map(d => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].indexOf(d)) : null;
  for (let t = e.start_at; t < to && out.length < 400; t += 86400000) {
    const dow = new Date(t + 8 * 3600000).getUTCDay();
    if (m[1] === 'WEEKLY' && !(days ? days.includes(dow) : dow === new Date(e.start_at + 8 * 3600000).getUTCDay())) continue;
    if (t + dur >= from) out.push({ ...e, start_at: t, end_at: e.end_at ? t + dur : null, occurrence: true });
  }
  return out;
}
function listRange(from, to, { includeProposed = true } = {}) {
  const st = includeProposed ? `('confirmed','proposed','done')` : `('confirmed','done')`;
  const rows = store.all(`SELECT * FROM calendar_events WHERE layer='plan' AND status IN ${st} AND ((start_at>=? AND start_at<?) OR (rrule IS NOT NULL AND start_at<?))`, [from, to, to]);
  const plan = rows.flatMap(e => expandRRule(e, from, to)).filter(e => e.start_at >= from && e.start_at < to).map(decorate);
  const undated = store.all(`SELECT * FROM calendar_events WHERE layer='plan' AND start_at IS NULL AND status IN ('confirmed','proposed') ORDER BY created_at DESC LIMIT 50`).map(decorate);
  return { plan, actual: blocks.computeBlocks(from, to), undated };
}
function decorate(e) { return { ...e, participants: JSON.parse(e.participants || '[]'), kind_label: KIND_LABEL[e.kind] || e.kind, overdue: e.status !== 'done' && e.start_at && e.start_at < Date.now() && e.kind !== 'meeting' }; }
function agenda({ from = Date.now() - 86400000, days = 14 } = {}) {
  const to = from + days * 86400000;
  return listRange(from, to).plan.sort((a, b) => a.start_at - b.start_at);
}
function openCommitments({ limit = 20 } = {}) {
  return store.all(`SELECT * FROM calendar_events WHERE layer='plan' AND status='confirmed' AND kind IN ('todo','deadline','commitment','meeting','reminder') AND (start_at IS NULL OR start_at>=?) ORDER BY COALESCE(start_at, 9e15) LIMIT ?`, [Date.now() - 86400000, limit]).map(decorate);
}
function proposals() { return store.all(`SELECT * FROM calendar_events WHERE layer='plan' AND status='proposed' ORDER BY COALESCE(start_at, created_at)`).map(e => ({ ...decorate(e), evidence: evidence.list('calendar', e.id).slice(0, 3), original: e.change_of ? row(e.change_of) : null })); }

/** 计划 vs 实际：某日计划时长、实际块、会议实际时长 */
function dayCompare(dayStart) {
  const to = dayStart + 86400000;
  const { plan, actual } = listRange(dayStart, to, { includeProposed: false });
  const meetMin = actual.filter(b => b.kind === 'meeting').reduce((s, b) => s + b.minutes, 0);
  const planned = plan.filter(e => e.end_at).reduce((s, e) => s + (e.end_at - e.start_at) / 60000, 0);
  const done = plan.filter(e => e.status === 'done').length;
  return { planned_min: Math.round(planned), actual_min: actual.reduce((s, b) => s + b.minutes, 0), meeting_min: meetMin, items: plan.length, done };
}

/* ───────── 提醒 ───────── */
function dueReminders(now = Date.now()) {
  const rows = store.all(`SELECT * FROM calendar_events WHERE layer='plan' AND status='confirmed' AND start_at IS NOT NULL AND start_at BETWEEN ? AND ? AND reminded_at IS NULL`, [now - 30 * 60000, now + 60 * 60000]);
  return rows.filter(e => {
    if (e.snooze_until) return e.snooze_until <= now;
    const leads = JSON.parse(e.reminders || '[10]');
    return leads.some(m => e.start_at - m * 60000 <= now);
  });
}
function tick(now = Date.now()) {
  const due = dueReminders(now);
  for (const e of due) {
    store.run(`UPDATE calendar_events SET reminded_at=?, snooze_until=NULL WHERE id=?`, [now, e.id]);
    try { notifier && notifier({ id: e.id, title: `${KIND_LABEL[e.kind] || '日程'}：${e.title}`, body: `${U.fmtTs(e.start_at).slice(11)} 开始${e.location ? ' · ' + e.location : ''}` }); } catch (_) {}
  }
  return due.map(e => e.id);
}
function snooze(id, minutes = 10, now = Date.now()) { store.run(`UPDATE calendar_events SET snooze_until=?, reminded_at=NULL WHERE id=?`, [now + minutes * 60000, id]); return now + minutes * 60000; }

/* ───────── ICS ───────── */
const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const icsTs = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsDate = (ms) => new Date(ms + 8 * 3600000).toISOString().slice(0, 10).replace(/-/g, '');
function fold(line) { const out = []; let s = line; while (Buffer.byteLength(s) > 74) { let i = 74; while (Buffer.byteLength(s.slice(0, i)) > 74) i--; out.push(s.slice(0, i)); s = ' ' + s.slice(i); } out.push(s); return out.join('\r\n'); }
function toIcs(events, { name = '知迹 MindTrace' } = {}) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MindTrace//知迹 2.3//ZH', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsEsc(name)}`, 'X-WR-TIMEZONE:Asia/Shanghai'];
  for (const e of events) {
    if (!e.start_at) continue;
    L.push('BEGIN:VEVENT', `UID:${e.id}@mindtrace.local`, `DTSTAMP:${icsTs(e.updated_at || Date.now())}`);
    if (e.all_day) { L.push(`DTSTART;VALUE=DATE:${icsDate(e.start_at)}`); }
    else { L.push(`DTSTART:${icsTs(e.start_at)}`); L.push(`DTEND:${icsTs(e.end_at || e.start_at + 30 * 60000)}`); }
    L.push(`SUMMARY:${icsEsc(e.title)}`);
    if (e.notes) L.push(`DESCRIPTION:${icsEsc(e.notes)}`);
    if (e.location) L.push(`LOCATION:${icsEsc(e.location)}`);
    if (e.rrule) L.push(`RRULE:${e.rrule}`);
    L.push(`STATUS:${e.status === 'confirmed' || e.status === 'done' ? 'CONFIRMED' : 'TENTATIVE'}`, `CATEGORIES:${icsEsc(KIND_LABEL[e.kind] || e.kind)}`);
    for (const m of JSON.parse(typeof e.reminders === 'string' ? e.reminders : JSON.stringify(e.reminders || []))) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:-PT${m}M`, `DESCRIPTION:${icsEsc(e.title)}`, 'END:VALARM');
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}
function exportIcs({ includeProposed = false } = {}) {
  const rows = store.all(`SELECT * FROM calendar_events WHERE layer='plan' AND status IN (${includeProposed ? "'confirmed','proposed','done'" : "'confirmed','done'"}) AND start_at IS NOT NULL ORDER BY start_at`);
  return toIcs(rows);
}
function stats() { const g = (s) => store.get(s)?.c || 0; return { proposed: g(`SELECT COUNT(*) c FROM calendar_events WHERE status='proposed'`), confirmed: g(`SELECT COUNT(*) c FROM calendar_events WHERE status='confirmed'`), done: g(`SELECT COUNT(*) c FROM calendar_events WHERE status='done'`) }; }

module.exports = { KIND_LABEL, create, ingest, accept, dismiss, update, complete, remove, listRange, agenda, openCommitments, proposals, dayCompare, dueReminders, tick, snooze, setNotifier, toIcs, exportIcs, stats, dedupeKey, blocks };
