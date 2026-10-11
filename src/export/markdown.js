const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const store = require('../main/store');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function sanitize(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
}

const KIND_DIR = {
  person: '人物',
  project: '项目',
  learning: '所学',
  todo: '待办',
  link: '链接',
  note: '笔记'
};

function exportVault(vaultPath) {
  ensureDir(vaultPath);
  const journalsDir = path.join(vaultPath, '日刊');
  const topicsDir = path.join(vaultPath, '主题');
  const cardsRoot = path.join(vaultPath, '卡片');
  const rawDir = path.join(vaultPath, 'raw');
  [journalsDir, topicsDir, cardsRoot, rawDir].forEach(ensureDir);
  for (const d of Object.values(KIND_DIR)) ensureDir(path.join(cardsRoot, d));

  const cards = store.all(`SELECT * FROM knowledge_cards ORDER BY updated_at DESC`);
  for (const c of cards) {
    const tags = (() => { try { return JSON.parse(c.tags || '[]'); } catch { return []; } })();
    const folder = KIND_DIR[c.kind] || '笔记';
    const md = `---
kind: ${c.kind}
title: "${String(c.title).replace(/"/g, '\\"')}"
importance: ${c.importance}
updated: ${dayjs(c.updated_at).format('YYYY-MM-DD HH:mm')}
tags: [${['知迹', c.kind].concat(tags).map(t => t).join(', ')}]
---

# ${c.title}

${c.summary || ''}

${c.content || ''}
`;
    fs.writeFileSync(path.join(cardsRoot, folder, `${sanitize(c.title)}.md`), md, 'utf8');
  }

  const journals = store.all(`SELECT * FROM journals ORDER BY period_key DESC`);
  for (const j of journals) {
    let highlights = [];
    try { highlights = JSON.parse(j.highlights || '[]'); } catch { highlights = []; }
    let stats = {};
    try { stats = JSON.parse(j.stats || '{}'); } catch { stats = {}; }
    const md = `---
date: ${j.period_key}
tags: [知迹, 日刊]
headline: "${String(j.title || '').replace(/"/g, '\\"')}"
---

# ${j.period_key} 日刊

> ${j.title || ''}

${j.content || ''}

## 要点
${highlights.map(h => `- ${h}`).join('\n') || '- （无）'}

## 结构化摘录
\`\`\`json
${JSON.stringify(stats, null, 2)}
\`\`\`
`;
    fs.writeFileSync(path.join(journalsDir, `${j.period_key}.md`), md, 'utf8');
  }

  const topics = store.all(`SELECT * FROM topics ORDER BY updated_at DESC`);
  for (const t of topics) {
    const md = `---
tags: [知迹, 主题]
---

# ${t.name}

${t.summary || ''}
`;
    fs.writeFileSync(path.join(topicsDir, `${sanitize(t.name)}.md`), md, 'utf8');
  }

  const from = Date.now() - 7 * 86400000;
  const acts = store.all(`SELECT * FROM activities WHERE started_at>=? ORDER BY started_at ASC`, [from]);
  fs.writeFileSync(path.join(rawDir, 'export.json'), JSON.stringify({
    exportedAt: new Date().toISOString(),
    cards,
    journals,
    topics,
    activitiesRecent: acts.slice(-2000)
  }, null, 2), 'utf8');

  const index = `# 知迹 MindTrace 知识库

导出时间：${dayjs().format('YYYY-MM-DD HH:mm')}

- [[日刊]]
- [[主题]]
- [[卡片]]

> 此文件夹可直接作为 Obsidian 库打开。原始 JSON 见 \`raw/export.json\`。
`;
  fs.writeFileSync(path.join(vaultPath, '00-首页.md'), index, 'utf8');
  fs.writeFileSync(path.join(journalsDir, '日刊.md'), `# 日刊\n\n共 ${journals.length} 篇\n\n` + journals.map(j => `- [[${j.period_key}]] ${j.title || ''}`).join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(cardsRoot, '卡片.md'), `# 卡片\n\n共 ${cards.length} 张\n`, 'utf8');

  return { vaultPath, cards: cards.length, journals: journals.length, topics: topics.length, activities: acts.length };
}

module.exports = { exportVault };
