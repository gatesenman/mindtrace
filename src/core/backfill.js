// 2.4 首日见效：经用户同意，回填过去 N 天本机已有的数据（浏览历史 / 下载 / 最近文件 / Git 提交）
// 借鉴：ActivityWatch 的 importer 概念（同一数据模型的离线导入，https://docs.activitywatch.net/en/latest/architecture.html）
const store = require('../main/store');
async function run({ getConfig, days = 7, onProgress = () => {} } = {}) {
  const cfg = getConfig();
  if (!cfg.authorized) return { ok: false, error: '尚未授权采集' };
  const since = Date.now() - days * 86400000;
  const sink = (ev) => store.insertActivityBatch([ev]);
  const steps = [];
  const step = async (key, name, fn) => {
    onProgress({ key, name, state: 'running' });
    let r; try { r = await fn(); } catch (e) { r = { error: e.message }; }
    const added = r?.added || 0; steps.push({ key, name, added, error: r?.error || null, unsupported: !!r?.unsupported });
    onProgress({ key, name, state: r?.error ? 'error' : 'done', added });
  };
  await step('browser', '浏览历史', () => require('../collectors/browserHistory').poll({ force: true, sinceMs: since, getConfig }));
  await step('downloads', '下载文件夹', () => require('../collectors/downloads').scan({ force: true, maxAgeDays: days, sink, getConfig }));
  await step('files', '最近打开的文件', () => require('../collectors/recentFiles').backfill({ maxAgeDays: days, sink }));
  await step('git', 'Git 提交', async () => {
    const ide = require('../collectors/ide');
    const recent = ide.readRecentWorkspaces?.() || [];
    let added = 0;
    for (const r of recent.slice(0, 10)) {
      const p = decodeURIComponent(String(r.uri || '').replace(/^file:\/\/\/?/, '')).replace(/^\/([A-Za-z]:)/, '$1');
      const commits = await ide.gitTodaySummary(p, `${days}.days`);
      for (const c of commits || []) {
        const t = Date.parse(c.date) || Date.now();
        if (store.insertActivity({ type: 'ide', started_at: t, ended_at: t, app_name: 'Git', window_title: `提交 ${c.hash} · ${c.subject}`, file_path: null, content: `${p}\n${c.subject}`, meta: { backfill: true, workspace: p, commit: c.hash, author: c.author } })) added++;
      }
    }
    return { added };
  });
  store.persist?.(true);
  const total = steps.reduce((n, s) => n + s.added, 0);
  return { ok: true, days, total, steps, review: review7(store, { days }) };
}
/** 过去 N 天回顾：纯规则统计，无需 AI Key */
function review7(st, { days = 7, now = Date.now() } = {}) {
  const since = now - days * 86400000;
  const q = (sql, p = []) => { try { return st.all(sql, p); } catch (_) { return []; } };
  const daysActive = q(`SELECT COUNT(DISTINCT date(started_at/1000,'unixepoch','localtime')) c FROM activities WHERE started_at>=?`, [since])[0]?.c || 0;
  const total = q(`SELECT COUNT(*) c FROM activities WHERE started_at>=?`, [since])[0]?.c || 0;
  const urls = q(`SELECT url, window_title t FROM activities WHERE type='browser' AND started_at>=? AND url IS NOT NULL`, [since]);
  const dom = new Map(); for (const r of urls) { let h; try { h = new URL(r.url).hostname.replace(/^www\./, ''); } catch (_) { continue; } const d = dom.get(h) || { host: h, visits: 0, sample: r.t }; d.visits++; dom.set(h, d); }
  const topSites = [...dom.values()].sort((a, b) => b.visits - a.visits).slice(0, 6);
  const files = q(`SELECT file_path p, window_title t, type, MAX(started_at) last, COUNT(*) n FROM activities WHERE file_path IS NOT NULL AND type IN ('file','download','document') AND started_at>=? GROUP BY lower(file_path) ORDER BY n DESC, last DESC LIMIT 6`, [since]);
  const commits = q(`SELECT window_title t, meta FROM activities WHERE type='ide' AND started_at>=? AND window_title LIKE '提交 %'`, [since]);
  const repo = new Map(); for (const c of commits) { let w = ''; try { w = JSON.parse(c.meta).workspace || ''; } catch (_) {} const name = w.split(/[\\/]/).filter(Boolean).pop() || '未知仓库'; repo.set(name, (repo.get(name) || 0) + 1); }
  const apps = q(`SELECT app_name a, SUM(duration_ms) ms FROM activities WHERE type='window' AND started_at>=? GROUP BY app_name ORDER BY ms DESC LIMIT 5`, [since]).filter(r => r.a && r.ms > 0);
  const got = new Map(q(`SELECT date(started_at/1000,'unixepoch','localtime') d, COUNT(*) c FROM activities WHERE started_at>=? GROUP BY d ORDER BY d`, [since]).map(r => [r.d, r.c]));
  const byDay = []; for (let i = days - 1; i >= 0; i--) { const d = new Date(now - i * 86400000); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; byDay.push({ d: k, c: got.get(k) || 0 }); }
  return { days, daysActive, total, topSites, files: files.map(f => ({ name: String(f.p).split(/[\\/]/).pop().replace(/\.lnk$/i, ''), path: f.p, n: f.n, last: f.last })), repos: [...repo.entries()].map(([name, n]) => ({ name, commits: n })).sort((a, b) => b.commits - a.commits).slice(0, 5), commits: commits.length, apps, byDay };
}
module.exports = { run, review7 };
