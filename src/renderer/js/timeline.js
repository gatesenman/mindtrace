/* 知迹 2.3.3 时间线：任务级会话 + 标题清洗 + 关键对象 + 日概览 + 竖轨时间线 + 详情面板 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtDur = (ms) => { if (!ms || ms < 1000) return ''; if (ms < 60000) return Math.round(ms / 1000) + ' 秒'; const m = Math.round(ms / 60000); return m < 60 ? m + ' 分钟' : `${Math.floor(m / 60)} 小时${m % 60 ? ' ' + (m % 60) + ' 分' : ''}`; };
  const fmtShort = (ms) => { const m = Math.round((ms || 0) / 60000); return m < 60 ? m + 'm' : `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}`; };
  const meta = (m) => { if (!m) return {}; if (typeof m === 'object') return m; try { return JSON.parse(m); } catch (_) { return {}; } };
  const isDemo = (a) => { const m = meta(a.meta); return !!(m.isDemo || m.demo); };
  const GAP = 5 * 60000, IDLE = 20 * 60000;
  const CHAT = /微信|wechat|weixin|^qq$|^tim$|飞书|lark|钉钉|dingtalk|slack|telegram|企业微信|wxwork|outlook|foxmail|邮件|mail/i;
  const MEET = /腾讯会议|wemeet|voov|zoom|teams|飞书会议|钉钉会议|webex|会议/i;
  const IDE = /code|cursor|idea|pycharm|webstorm|visual studio|sublime|vim|zed|android studio|windsurf|terminal|终端|powershell|windowsterminal/i;
  const BROWSER = /edge|chrome|firefox|safari|opera|brave|浏览器|arc/i;
  const DOCAPP = /word|excel|powerpoint|wps|winword|powerpnt|acrobat|pdf|notepad|记事本|obsidian|notion|typora|onenote|资源管理器|explorer|文档|xmind|visio/i;
  const IDLE_APP = /^(lockapp|logonui)$/i;
  const SYS = /^(shellexperiencehost|searchhost|searchapp|startmenuexperiencehost|textinputhost|applicationframehost)$/i;
  const GENERIC = /^(微信|wechat|图片和视频|聊天文件|搜索|新标签页|new tab|飞书|钉钉|qq|主页|home|文件传输助手|通讯录|朋友圈|收藏|设置)$/i;

  /* 类别：克制的企业色板（浅/深两套由 CSS 变量提供） */
  const CATS = { code: '编码', comm: '沟通', doc: '文档', web: '浏览研究', meet: '会议', other: '其他' };
  const CAT_ORDER = ['code', 'doc', 'web', 'comm', 'meet', 'other'];
  const LAYER_NAME = { focus: '注意力', content: '内容', authoring: '产出', artifact: '资源', communication: '沟通', context: '上下文' };
  const LAYER_ORDER = ['focus', 'content', 'authoring', 'artifact', 'communication', 'context'];
  function layerOf(a) {
    const m = meta(a.meta);
    if (m.layer && LAYER_NAME[m.layer]) return m.layer;
    if (a.type === 'ide' || a.type === 'note' || a.type === 'clipboard') return 'authoring';
    if (a.type === 'browser' || a.type === 'download' || a.type === 'file') return 'artifact';
    if (a.type === 'uia' || a.type === 'screenshot' || a.type === 'document') return CHAT.test(appOf(a)) ? 'communication' : 'content';
    if (a.type === 'window' && CHAT.test(appOf(a))) return 'communication';
    return 'focus';
  }

  /* ── 标题清洗 ── */
  const SUFFIX = [
    /\s+(?:和另外|and)\s*\d+\s*(?:个页面|more pages?)/i,
    /\s*[-–—|]\s*(?:个人|工作|personal|work|InPrivate)?\s*[-–—|]?\s*Microsoft[\s\u200b]*Edge.*$/i,
    /\s*[-–—|]\s*(?:Google Chrome|Mozilla Firefox|Firefox|Brave|Opera)\s*$/i,
    /\s*[-–—]\s*(?:Visual Studio Code|VS Code|Cursor|Windsurf)(?:\s*\[[^\]]*\])?\s*$/i,
    /\s*[-–—]\s*(?:Word|Excel|PowerPoint|OneNote|Outlook|WPS\s*\S*|记事本|Notepad|Adobe Acrobat.*|Obsidian.*|Typora)\s*$/i,
    /\s*[-–—]\s*(?:兼容模式|Compatibility Mode|只读|Read-Only|受保护的视图|Protected View)\s*$/i,
  ];
  function cleanTitle(title, app) {
    let t = String(title || '').replace(/[\u200b\u200e\u200f]/g, '').trim();
    if (!t) return '';
    let prev;
    do { prev = t; for (const r of SUFFIX) t = t.replace(r, '').trim(); } while (t !== prev);
    t = t.replace(/^[●•*]\s*/, '')                       // VS Code 未保存标记
      .replace(/^\(\d+\+?\)\s*/, '').replace(/^\[\d+\+?\]\s*/, '') // (3) 知乎
      .replace(/\s*[(（]\d+\+?[)）]\s*$/, '')            // 产品研发群(5)
      .replace(/\s*[-–—|]\s*$/, '').trim();
    if (app && t.toLowerCase() === String(app).toLowerCase()) return '';
    return t;
  }
  const host = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch (_) { return ''; } };
  const base = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || p;
  /* VS Code: "file.ts - project"；Office: 文件名本身 */
  function parseCode(t) { const p = t.split(/\s+[—–-]\s+/); return { file: p[0] || '', project: p.length > 1 ? p[p.length - 1] : '' }; }
  const SITE = { 'github.com': 'GitHub', 'zhihu.com': '知乎', 'electronjs.org': 'Electron', 'api-docs.deepseek.com': 'DeepSeek 文档', 'stackoverflow.com': 'Stack Overflow', 'bilibili.com': 'B站', 'baidu.com': '百度', 'bing.com': '必应', 'google.com': 'Google', 'mp.weixin.qq.com': '微信公众号', 'juejin.cn': '掘金', 'csdn.net': 'CSDN' };
  const siteName = (h) => SITE[h] || SITE[h.split('.').slice(-2).join('.')] || h;

  function appOf(a) { const m = meta(a.meta); return (a.app_name || m.sourceApp || '').trim() || ({ clipboard: '剪贴板', note: '笔记', ide: 'IDE', download: '下载' }[a.type] || '其他'); }
  function catOf(a, app) {
    if (a.type === 'ide') return 'code';
    if (a.type === 'note' || a.type === 'document') return 'doc';
    if (MEET.test(app)) return 'meet';
    if (CHAT.test(app)) return 'comm';
    if (IDE.test(app)) return 'code';
    if (a.url || a.type === 'browser' || BROWSER.test(app)) return 'web';
    if (DOCAPP.test(app) || DOCAPP.test(a.process_name || '')) return 'doc';
    return 'other';
  }
  const ATTACH = new Set(['clipboard', 'download', 'uia', 'screenshot']);

  /* ── 任务级会话：连续同类活动（≤5 分钟间隔）合并；剪贴板/下载等依附当前任务 ── */
  function toBlocks(items, opts = {}) {
    const flat = [];
    for (const it of items) { if (it.type === 'session' && it.items) flat.push(...it.items); else flat.push(it); }
    flat.sort((a, b) => a.started_at - b.started_at);
    const blocks = []; const idles = []; let cur = null;
    for (const a of flat) {
      const app = appOf(a); const proc = String(a.process_name || '').replace(/\.exe$/i, '');
      const end = Number(a.ended_at || 0) || (a.started_at + Number(a.duration_ms || 0));
      if (IDLE_APP.test(proc) || IDLE_APP.test(app)) { idles.push({ start: a.started_at, end }); continue; }
      if (SYS.test(proc)) continue;
      const cat = catOf(a, app);
      const near = cur && a.started_at - cur.end <= GAP;
      const lone = a.type === 'ide';
      if (near && !lone && !cur.lone && (cur.cat === cat || ATTACH.has(a.type))) { cur.items.push(a); cur.end = Math.max(cur.end, end); continue; }
      cur = { id: 'b-' + a.id, cat, start: a.started_at, end: Math.max(end, a.started_at), items: [a], lone };
      blocks.push(cur);
    }
    for (const b of blocks) enrich(b);
    if (opts.withIdle) return { blocks, idles };
    return blocks;
  }
  function enrich(b) {
    const apps = {}; let win = 0;
    b.types = {};
    for (const i of b.items) {
      b.types[i.type] = (b.types[i.type] || 0) + 1;
      const d = i.type === 'window' ? Number(i.duration_ms || 0) : 0; win += d;
      const ap = appOf(i); if (!ATTACH.has(i.type) || !apps[ap]) apps[ap] = (apps[ap] || 0) + d;
    }
    b.apps = Object.entries(apps).sort((x, y) => y[1] - x[1]).map(([k]) => k);
    b.app = b.apps[0] || appOf(b.items[0]);
    const first = b.items.find(i => appOf(i) === b.app) || b.items[0];
    b.process = first.process_name || meta(first.meta).process || ''; b.exe = meta(first.meta).exe || '';
    b.dur = win || (b.end - b.start);
    b.titles = [...new Set(b.items.filter(i => !ATTACH.has(i.type) && i.type !== 'ide').map(i => cleanTitle(i.window_title, appOf(i))).filter(Boolean))];
    b.urls = [...new Set(b.items.map(i => i.url).filter(Boolean))];
    b.paths = [...new Set(b.items.map(i => i.file_path).filter(Boolean))];
    b.hosts = [...new Set(b.urls.map(host).filter(Boolean))];
    // 关键对象：文件 / 项目 / 站点 / 联系人
    const files = [], projects = [], people = [];
    for (const i of b.items) {
      const ap = appOf(i), t = cleanTitle(i.window_title, ap); if (!t || ATTACH.has(i.type)) continue;
      if (IDE.test(ap) && i.type === 'window') { const c = parseCode(t); if (c.file) files.push(c.file); if (c.project) projects.push(c.project); }
      else if (CHAT.test(ap) && i.type === 'window' && !GENERIC.test(t)) people.push(t);
      else if (DOCAPP.test(ap) && /\.[a-z0-9]{2,5}$/i.test(t)) files.push(t);
    }
    // 2.4.8：采集端已按应用解析出文档/会话对象（meta.doc），优先使用
    for (const i of b.items) {
      const d = meta(i.meta).doc; if (!d || !d.name) continue;
      if (d.kind === 'chat') people.push(d.name);
      else if (d.kind === 'code') { files.push(d.name); if (d.project) projects.push(d.project); }
      else if (d.kind !== 'explorer' && d.kind !== 'browser') files.push(d.name);
      else if (d.kind === 'browser' && d.cloud) files.push(d.name);
    }
    for (const p of b.paths) if (!/\.(png|jpe?g|lnk)$/i.test(p)) files.push(base(p));
    b.snippet = '';
    for (const i of b.items) { if (i.type === 'clipboard' || i.type === 'ide' || i.type === 'download' || !i.content) continue; const c = String(i.content).replace(/\s+/g, ' ').trim(); if (c.length >= 12) { b.snippet = c.slice(0, 140); break; } }
    b.files = [...new Set(files)]; b.projects = [...new Set(projects)]; b.people = [...new Set(people)];
    b.kind = b.lone ? 'ide' : b.cat; // 兼容旧选择器
    b.demo = b.items.some(isDemo);
    b.low = b.items.every(i => i._low);
    b.summary = summarize(b);
  }
  const list3 = (arr, n = 2, unit = '个') => arr.length ? arr.slice(0, n).join('、') + (arr.length > n ? ` 等 ${arr.length} ${unit}` : '') : '';

  /* ── 规则标题（AI 可覆盖）：说清"在做什么、对象是什么" ── */
  function summarize(b) {
    const a = b.items[0]; const m = meta(a.meta); const mins = b.dur >= 60000 ? ` ${Math.round(b.dur / 60000)} 分钟` : '';
    if (b.lone) { const ws = (m.workspaces || []).length, cm = m.commitCount || 0; return `代码进展：${ws} 个工作区${cm ? `，今日 ${cm} 次提交` : ''}`; }
    if (b.items.length === 1 && a.type === 'clipboard') { const c = String(a.content || '').replace(/\s+/g, ' '); return `从 ${b.app} 复制：${c.slice(0, 36)}${c.length > 36 ? '…' : ''}`; }
    if (b.items.every(i => i.type === 'download')) return `下载 ${list3(b.files, 2, '个文件')}`;
    switch (b.cat) {
      case 'code': return b.files.length ? `在 ${b.app} 编辑 ${list3(b.files, 2, '个文件')}` : `在 ${b.app} 编码`;
      case 'comm': return b.people.length ? `${b.app} · 与 ${list3(b.people, 2, '个会话')} 沟通` : `${b.app} · 处理消息`;
      case 'meet': return `${b.app} · ${b.titles[0] || '在线会议'}`;
      case 'web': {
        const n = b.urls.length || b.titles.length || 1;
        const t = (b.titles[0] || b.hosts[0] || '').replace(/\s*[-|·]\s*(GitHub|知乎|Electron)$/, '');
        const cloud = b.files.filter(Boolean);
        if (cloud.length) return `在线文档：${list3(cloud, 2, '个文档')}`;
        return n > 1 ? `浏览 ${n} 个页面：${t}${b.titles.length > 1 ? ' 等' : ''}` : `浏览：${t || '网页'}`;
      }
      case 'doc': {
        const exp = b.items.every(i => /资源管理器|explorer/i.test(appOf(i)) || ATTACH.has(i.type));
        if (exp) return b.titles.length ? `在资源管理器打开「${b.titles[0]}」${b.titles.length > 1 ? ` 等 ${b.titles.length} 个文件夹` : ''}` : '在资源管理器浏览文件';
        if (b.types.note) return `记录笔记：${(a.window_title || a.content || '').slice(0, 30)}`;
        const f = b.files.filter(x => !/^(下载|产品文档)$/.test(x));
        const da = b.apps.filter(x => !/资源管理器|explorer|^文档$/i.test(x))[0];
        return f.length ? (da ? `在 ${da} 编辑 ${list3(f, 2, '个文件')}` : `打开 ${list3(f, 2, '个文件')}`) : `查看文档 ${b.titles[0] || ''}`;
      }
      default: if (b.files.length) return `在 ${b.app} 处理 ${list3(b.files, 2, '个文档')}`;
        return b.titles.length > 1 ? `使用 ${b.app}：${list3(b.titles, 2, '个窗口')}` : `使用 ${b.app}${b.titles[0] ? ' · ' + b.titles[0] : ''}`;
    }
  }

  /* ── 日概览 ── */
  function overview(blocks, idles) {
    const byCat = {}, byApp = {}, byProj = {}; let active = 0, focus = 0, longest = 0;
    for (const b of blocks) {
      const d = b.lone ? 0 : b.dur; active += d;
      byCat[b.cat] = (byCat[b.cat] || 0) + d; byApp[b.app] = (byApp[b.app] || 0) + d;
      for (const p of b.projects) byProj[p] = (byProj[p] || 0) + d / b.projects.length;
      if ((b.cat === 'code' || b.cat === 'doc' || b.cat === 'meet') && d >= 15 * 60000) focus += d;
      longest = Math.max(longest, d);
    }
    const idle = idles.reduce((s, i) => s + (i.end - i.start), 0);
    return { active, focus, longest, idle, byCat, apps: Object.entries(byApp).filter(([, v]) => v >= 60000).sort((x, y) => y[1] - x[1]).slice(0, 5), projects: Object.entries(byProj).sort((x, y) => y[1] - x[1]).slice(0, 3), count: blocks.length };
  }
  /* ── 图标：真实图标优先；回退为中性字母徽标（不再彩虹色） ── */
  const svg = (d, s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const I = { file: 'M6 3h9l4 4v14H6zM14 3v5h5', web: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18', user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0', proj: 'M3 7h7l2 2h9v10H3z', code: 'M9 8l-4 4 4 4M15 8l4 4-4 4', clip: 'M8 4h8v3H8zM6 6h12v15H6z', dl: 'M12 4v11M7 10l5 5 5-5M5 20h14', commit: 'M12 9a3 3 0 100 6 3 3 0 000-6zM3 12h6M15 12h6' };
  let iconCache = {}; let aiCache = {}; let state = { blocks: [], sel: null };
  const pref = () => localStorage.getItem('tl-density') || 'comfortable';
  const iconKey = (b) => b.cat === 'web' && b.urls[0] ? 'u:' + host(b.urls[0]) : 'a:' + (b.exe || b.process || b.app).toLowerCase();
  function iconHtml(b, cls = 'tlf-ico') {
    const k = iconKey(b); const src = iconCache[k];
    const letter = esc((b.app || '?').replace(/^[^\p{L}\p{N}]+/u, '').slice(0, 1).toUpperCase() || '?');
    return `<span class="${cls}" data-ik="${esc(k)}">${src ? `<img src="${src}" alt="" />` : b.lone ? svg(I.code, 12) : `<span>${letter}</span>`}</span>`;
  }
  async function loadIcons(blocks) {
    const want = []; const seen = new Set();
    for (const b of blocks) { const k = iconKey(b); if (k in iconCache || seen.has(k)) continue; seen.add(k); want.push(b.cat === 'web' && b.urls[0] ? { k, url: b.urls[0] } : { k, exe: b.exe, process: b.process }); }
    if (!want.length || !window.mindtrace || !window.mindtrace.tl) return;
    try { const r = await window.mindtrace.tl('icons', want); Object.assign(iconCache, r); } catch (_) { want.forEach(w => iconCache[w.k] = ''); }
    document.querySelectorAll('[data-ik]').forEach(el => { const s = iconCache[el.dataset.ik]; if (s && !el.querySelector('img')) el.innerHTML = `<img src="${s}" alt="" />`; });
  }
  const objChip = (ic, label, attr = '', title = '') => `<${attr ? 'a' : 'span'} class="tlf-obj${attr ? ' tlf-link' : ''}" ${attr} title="${esc(title || label)}">${svg(ic, 12)}<span>${esc(label)}</span></${attr ? 'a' : 'span'}>`;
  function objects(b, max = 3) {
    const out = [];
    for (const p of b.projects.slice(0, 1)) out.push(objChip(I.proj, p));
    for (const f of b.files.slice(0, 3)) { const p = b.paths.find(x => base(x) === f); out.push(objChip(I.file, f, p ? `data-path="${esc(p)}"` : '', p || f)); }
    for (const h of b.hosts.slice(0, 3)) { const u = b.urls.find(x => host(x) === h); out.push(objChip(I.web, siteName(h), `data-url="${esc(u)}"`, u)); }
    for (const p of b.people.slice(0, 3)) out.push(objChip(I.user, p));
    const extra = out.length - max;
    return out.slice(0, max).join('') + (extra > 0 ? `<span class="tlf-obj more">+${extra}</span>` : '');
  }
  function rawRow(i) {
    const link = i.url ? `<a class="tlf-link" data-url="${esc(i.url)}" title="在浏览器打开">${esc(host(i.url) || i.url)}</a>` : i.file_path ? `<a class="tlf-link" data-path="${esc(i.file_path)}" title="在资源管理器中显示">${esc(base(i.file_path))}</a>` : '';
    const label = { window: '窗口', browser: '网页', document: '文档', clipboard: '复制', screenshot: '截屏', ide: '代码', note: '笔记', uia: '界面文本', download: '下载', file: '文件' }[i.type] || i.type;
    return `<div class="tlf-raw-row"><span class="t">${hm(i.started_at)}</span><span class="k">${label}</span><span class="x">${esc(cleanTitle(i.window_title, appOf(i)) || String(i.content || '').slice(0, 80) || appOf(i))}</span>${link}<span class="d">${i.duration_ms >= 1000 ? fmtShort(i.duration_ms) : ''}</span>${i._low ? `<span class="tlf-low">${esc(i._low)}</span>` : ''}</div>`;
  }
  function ideHtml(a) {
    const m = meta(a.meta);
    const ws = (m.recent || (m.workspaces || []).map(p => ({ path: p }))).slice(0, 4);
    const cm = (m.commits || []).slice(0, 4);
    if (!ws.length && !cm.length) return '';
    return `<div class="tlf-ide">${cm.map(c => `<div class="r">${svg(I.commit, 12)}<code>${esc(String(c.hash || '').slice(0, 7))}</code><span>${esc(c.subject || '')}</span></div>`).join('')}
      ${ws.length ? `<div class="r ws">${ws.map(w => `<a class="tlf-obj tlf-link" data-path="${esc(w.path)}" title="${esc(w.path)}">${svg(I.proj, 12)}<span>${esc(base(w.path))}</span></a>`).join('')}</div>` : ''}</div>`;
  }
  function blockHtml(b, maxDur) {
    const sum = aiCache[b.id] || b.summary;
    const appsLine = b.apps.slice(0, 3).join(' · ');
    const h = Math.round(Math.min(1, Math.sqrt(b.dur / maxDur)) * 100);
    return `<article class="tlf-block c-${b.cat} l-${b.layer || 'focus'}${b.low ? ' low' : ''}${state.sel === b.id ? ' sel' : ''}" data-bid="${esc(b.id)}" data-h="${new Date(b.start).getHours()}" id="act-${esc(b.items[0].id)}" tabindex="0" aria-label="${esc(hm(b.start) + ' ' + sum)}">
      <div class="tlf-time"><b>${hm(b.start)}</b>${b.end - b.start >= 60000 ? `<span>${hm(b.end)}</span>` : ''}</div>
      <div class="tlf-rail" aria-hidden="true"><i class="dot"></i><i class="seg" style="--seg:${h}%"></i></div>
      <div class="tlf-main">
        <div class="tlf-l1"><span class="tlf-sum${aiCache[b.id] ? ' ai' : ''}" title="${esc(sum)}">${esc(sum)}</span>${b.demo ? '<span class="demo-tag">示例</span>' : ''}${b.dur >= 60000 && !b.lone ? `<span class="tlf-dur">${fmtShort(b.dur)}</span>` : ''}</div>
        <div class="tlf-l2">${iconHtml(b, 'tlf-ico sm')}<span class="tlf-app">${esc(appsLine)}</span><span class="tlf-layer l-${b.layer || 'focus'}">${LAYER_NAME[b.layer] || LAYER_NAME.focus}</span><span class="tlf-cat">${CATS[b.cat]}</span>${b.lone ? '' : objects(b)}</div>
        ${b.snippet && !b.lone ? `<div class="tlf-snip" title="${esc(b.snippet)}">${esc(b.snippet)}${b.snippet.length >= 140 ? '…' : ''}</div>` : ''}
        ${b.lone ? ideHtml(b.items[0]) : ''}
      </div>
      <div class="tlf-actions" role="toolbar" aria-label="操作">
        <button class="tlf-act" data-act="kb" title="加入知识库">${svg('M12 5v14M5 12h14')}</button>
        <button class="tlf-act" data-act="copy" title="复制">${svg('M9 9h11v11H9zM5 15V4h11')}</button>
        <button class="tlf-act" data-act="ignore" title="忽略此来源">${svg('M4 4l16 16M10.6 5.1A9 9 0 0121 12a9.6 9.6 0 01-2.2 3.2M6.6 6.6A9.6 9.6 0 003 12a9 9 0 0012.4 5.4')}</button>
      </div>
    </article>`;
  }
  function overviewHtml(o, day, blocks = []) {
    const segs = CAT_ORDER.filter(c => o.byCat[c] > 0).map(c => ({ c, v: o.byCat[c], p: o.byCat[c] / (o.active || 1) }));
    const byL = {}; for (const b of blocks) { byL[b.layer || 'focus'] = (byL[b.layer || 'focus'] || 0) + b.dur; }
    const lsegs = LAYER_ORDER.filter(L => byL[L] > 0).map(L => ({ L, v: byL[L], p: byL[L] / (o.active || 1) }));
    const maxApp = o.apps[0] ? o.apps[0][1] : 1;
    const stat = (label, v, sub = '') => `<div class="tlo-stat"><div class="l">${label}</div><div class="v">${v}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
    return `<div class="tlo card">
      <div class="tlo-top">
        <div class="tlo-title"><b>${day}</b><span>活动概览</span></div>
        <div class="tlo-stats">${stat('活跃时长', fmtShort(o.active))}${stat('深度专注', fmtShort(o.focus), o.active ? Math.round(o.focus / o.active * 100) + '%' : '')}${stat('最长连续', fmtShort(o.longest))}${stat('任务段', o.count)}${o.idle ? stat('离开', fmtShort(o.idle)) : ''}</div>
      </div>
      <div class="tlo-bar" role="img" aria-label="信号层分布">${(lsegs.length ? lsegs : segs).map(s => s.L ? `<i class="l-${s.L}" style="flex:${s.v};background:var(--tl-${s.L})" title="${LAYER_NAME[s.L]} ${fmtShort(s.v)}"></i>` : `<i class="c-${s.c}" style="flex:${s.v}" title="${CATS[s.c]} ${fmtShort(s.v)}"></i>`).join('')}</div>
      <div class="tlo-legend">${(lsegs.length ? lsegs.map(s => `<span class="l-${s.L}" style="--tl:var(--tl-${s.L})"><i style="background:var(--tl)"></i>${LAYER_NAME[s.L]}<b>${fmtShort(s.v)}</b><em>${Math.round(s.p * 100)}%</em></span>`) : segs.map(s => `<span class="c-${s.c}"><i></i>${CATS[s.c]}<b>${fmtShort(s.v)}</b><em>${Math.round(s.p * 100)}%</em></span>`)).join('')}</div>
      <div class="tlo-grid">
        <div><div class="cap">常用应用</div>${o.apps.map(([k, v]) => `<div class="tlo-row"><span class="n">${esc(k)}</span><span class="b"><i style="width:${Math.round(v / maxApp * 100)}%"></i></span><span class="d">${fmtShort(v)}</span></div>`).join('') || '<div class="tiny muted">—</div>'}</div>
        <div><div class="cap">项目</div>${o.projects.map(([k, v]) => `<div class="tlo-row"><span class="n">${svg(I.proj, 12)} ${esc(k)}</span><span class="d">${fmtShort(v)}</span></div>`).join('') || '<div class="tiny muted">暂未识别到项目</div>'}</div>
      </div>
    </div>`;
  }
  const period = (h) => h < 6 ? '凌晨' : h < 12 ? '上午' : h < 14 ? '中午' : h < 18 ? '下午' : '晚上';

  function ensureLayout() {
    const list = $('timeline-list');
    if (!list.parentElement.classList.contains('tlf-wrap')) {
      const wrap = document.createElement('div'); wrap.className = 'tlf-wrap';
      list.parentElement.insertBefore(wrap, list); wrap.appendChild(list);
      const aside = document.createElement('aside'); aside.id = 'tl-detail'; aside.className = 'tlf-detail card hidden'; aside.setAttribute('aria-label', '活动详情');
      wrap.appendChild(aside);
    }
    if (!$('tl-overview')) { const ov = document.createElement('div'); ov.id = 'tl-overview'; const anchor = $('tl-scrubber') || list.parentElement; anchor.parentElement.insertBefore(ov, anchor); }
    if (!$('tl-density')) {
      const anchor = $('tl-hide-low')?.closest('label');
      if (anchor) anchor.insertAdjacentHTML('afterend', `<div class="seg-toggle" id="tl-density" role="group" aria-label="显示密度"><button data-d="comfortable" title="舒适">舒适</button><button data-d="compact" title="紧凑">紧凑</button></div>`);
      $('tl-density')?.addEventListener('click', (e) => { const d = e.target.closest('button')?.dataset.d; if (!d) return; localStorage.setItem('tl-density', d); applyDensity(); });
    }
    applyDensity();
  }
  function applyDensity() { const d = pref(); $('timeline-list').classList.toggle('compact', d === 'compact'); document.querySelectorAll('#tl-density button').forEach(b => b.classList.toggle('on', b.dataset.d === d)); }

  function render(items, opts = {}) {
    ensureLayout();
    const list = $('timeline-list'); list.classList.add('tlf');
    const { blocks: rawBlocks, idles } = toBlocks(items, { withIdle: true });
    const blocks = annotateLayers(rawBlocks);
    state.blocks = blocks;
    const ov = $('tl-overview');
    if (!blocks.length) { if (ov) ov.innerHTML = ''; list.innerHTML = `<div class="tlf-empty"><div class="ill">${svg('M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2', 28)}</div><b>这段时间还没有活动</b><span>开启采集项后，知迹会把你的电脑活动整理成按任务划分的时间线。也可以关闭「隐藏低价值事件」查看全部原始记录。</span></div>`; return; }
    const d0 = new Date(blocks[0].start); const same = blocks.every(b => new Date(b.start).toDateString() === d0.toDateString());
    if (ov) ov.innerHTML = overviewHtml(overview(blocks, idles), same ? `${d0.getMonth() + 1} 月 ${d0.getDate()} 日 · 周${'日一二三四五六'[d0.getDay()]}` : `${blocks.length} 段活动`, blocks);
    const maxDur = Math.max(30 * 60000, ...blocks.map(b => b.dur));
    const rev = [...blocks].reverse(); let html = '', lastP = '', lastDay = '';
    for (let k = 0; k < rev.length; k++) {
      const b = rev[k]; const d = new Date(b.start);
      const ds = d.toDateString(); if (!same && ds !== lastDay) { html += `<div class="tlf-day">${d.getMonth() + 1} 月 ${d.getDate()} 日</div>`; lastDay = ds; lastP = ''; }
      const p = period(d.getHours()); if (p !== lastP) { html += `<div class="tlf-period"><b>${p}</b></div>`; lastP = p; }
      html += blockHtml(b, maxDur);
      const older = rev[k + 1];
      if (older && b.start - older.end >= IDLE) {
        const lock = idles.some(i => i.start < b.start && i.end > older.end);
        html += `<div class="tlf-gap"><span>${lock ? '离开 / 锁屏' : '无活动'} · ${fmtShort(b.start - older.end)}</span></div>`;
      }
    }
    list.innerHTML = html;
    loadIcons(blocks);
    aiSummaries(blocks);
    if (opts.focusId) { const el = document.getElementById('act-' + opts.focusId) || [...list.querySelectorAll('.tlf-block')].find(x => state.blocks.find(b => b.id === x.dataset.bid)?.items.some(i => i.id === opts.focusId)); if (el) { el.classList.add('highlight'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }
  }
  async function aiSummaries(blocks) {
    if (!window.mindtrace || !window.mindtrace.tl) return;
    const cand = blocks.filter(b => b.items.length > 2 && !b.lone && !aiCache[b.id]).slice(0, 20).map(b => ({ id: b.id, app: b.apps.join('/'), type: CATS[b.cat], minutes: Math.round(b.dur / 60000), titles: b.titles.slice(0, 12), docs: b.files.slice(0, 8), snippet: b.snippet || '' }));
    if (!cand.length) return;
    try { const r = await window.mindtrace.tl('ai-summary', cand); Object.assign(aiCache, r || {}); for (const [id, s] of Object.entries(r || {})) { const el = document.querySelector(`.tlf-block[data-bid="${CSS.escape(id)}"] .tlf-sum`); if (el) { el.textContent = s; el.classList.add('ai'); el.title = 'AI 摘要'; } } } catch (_) {}
  }

  /* ── 详情面板 ── */
  async function openDetail(b) {
    state.sel = b.id;
    document.querySelectorAll('.tlf-block').forEach(x => x.classList.toggle('sel', x.dataset.bid === b.id));
    const aside = $('tl-detail'); aside.classList.remove('hidden'); $('timeline-list').parentElement.classList.add('open');
    const sec = (t, arr, ic) => arr.length ? `<div class="tlf-d-objs"><div class="cap">${t}</div>${arr.map(x => `<div class="r">${svg(ic, 12)}<span>${esc(x)}</span></div>`).join('')}</div>` : '';
    aside.innerHTML = `<div class="tlf-d-head c-${b.cat}">${iconHtml(b)}<div><div class="tlf-d-cat"><i></i>${CATS[b.cat]}</div><div class="tiny muted">${hm(b.start)}–${hm(b.end)} · ${fmtDur(b.dur) || '瞬时'} · ${b.items.length} 条事件</div></div><button class="tlf-act" data-act="close" title="关闭 (Esc)">${svg('M6 6l12 12M18 6L6 18')}</button></div>
      <div class="tlf-d-sum">${esc(aiCache[b.id] || b.summary)}</div>
      <div class="tlf-d-grid">${sec('应用', b.apps, I.proj)}${sec('文件', b.files, I.file)}${sec('网站', b.hosts.map(siteName), I.web)}${sec('联系人 / 会话', b.people, I.user)}${sec('窗口', b.titles.slice(0, 8), I.file)}</div>
      <div class="tlf-d-body"><div class="muted tiny">加载中…</div></div>`;
    let d = { acts: b.items, shots: [], entities: [] };
    try { d = await window.mindtrace.tl('detail', { ids: b.items.map(i => i.id).filter(id => !String(id).startsWith('sess-')), from: b.start, to: b.end }); } catch (_) {}
    if (state.sel !== b.id) return;
    const acts = d.acts && d.acts.length ? d.acts : b.items;
    aside.querySelector('.tlf-d-body').innerHTML = `
      <h4>原始事件 <span>${acts.length}</span></h4><div class="tlf-d-raw">${acts.map(i => rawRow(i) + (i.content && i.type !== 'ide' ? `<pre class="tlf-pre">${esc(String(i.content).slice(0, 1200))}</pre>` : '')).join('')}</div>
      <h4>截屏与识别文本</h4>${(d.shots || []).length ? d.shots.map(s => `<div class="tlf-shot"><div class="tiny muted">${hm(s.taken_at)} · ${esc(s.window_title || '')}</div>${s.description ? `<div>${esc(s.description)}</div>` : ''}${s.ocr_text ? `<pre class="tlf-pre">${esc(String(s.ocr_text).slice(0, 800))}</pre>` : ''}</div>`).join('') : '<div class="tiny muted">此时段没有截屏（截屏采集默认关闭）。</div>'}
      <h4>相关知识实体</h4>${(d.entities || []).length ? `<div class="tlf-ents">${d.entities.map(e => `<button class="tlf-ent" data-eid="${esc(e.id)}">${esc(e.name)}<span>${esc(e.type || '')}</span></button>`).join('')}</div>` : '<div class="tiny muted">暂无匹配的知识库实体。</div>'}`;
  }
  function closeDetail() { state.sel = null; $('tl-detail')?.classList.add('hidden'); $('timeline-list')?.parentElement.classList.remove('open'); document.querySelectorAll('.tlf-block.sel').forEach(x => x.classList.remove('sel')); }

  /* ── 交互 ── */
  document.addEventListener('click', async (e) => {
    const link = e.target.closest('.tlf-link');
    if (link) { e.preventDefault(); e.stopPropagation(); const r = await window.mindtrace.tl('open', link.dataset.url ? { url: link.dataset.url } : { path: link.dataset.path }); if (r && r.error && window.toast) window.toast(r.error); return; }
    const ent = e.target.closest('.tlf-ent');
    if (ent) { if (window.MTV23 && window.MTV23.KB) window.MTV23.KB.sel = ent.dataset.eid; window.showView && window.showView('kb'); return; }
    const act = e.target.closest('.tlf-act');
    const blockEl = e.target.closest('.tlf-block');
    if (act && act.dataset.act === 'close') { closeDetail(); return; }
    if (!blockEl || !blockEl.closest('#timeline-list')) return;
    const b = state.blocks.find(x => x.id === blockEl.dataset.bid); if (!b) return;
    if (act) {
      e.stopPropagation();
      const text = `${hm(b.start)}–${hm(b.end)} [${CATS[b.cat]}] ${aiCache[b.id] || b.summary}\n` + b.items.map(i => `- ${hm(i.started_at)} ${appOf(i)} ${cleanTitle(i.window_title, appOf(i))} ${i.url || i.file_path || ''} ${i.type === 'clipboard' || i.type === 'uia' ? String(i.content || '').slice(0, 300) : ''}`.trim()).join('\n');
      if (act.dataset.act === 'copy') { await navigator.clipboard.writeText(text).catch(() => {}); window.toast && window.toast('已复制到剪贴板'); }
      if (act.dataset.act === 'kb') { const r = await window.mindtrace.tl('add-kb', { title: `${aiCache[b.id] || b.summary}`.slice(0, 80), text }); window.toast && window.toast(r.ok ? '已加入知识库（作为我的笔记）' : '加入失败'); }
      if (act.dataset.act === 'ignore') {
        if (!confirm(`以后不再记录「${b.app}」？\n可在 设置 → 隐私 → 应用黑名单 中恢复。`)) return;
        const r = await window.mindtrace.tl('ignore-source', { app: b.app });
        if (r.ok) { window.toast && window.toast(`已忽略「${b.app}」，之后不再采集`); }
      }
      return;
    }
    openDetail(b);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.sel) closeDetail();
    if (e.key === 'Enter' && document.activeElement?.classList.contains('tlf-block')) document.activeElement.click();
  });
  function jumpToHour(h) {
    const els = [...document.querySelectorAll('.tlf-block[data-h]')];
    const ex = els.filter(s => Number(s.dataset.h) === h); const el = ex[ex.length - 1] || els.find(s => Number(s.dataset.h) < h) || els[els.length - 1];
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('highlight'); setTimeout(() => el.classList.remove('highlight'), 1600); }
  }
  function annotateLayers(blocks) {
    for (const b of blocks) {
      const votes = {};
      for (const a of b.items) { const L = layerOf(a); votes[L] = (votes[L] || 0) + 1; }
      b.layer = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] || 'focus';
      b.ctx = [...new Set(b.items.flatMap(a => { try { const m = meta(a.meta); return m.ctx || []; } catch (_) { return []; } }))];
    }
    return blocks;
  }
  window.TLFeed = { render, toBlocks, summarize, cleanTitle, overview, jumpToHour, closeDetail, layerOf, annotateLayers, LAYER_NAME };
})();
