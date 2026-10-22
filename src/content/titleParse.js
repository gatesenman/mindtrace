/**
 * 2.4.8 · 按应用解析窗口标题 → 文档/页面/会话对象
 * parseTitle({ process, app, title }) → { kind, doc, ext, dir, path, project, site, chat, app } | null
 * kind: office | wps | code | text | pdf | explorer | browser | chat | null
 */
const proc = (p) => String(p || '').replace(/\.exe$/i, '').trim().toLowerCase();
const clean = (t) => String(t || '').replace(/[\u200b-\u200f\u202a-\u202e]/g, '').replace(/\s+/g, ' ').trim();
const EXT_RE = /\.([a-z0-9]{1,6})$/i;
const extOf = (s) => { const m = EXT_RE.exec(String(s || '')); return m ? m[1].toLowerCase() : ''; };
const isAbs = (s) => /^[a-z]:\\/i.test(s) || /^\\\\[^\\]+\\/.test(s) || (process.platform !== 'win32' && /^\/[^/]/.test(s));
const DASH = /\s+[-—–]\s+/;

// Office 标题后缀里的状态标记
const OFFICE_FLAGS = /\s*[[(（【]\s*(兼容模式|Compatibility Mode|只读|Read-Only|受保护的视图|Protected View|已共享|Shared|自动恢复|AutoRecovered|已修复|Repaired|组|Group)\s*[\])）】]/gi;
const OFFICE_SUFFIX = /\s+[-—–]\s+(Microsoft\s+)?(Word|Excel|PowerPoint|Visio|OneNote|Access|Publisher|Project)(\s*\(.*\))?$/i;
const SAVED = /\s+[-—–]\s+(已保存到此电脑|已保存到 OneDrive|已保存|Saved to this PC|Saved to OneDrive|Saved|正在保存[.…]*|Saving[.…]*|上次修改.*|Last Modified.*)$/i;

function splitLast(t) { const p = t.split(DASH); return p; }

function office(title) {
  let t = clean(title).replace(OFFICE_SUFFIX, '').replace(SAVED, '').replace(OFFICE_FLAGS, '').trim();
  t = t.replace(/^\*\s*/, '').replace(/\s*\*$/, '');
  if (!t || /^(Word|Excel|PowerPoint|开始|Start|Home)$/i.test(t)) return null;
  // 新建未保存文档：文档1 / Document1 / 工作簿1 / Book1 / 演示文稿1 / Presentation1
  const unsaved = /^(文档|Document|工作簿|Book|演示文稿|Presentation)\s*\d+$/i.test(t);
  return { doc: t, unsaved };
}

const BROWSER_SUFFIX = /\s+[-—–]\s+(?:(?:个人|Personal|工作|Work|InPrivate|无痕|隐身|Profile \d+)\s+[-—–]\s+)?(Microsoft\s*Edge|Microsoft​\s*Edge|Google Chrome|Chrome|Chromium|Mozilla Firefox|Firefox|Brave|360安全浏览器|360极速浏览器|QQ浏览器|搜狗高速浏览器|Opera)$/i;
const BROWSER_PROCS = /^(msedge|chrome|chromium|firefox|brave|opera|360se|360chrome|qqbrowser|sogouexplorer)$/;
const CHAT_PROCS = /^(wechat|weixin|wxwork|qq|dingtalk|feishu|lark|telegram|slack|teams|ms-teams)$/;
const CODE_PROCS = /^(code|code - insiders|cursor|windsurf|trae|devenv|idea64|pycharm64|webstorm64|goland64|clion64|sublime_text|atom|hbuilderx)$/;
const TEXT_PROCS = /^(notepad|notepad\+\+|notepad2|notepad3|typora|obsidian|marktext|emeditor|uedit64|uedit32)$/;
const PDF_PROCS = /^(acrobat|acrord32|acrord64|foxitpdfreader|foxitreader|foxitphantompdf|sumatrapdf|wpspdf|pdfelement|pdfxedit|xodo|drawboard)$/;
const OFFICE_PROCS = /^(winword|excel|powerpnt|visio|onenote|msaccess|mspub)$/;
const WPS_PROCS = /^(wps|et|wpp|wpsoffice|ksolaunch)$/;
// Office 网页版（浏览器标题里出现）
const OFFICE_WEB = /^(.+?)(\.(docx?|xlsx?|pptx?))?\s*[-—–]\s*(Microsoft )?(Word|Excel|PowerPoint)( Online)?$/i;
const SITE_TAIL = /\s+[-—–|·_]\s+([^-—–|·_]{1,24})$/;

