require('./stub-electron');
// 2.5 加固 R5 · 核心流程集成回归与错误恢复
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const forget = require('../src/core/forget');
const search = require('../src/core/search');
const G = require('../src/content/ground');
const C = require('../src/content/citations');
const slugs = require('../src/wiki/slugs');
const { formatActivities, buildClusterPayload } = require('../src/ai/summarizer');
const { redactText } = require('../src/privacy/redact');

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' — ' + (e.stack || e.message)); } };

const t0 = Date.parse('2026-10-21T09:00:00+08:00');
const day = '2026-10-21';

function storeFrom(rows) {
  const activities = rows.slice();
  const wiki = [];
  const evidence = [];
  const memories = [];
  const st = {
    activities, wiki, evidence, memories,
    all(sql, params) {
      if (/SELECT id FROM activities/i.test(sql) && !/WHERE/i.test(sql)) return activities.map(a => ({ id: a.id }));
      if (/FROM wiki_pages/i.test(sql) && /backlinks/.test(sql)) return wiki;
      if (/FROM evidence WHERE event_id/i.test(sql)) {
        const ids = new Set(activities.map(a => a.id));
        return evidence.filter(e => e.event_id && !ids.has(e.event_id)).map(e => ({ id: e.id }));
      }
      if (/FROM evidence WHERE ts>=/.test(sql)) return [];
      if (/FROM chunks/.test(sql) || /FROM memories t/.test(sql) || /FROM claims t/.test(sql) || /FROM calendar_events t/.test(sql)) return [];
      if (/COUNT\(\*\)/.test(sql) && /activities/.test(sql)) {
        const [from, to] = params || [];
        return [{ c: activities.filter(a => a.started_at >= from && a.started_at < to).length }];
      }
      if (/COUNT\(\*\)/.test(sql) && /screenshots/.test(sql)) return [{ c: 0 }];
      return [];
    },
    get(sql, params) {
      const rows = st.all(sql, params);
      if (/COUNT\(\*\)/.test(sql)) return { c: (rows[0] && rows[0].c) || 0 };
      if (/FROM wiki_pages WHERE kind=\? AND slug=\?/.test(sql)) return wiki.find(p => p.kind === params[0] && p.slug === params[1]) || null;
      if (/FROM wiki_pages WHERE kind=\? AND title=\?/.test(sql)) return wiki.find(p => p.kind === params[0] && p.title === params[1]) || null;
      return rows[0] || { c: 0 };
    },
    run(sql, params) {
      if (/DELETE FROM activities WHERE started_at>=/.test(sql)) {
        const [from, to] = params;
        for (let i = activities.length - 1; i >= 0; i--) {
          if (activities[i].started_at >= from && activities[i].started_at < to) activities.splice(i, 1);
        }
        return;
      }
      if (/DELETE FROM evidence WHERE id=\?/.test(sql)) {
        const i = evidence.findIndex(e => e.id === params[0]);
        if (i >= 0) evidence.splice(i, 1);
        return;
      }
      if (/DELETE FROM wiki_pages WHERE id=\?/.test(sql)) {
        const i = wiki.findIndex(p => p.id === params[0]);
        if (i >= 0) wiki.splice(i, 1);
        return;
      }
      if (/UPDATE wiki_pages SET backlinks/.test(sql)) {
        const p = wiki.find(x => x.id === params[3]);
        if (p) { p.backlinks = params[0]; p.body_md = params[1]; }
        return;
      }
      if (/UPDATE wiki_pages SET slug=\?/.test(sql)) {
        const p = wiki.find(x => x.id === params[1]);
        if (p) p.slug = params[0];
      }
    },
    transaction(fn) { fn(); },
    upsertWikiPage(page) {
      const cur = wiki.find(p => p.kind === page.kind && p.slug === page.slug);
      if (cur) { Object.assign(cur, page); return cur.id; }
      const id = page.id || 'p-' + wiki.length;
      wiki.push({ ...page, id, user_notes: page.user_notes || '' });
      return id;
    },
    searchFts(q, limit) {
      const terms = String(q).split(/\s+/).filter(Boolean);
      return activities.filter(r => {
        const hay = [r.title, r.window_title, r.content, r.url, r.path, r.file_path, r.app, r.app_name].join(' ');
        return terms.every(t => hay.includes(t));
      }).slice(0, limit);
    }
  };
  return st;
}

