/** Asia/Shanghai (UTC+8) civil-day helpers. Avoid Date.parse of naive ISO (that uses the host TZ). */
const OFFSET = '+08:00';

function dayOfShanghai(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return '';
  return new Date(n + 8 * 3600000).toISOString().slice(0, 10);
}

function dayBoundsShanghai(day) {
  const s = String(day || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const from = Date.parse(s + 'T00:00:00' + OFFSET);
  const to = Date.parse(s + 'T23:59:59.999' + OFFSET);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return { from, to };
}

/** When a range is set, rows without a timestamp are excluded (they must not sneak into a dated search). */
function inRange(ts, from, to) {
  const ranged = (from != null && from !== '') || (to != null && to !== '');
  const n = Number(ts || 0);
  if (ranged && !n) return false;
  if (from != null && from !== '' && n < Number(from)) return false;
  if (to != null && to !== '' && n > Number(to)) return false;
  return true;
}

module.exports = { dayOfShanghai, dayBoundsShanghai, inRange, OFFSET };
