/**
 * DB adapter. Primary: better-sqlite3 (native, WAL, FTS5) loaded from native/<platform>-<arch>/.
 * Fallback: sql.js (in-memory + export; FTS4 only). Exposes a uniform run/all/get/exec API.
 */
const fs = require('fs');
const path = require('path');

function nativeBindingPath() {
  const dir = `${process.platform}-${process.arch}`;
  const p = path.join(__dirname, '..', '..', 'native', dir, 'better_sqlite3.node');
  return p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

const norm = (params) => (params || []).map(v => v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

async function open(dbPath, { forceSqlJs = false } = {}) {
  if (!forceSqlJs && process.env.MINDTRACE_SQLJS !== '1') {
    try {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { nativeBinding: nativeBindingPath() });
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      const cache = new Map();
      const prep = (sql) => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); if (cache.size > 500) cache.clear(); cache.set(sql, s); } return s; };
      return {
        engine: 'better-sqlite3',
        exec: (sql) => db.exec(sql),
        run: (sql, p) => prep(sql).run(...norm(p)),
        all: (sql, p) => { const s = prep(sql); return s.reader ? s.all(...norm(p)) : (s.run(...norm(p)), []); },
        transaction: (fn) => db.transaction(fn)(),
        persist: () => { try { db.pragma('wal_checkpoint(PASSIVE)'); } catch (_) {} },
        needsPersist: false,
        close: () => db.close(),
        raw: db
      };
    } catch (e) {
      console.error('[db] better-sqlite3 unavailable, falling back to sql.js:', e.message);
    }
  }
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const db = fs.existsSync(dbPath) ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();
  return {
    engine: 'sql.js',
    exec: (sql) => db.run(sql),
    run: (sql, p) => db.run(sql, norm(p)),
    all: (sql, p) => { const st = db.prepare(sql); st.bind(norm(p)); const rows = []; while (st.step()) rows.push(st.getAsObject()); st.free(); return rows; },
    transaction: (fn) => { db.run('BEGIN'); try { const r = fn(); db.run('COMMIT'); return r; } catch (e) { db.run('ROLLBACK'); throw e; } },
    persist: () => { const tmp = dbPath + '.tmp'; fs.writeFileSync(tmp, Buffer.from(db.export())); fs.renameSync(tmp, dbPath); },
    needsPersist: true,
    close: () => db.close(),
    raw: db
  };
}

module.exports = { open, nativeBindingPath };