t('闭环：落地 Wiki → 检索可跳转 → 删除时间段后引用与检索一致，且失败可报告', () => {
  const rows = [
    {
      id: 'w1', type: 'window', started_at: t0, duration_ms: 40 * 60000,
      app_name: 'Word', process_name: 'WINWORD', window_title: '2026年Q3预算说明.docx - Word',
      file_path: 'D:\\\\工作\\\\2026年Q3预算说明.docx',
      content: '第三季度市场费用下降 12%，建议将结余转入品牌投放。',
      meta: '{"doc":{"kind":"office","name":"2026年Q3预算说明.docx"}}'
    },
    {
      id: 'wx1', type: 'window', started_at: t0 + 2 * 3600000, duration_ms: 15 * 60000,
      app_name: '微信', window_title: '产品研发群',
      content: '周五前把发布说明发我。',
      meta: '{"doc":{"kind":"chat","name":"产品研发群"}}'
    }
  ];
  const st = storeFrom(rows);
  // 旧 slug 页应被迁移而不是复制
  st.wiki.push({ id: 'legacy', kind: 'document', slug: '2026年Q3预算说明.docx', title: '2026年Q3预算说明.docx', body_md: '旧版摘要', user_notes: '', backlinks: '[]' });

  const applied = G.apply(rows, { day, store: st });
  assert.ok(applied.pageIds.length >= 1);
  const docPages = st.wiki.filter(p => p.kind === 'document' && /预算说明/.test(p.title || p.slug || ''));
  assert.ok(docPages.length >= 1);
  // 不应同时留下无前缀与有前缀两份（迁移可能改 slug 或合并）
  const slugsForDoc = new Set(docPages.map(p => p.slug));
  assert.ok([...slugsForDoc].some(s => String(s).startsWith('doc-')), [...slugsForDoc]);

  const hit = search.search('市场费用', { store: st });
  assert.ok(hit.activities.some(a => a.id === 'w1'));
  assert.deepStrictEqual(hit.activities.find(a => a.id === 'w1').jump.activityId, 'w1');
  const chat = search.search('发布说明', { store: st, kind: 'chat' });
  assert.ok(chat.activities.some(a => a.id === 'wx1'), JSON.stringify(chat.activities.map(a => ({ id: a.id, kind: a.kind }))));

  // 只擦掉上午的 Word 时段，微信会话应还在
  st.evidence.push({ id: 'e1', owner_type: 'memory', owner_id: 'm1', event_id: 'w1', ts: t0 });
  const wiped = forget.wipeRangeCascade(t0, t0 + 3600000, { store: st });
  assert.strictEqual(wiped.ok, true);
  assert.ok(!st.activities.some(a => a.id === 'w1'));
  assert.ok(st.activities.some(a => a.id === 'wx1'));
  const after = search.search('市场费用', { store: st });
  assert.ok(!after.activities.some(a => a.id === 'w1'));
  const still = search.search('发布说明', { store: st, kind: 'chat' });
  assert.ok(still.activities.some(a => a.id === 'wx1'));

  // 失败路径
  const boom = storeFrom(rows);
  boom.run = () => { throw new Error('sqlite busy'); };
  const failed = forget.wipeRangeCascade(t0, t0 + 10, { store: boom });
  assert.strictEqual(failed.ok, false);
  assert.match(String(failed.error), /sqlite busy/);
});

t('送模型的闭环文本仍脱敏，且旧 r12–r17 模块可一并加载', () => {
  const dirty = [{
    id: 's', type: 'window', started_at: t0, duration_ms: 60000,
    app_name: '记事本', process_name: 'Notepad', window_title: '密钥.txt',
    url: 'https://ex.test/cb?access_token=leaksecret',
    content: 'github_pat_abcdefghijklmnopqrstuvwxyz0123456789ABCD 说明文字',
    meta: '{"doc":{"kind":"text","name":"密钥.txt"}}'
  }];
  const block = formatActivities(dirty, 10);
  assert.doesNotMatch(block, /github_pat_/);
  assert.doesNotMatch(block, /leaksecret/);
  const payload = buildClusterPayload([{ title: 'k', summary: dirty[0].content }], dirty, { max: 2000 });
  assert.doesNotMatch(payload, /github_pat_/);
  assert.strictEqual(redactText(dirty[0].content).includes('github_pat_'), false);
  assert.ok(typeof slugs.canonicalSlug === 'function' && typeof C.pruneWikiPage === 'function');
});

t('主进程时间段清除改为单一入口，避免只删活动不级联', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/main/main.js'), 'utf8');
  assert.match(src, /wipeRangeCascade/);
  // 不再把 wipeRange 与 cascadeRange 先后裸调用当作唯一路径
  assert.doesNotMatch(src, /pro\.wipeRange\(from, to\);\s*const c = v23\.forget\.cascadeRange/);
});

console.log(`r22: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
