/** 统一 Obsidian 同步模块（2.3：只写；回读在 P1）。写实体页、log.md、日历.ics、记忆.md */
const fs = require('fs');
const path = require('path');
const store = require('../main/store');
const kb = require('./index');
const DIR = { person: '人物', project: '项目', topic: '主题', tool: '工具', org: '组织', concept: '概念', source: '资料' };
const safe = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
function writeIfChanged(file, text) { try { if (fs.readFileSync(file, 'utf8') === text) return false; } catch (_) {} fs.writeFileSync(file, text, 'utf8'); return true; }
function exportKb(vaultPath) {
  const root = path.join(vaultPath, '知识库'); fs.mkdirSync(root, { recursive: true });
  let n = 0;
  for (const p of store.all(`SELECT * FROM wiki_pages WHERE entity_id IS NOT NULL`)) {
    const d = path.join(root, DIR[p.kind] || '其他'); fs.mkdirSync(d, { recursive: true });
    if (writeIfChanged(path.join(d, safe(p.title) + '.md'), p.body_md || '')) n++;
  }
  writeIfChanged(path.join(root, 'log.md'), kb.logMarkdown());
  try { writeIfChanged(path.join(vaultPath, '日历.ics'), require('../calendar').exportIcs()); } catch (_) {}
  try {
    const mem = require('../memory');
    const rows = mem.list({ status: 'active' });
    const by = {}; for (const m of rows) (by[mem.TYPE_LABEL[m.kind] || m.kind] ||= []).push(m);
    const md = ['# 关于我（记忆）', '', ...Object.entries(by).flatMap(([k, ms]) => [`## ${k}`, '', ...ms.map(m => `- ${m.text}${m.locked ? ' 🔒' : ''}`), ''])].join('\n');
    writeIfChanged(path.join(vaultPath, '记忆.md'), md);
  } catch (_) {}
  return n;
}
module.exports = { exportKb };
