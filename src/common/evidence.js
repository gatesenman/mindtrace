/** 统一证据表 evidence(owner_type, owner_id, chunk_id, event_id, ts, quote, polarity) */
const crypto = require('crypto');
const store = require('../main/store');
function add(ownerType, ownerId, { chunkId = null, eventId = null, ts = Date.now(), quote = null, polarity = 1 } = {}) {
  const dup = store.get(`SELECT id FROM evidence WHERE owner_type=? AND owner_id=? AND IFNULL(chunk_id,'')=IFNULL(?,'') AND IFNULL(event_id,'')=IFNULL(?,'') AND polarity=?`, [ownerType, ownerId, chunkId, eventId, polarity]);
  if (dup) return dup.id;
  const id = crypto.randomUUID();
  store.run(`INSERT INTO evidence (id,owner_type,owner_id,chunk_id,event_id,ts,quote,polarity) VALUES (?,?,?,?,?,?,?,?)`,
    [id, ownerType, ownerId, chunkId, eventId, ts, quote ? String(quote).slice(0, 200) : null, polarity]);
  return id;
}
function list(ownerType, ownerId) {
  return store.all(`SELECT e.*, a.app_name, a.window_title, a.started_at FROM evidence e LEFT JOIN activities a ON a.id=e.event_id WHERE e.owner_type=? AND e.owner_id=? ORDER BY e.ts DESC`, [ownerType, ownerId]);
}
function count(ownerType, ownerId, polarity = 1) { return store.get(`SELECT COUNT(*) c FROM evidence WHERE owner_type=? AND owner_id=? AND polarity=?`, [ownerType, ownerId, polarity])?.c || 0; }
function removeOwner(ownerType, ownerId) { store.run(`DELETE FROM evidence WHERE owner_type=? AND owner_id=?`, [ownerType, ownerId]); }
module.exports = { add, list, count, removeOwner };
