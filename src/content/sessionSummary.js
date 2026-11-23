/**
 * 2.5 R1 · 内容感知的会话 / 小时 / 日摘要
 * 以文档名、页面标题、正文片段、路径为骨架，避免「用了 Word 40 分钟」。
 */
const dayjs = require('dayjs');
const { digest, objectOf, toPrompt, KIND_CN, fmtMin } = require('./docDigest');
const { redactText } = require('../privacy/redact');

const LINE_MAX = 80;
const SNIP_LINE = 72;
const VERB = { office: '编辑', wps: '编辑', text: '编辑', pdf: '阅读', code: '编辑', browser: '阅读', chat: '沟通', file: '处理', document: '处理' };

function clip(s, max) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if ([...t].length <= max) return t;
  return [...t].slice(0, max - 1).join('') + '…';
}

function quoteName(name, kind) {
  const n = String(name || '').trim();
  if (!n) return '';
  if (kind === 'browser') return `「${n}」`;
  if (kind === 'chat') return n;
  return `《${n}》`;
}

function verbOf(kind) { return VERB[kind] || '处理'; }

function bestExcerpt(list, max = SNIP_LINE) {
  const s = (list || []).map(d => d.snippet).filter(Boolean).sort((a, b) => b.length - a.length)[0];
  if (!s) return '';
  return clip(redactText(s), max);
}

/**
 * 一段活动（会话/小时抽样）的一句话摘要：点名对象 + 短摘录。
 */
function sessionLine(rows, { max = LINE_MAX } = {}) {
  const list = digest(rows || [], { limit: 6 });
  if (!list.length) {
    const titles = [...new Set((rows || []).map(r => String(r.window_title || '').replace(/\s*[-–—|]\s*(Word|Excel|PowerPoint|Visual Studio Code|VS Code|Cursor|Google Chrome|Microsoft Edge|记事本|Notepad).*$/i, '').trim()).filter(Boolean))].slice(0, 2);
    const app = (rows || []).find(r => r.app_name)?.app_name || '';
    if (titles.length) return clip((app ? `在${app}：` : '') + titles.join('、'), max);
    return clip(app ? `使用 ${app}` : '活动', max);
  }
  const names = list.slice(0, 2).map(d => quoteName(d.name, d.kind)).filter(Boolean);
  const more = list.length > 2 ? ` 等${list.length}项` : '';
  const verb = verbOf(list[0].kind);
  let line = list.length === 1
    ? `${verb}${names[0] || list[0].name}`
    : `${verb}${names.join('、')}${more}`;
  const excerpt = bestExcerpt(list, Math.max(24, max - [...line].length - 1));
  if (excerpt && !line.includes(excerpt.slice(0, Math.min(8, excerpt.length)))) line += `：${excerpt}`;
  return clip(line, max);
}

function hourMarkdown(rows, hourLabel) {
  const list = digest(rows || [], { limit: 8 });
  const head = sessionLine(rows, { max: 100 });
  const bullets = list.map(d => {
    const dur = fmtMin(d.ms);
    const snip = d.snippet ? clip(redactText(d.snippet), 60) : '';
    return `- ${quoteName(d.name, d.kind) || d.name}${d.app ? ` · ${d.app}` : ''}${dur ? ` · ${dur}` : ''}${snip ? `：${snip}` : ''}`;
  });
  return [`## ${hourLabel}`, '', head, bullets.length ? '' : null, ...bullets].filter(x => x != null).join('\n').trim() + '\n';
}

function dayMarkdown(rows, dateLabel) {
  const list = digest(rows || [], { limit: 12 });
  const label = dateLabel || '';
  if (!list.length) return `# ${label}\n\n当日没有可识别的文档或页面。\n`;
  const lines = list.map(d => {
    const dur = fmtMin(d.ms);
    const snip = d.snippet ? clip(redactText(d.snippet), 72) : '';
    return `- ${quoteName(d.name, d.kind) || d.name}${dur ? ` · ${dur}` : ''}${snip ? `：${snip}` : ''}`;
  });
  return [`# ${label}`, '', ...lines, ''].join('\n');
}

/** 给 LLM 的文档优先上下文（兼容 2.4.8 docSection 文案） */
function promptBlock(rows, { heading } = {}) {
  const list = digest(rows || [], { limit: 25 });
  if (!list.length) return '';
  const title = heading || '今日处理的文档/页面/会话（按时长）：';
  let body = redactText(toPrompt(list));
  if (body.length > 4000) body = body.slice(0, 4000) + '…';
  return title + '\n' + body + '\n\n事件明细：\n';
}

function eventLine(a) {
  const t = a.started_at ? dayjs(a.started_at).format('HH:mm') : '';
  const dur = a.duration_ms ? `${Math.round(a.duration_ms / 60000)}分钟` : '';
  let docName = '';
  try {
    const o = objectOf(a);
    if (o && o.name && o.name !== a.window_title) docName = `对象:${o.name}`;
  } catch (_) {}
  const parts = [t, a.type, a.app_name, a.window_title, docName, a.url, a.file_path];
  if (a.content) parts.push(redactText(String(a.content).slice(0, 200).replace(/\s+/g, ' ')));
  if (dur) parts.push(dur);
  return parts.filter(Boolean).join(' | ');
}

module.exports = {
  sessionLine, hourMarkdown, dayMarkdown, promptBlock, eventLine,
  clip, quoteName, bestExcerpt, LINE_MAX, KIND_CN
};
