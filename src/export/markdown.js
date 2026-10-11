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

function exportVault(vaultPath) {
  ensureDir(vaultPath);
  const cardsDir = path.join(vaultPath, '知识卡片');
  const journalsDir = path.join(vaultPath, '日志');
  const timelineDir = path.join(vaultPath, '时间线');
  const rawDir = path.join(vaultPath, '原始数据');
  [cardsDir, journalsDir, timelineDir, rawDir].forEach(ensureDir);

  const cards = store.all(`SELECT * FROM knowledge_cards ORDER BY updated_at DESC`);
  for (const c of cards) {
    const tags = (() => { try { return JSON.parse(c.tags || '[]'); } catch { return []; } })();
    const md = `---
kind: ${c.kind}
title: ${c.title}
importance: ${c.importance}
updated: ${dayjs(c.updated_at).format('YYYY-MM-DD HH:mm')}
tags: [${tags.join(', ')}]
---

# ${c.title}

${c.summary || ''}

${c.content || ''}
`;
    fs.writeFileSync(path.join(cardsDir, `${sanitize(c.kind)}-${sanitize(c.title)}.md`), md, 'utf8');
  }

  const journals = store.all(`SELECT * FROM journals ORDER BY period_key DESC`);
  for (const j of journals) {
    const md = `# ${j.title || j.period_key}\n\n${j.content || ''}\n\n## 要点\n${(() => { try { return (JSON.parse(j.highlights||'[]')).map(h=>`- ${h}`).join('\n'); } catch { return ''; } })()}\n`;
    fs.writeFileSync(path.join(journalsDir, `${j.period_key}.md`), md, 'utf8');
  }

  // last 7 days timeline
  const from = Date.now() - 7 * 86400000;
  const acts = store.all(`SELECT * FROM activities WHERE started_at>=? ORDER BY started_at ASC`, [from]);
  const byDay = {};
  for (const a of acts) {
    const d = dayjs(a.started_at).format('YYYY-MM-DD');
    (byDay[d] = byDay[d] || []).push(a);
  }
  for (const [d, list] of Object.entries(byDay)) {
    const lines = list.map(a => {
      const t = dayjs(a.started_at).format('HH:mm');
      return `- ${t} **${a.type}** ${a.app_name || ''} ${a.window_title || ''} ${a.url || ''} ${a.file_path || ''}`;
    });
    fs.writeFileSync(path.join(timelineDir, `${d}.md`), `# ${d} 时间线\n\n${lines.join('\n')}\n`, 'utf8');
  }

  // JSON dump
  const dump = {
    exportedAt: new Date().toISOString(),
    cards,
    journals,
    activitiesRecent: acts.slice(-2000)
  };
  fs.writeFileSync(path.join(rawDir, 'export.json'), JSON.stringify(dump, null, 2), 'utf8');

  // index
  const index = `# 知迹 MindTrace 知识库\n\n导出时间：${dayjs().format('YYYY-MM-DD HH:mm')}\n\n- [[知识卡片]]\n- [[日志]]\n- [[时间线]]\n- 原始数据见 \`原始数据/export.json\`\n\n> 此文件夹可直接作为 Obsidian 库打开。\n`;
  fs.writeFileSync(path.join(vaultPath, 'README.md'), index, 'utf8');
  fs.writeFileSync(path.join(cardsDir, '知识卡片.md'), `# 知识卡片\n\n共 ${cards.length} 张\n\n` + cards.map(c => `- [[${sanitize(c.kind)}-${sanitize(c.title)}|${c.title}]] (${c.kind})`).join('\n') + '\n', 'utf8');

  return { vaultPath, cards: cards.length, journals: journals.length, activities: acts.length };
}

module.exports = { exportVault };