function parseBrowser(t) {
  const page = clean(t).replace(BROWSER_SUFFIX, '').replace(/\s+(和另外|and)\s*\d+\s*(个页面|more pages?).*$/i, '').trim();
  if (!page || /^(新建标签页|New Tab|新标签页|空白页|about:blank)$/i.test(page)) return { kind: 'browser', page: '', doc: '' };
  const ow = OFFICE_WEB.exec(page);
  if (ow) return { kind: 'browser', page, doc: ow[1] + (ow[2] || ''), officeWeb: true };
  // 飞书/腾讯/石墨在线文档
  const cloud = /^(.+?)\s*[-—–|]\s*(飞书云文档|飞书文档|Feishu Docs|Lark Docs|腾讯文档|石墨文档|语雀|Notion|Google (Docs|Sheets|Slides)|Confluence)$/i.exec(page);
  if (cloud) return { kind: 'browser', page, doc: cloud[1], site: cloud[2], cloudDoc: true };
  const st = SITE_TAIL.exec(page);
  return { kind: 'browser', page, doc: '', site: st ? st[1].trim() : '' };
}

function parseTitle({ process: p, app, title } = {}) {
  const pr = proc(p); const t = clean(title);
  if (!t) return null;
  // 浏览器
  if (BROWSER_PROCS.test(pr) || BROWSER_SUFFIX.test(t)) return parseBrowser(t);
  // Office
  if (OFFICE_PROCS.test(pr) || (!pr && OFFICE_SUFFIX.test(t))) {
    const o = office(t); if (!o) return null;
    const appName = { winword: 'Word', excel: 'Excel', powerpnt: 'PowerPoint' }[pr] || (OFFICE_SUFFIX.exec(t) || [])[2] || 'Office';
    return { kind: 'office', doc: o.doc, ext: extOf(o.doc), unsaved: o.unsaved, app: appName };
  }
  // WPS：标题形如 "报告.docx - WPS Office" / "报告.docx - WPS 文字" / 新版只有 "WPS Office"
  if (WPS_PROCS.test(pr) || /\s[-—–]\s*WPS\s*(Office|文字|表格|演示|PDF)?$/i.test(t)) {
    const d = t.replace(/\s*[-—–]\s*WPS\s*(Office|文字|表格|演示|PDF)?$/i, '').replace(OFFICE_FLAGS, '').replace(/^\*|\*$/g, '').trim();
    if (!d || /^WPS/i.test(d) || /^(首页|新建|Home)$/.test(d)) return null;
    return { kind: 'wps', doc: d, ext: extOf(d), app: 'WPS' };
  }
  // IDE：VS Code "● file.ts - project - Visual Studio Code"；Cursor 同；JetBrains "project – file.py"
  if (CODE_PROCS.test(pr) || /\s[-—–]\s*(Visual Studio Code|Cursor|Windsurf|Trae)( - Insiders)?$/i.test(t)) {
    const s = t.replace(/^[●•]\s*/, '').replace(/\s*[-—–]\s*(Visual Studio Code|Cursor|Windsurf|Trae)( - Insiders)?$/i, '').replace(/\s*\[(管理员|Administrator|SSH: [^\]]+|WSL: [^\]]+|Dev Container[^\]]*)\]\s*/gi, ' ').replace(/\s*\((工作区|Workspace)\)/gi, '').trim();
    const parts = s.split(DASH).map(x => x.trim()).filter(Boolean);
    if (/^(idea64|pycharm64|webstorm64|goland64|clion64)$/.test(pr)) return { kind: 'code', project: parts[0] || '', doc: parts[parts.length - 1] || '', ext: extOf(parts[parts.length - 1]) };
    if (!parts.length || /^(欢迎|Welcome|Get Started|开始)$/i.test(parts[0])) return { kind: 'code', doc: '', project: parts[1] || '' };
    const doc = parts[0];
    return { kind: 'code', doc: /^(设置|Settings|扩展|Extension|Keyboard Shortcuts|键盘快捷方式)/i.test(doc) ? '' : doc, ext: extOf(doc), project: parts.length > 1 ? parts[parts.length - 1] : '', path: isAbs(doc) ? doc : undefined };
  }
  // 记事本 / Notepad++ / Typora / Obsidian
  if (TEXT_PROCS.test(pr) || /\s[-—–]\s*(记事本|Notepad\+\+|Notepad|Typora|Obsidian.*)$/i.test(t)) {
    let s = t.replace(/^\*\s*/, '').replace(/\s*[-—–]\s*(记事本|Notepad\+\+|Notepad|Typora|Obsidian v[\d.]+|Obsidian)$/i, '').replace(/\s*\[(管理员|Administrator)\]$/, '').trim();
    if (pr === 'obsidian') { const p2 = s.split(DASH); return { kind: 'text', doc: p2[0].trim(), project: (p2[1] || '').trim(), ext: extOf(p2[0]) || 'md' }; }
    if (/^(无标题|Untitled|new \d+)$/i.test(s)) return { kind: 'text', doc: '', unsaved: true };
    return { kind: 'text', doc: isAbs(s) ? s.split(/[\\/]/).pop() : s, path: isAbs(s) ? s : undefined, ext: extOf(s) };
  }
  // PDF 阅读器
  if (PDF_PROCS.test(pr) || /\s[-—–]\s*(Adobe Acrobat.*|Foxit.*|SumatraPDF|福昕.*|WPS PDF)$/i.test(t)) {
    const s = t.replace(/\s*[-—–]\s*(Adobe Acrobat.*|Foxit.*|SumatraPDF|福昕.*|WPS PDF)$/i, '').replace(/\s*\(\s*(SECURED|已加密)\s*\)/i, '').trim();
    if (!s) return null;
    return { kind: 'pdf', doc: isAbs(s) ? s.split(/[\\/]/).pop() : s, path: isAbs(s) ? s : undefined, ext: 'pdf' };
  }
  // 资源管理器：标题即文件夹名（开启"标题栏显示完整路径"时是绝对路径）
  if (pr === 'explorer') {
    if (!t || /^(Program Manager|任务视图)$/i.test(t)) return null;
    return { kind: 'explorer', doc: isAbs(t) ? t.split(/[\\/]/).filter(Boolean).pop() : t.replace(/\s*[-—–]\s*(文件资源管理器|File Explorer)$/i, ''), path: isAbs(t) ? t : undefined, folder: true };
  }
  // 聊天：微信主窗口标题固定为"微信"，独立聊天窗口标题是会话名
  if (CHAT_PROCS.test(pr)) {
    const generic = /^(微信|WeChat|企业微信|WXWork|QQ|钉钉|DingTalk|飞书|Feishu|Lark|Telegram|Slack|Microsoft Teams|Teams)$/i;
    const s = t.replace(/\s*[-—–|]\s*(微信|企业微信|钉钉|飞书|Slack|Microsoft Teams)$/i, '').trim();
    return { kind: 'chat', chat: generic.test(s) ? '' : s, doc: '' };
  }
  // 通用兜底：标题里带文件扩展名
  const m = /([^\\/:*?"<>|\-—–]{1,120}\.(docx?|xlsx?|pptx?|pdf|md|txt|csv|json|ya?ml|py|js|ts|java|go|rs|cpp|c|h|html?|xmind|vsdx))\b/i.exec(t);
  if (m) return { kind: 'file', doc: m[1].trim(), ext: m[2].toLowerCase() };
  return null;
}

/** 给时间线/摘要用的对象标签 */
function label(p) {
  if (!p) return '';
  if (p.kind === 'chat') return p.chat ? `会话「${p.chat}」` : '';
  if (p.kind === 'browser') return p.doc ? `在线文档「${p.doc}」` : (p.page || '');
  if (p.kind === 'explorer') return p.doc ? `文件夹「${p.doc}」` : '';
  return p.doc ? `「${p.doc}」` : '';
}

module.exports = { parseTitle, parseBrowser, label, extOf, isAbs };
