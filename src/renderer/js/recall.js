(function () {
  const mt = window.mindtrace; const $ = (id) => document.getElementById(id);
  if (new URLSearchParams(location.search).get('theme') === 'dark') document.body.classList.add('dark');
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const K = { web: ['网页', 'var(--web)'], file: ['文件', 'var(--file)'], conversation: ['会话', 'var(--conv)'], code: ['代码', 'var(--code)'], activity: ['活动', 'var(--act)'] };
  const SRC = { window: '窗口', browser: '浏览历史', uia: '界面文字', screenshot: '截图 OCR', document: '文档', clipboard: '复制', note: '笔记', ide: 'IDE', file: '最近文件', download: '下载' };
  const SUGG = ['昨天下午那个 PDF', '上周看的文章', '最近的会议纪要', '今天上午写的代码'];
  let items = [], sel = 0, seq = 0;
  const when = (t) => { const d = new Date(t), n = new Date(); const dd = Math.round((new Date(n.toDateString()) - new Date(d.toDateString())) / 864e5); const hm = d.toTimeString().slice(0, 5); return dd === 0 ? `今天 ${hm}` : dd === 1 ? `昨天 ${hm}` : dd < 7 ? `${dd} 天前` : `${d.getMonth() + 1}月${d.getDate()}日`; };
  const hl = (s, terms) => { let h = esc(s); for (const t of (terms || '').split(' ').filter(x => x.length > 1)) h = h.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), m => `<mark>${m}</mark>`); return h; };
  function render(r) {
    const p = r?.query || {};
    $('parse').innerHTML = [p.timeText && `<span>时间 <b>${esc(p.timeText)}</b></span>`, p.kind && `<span>类型 <b>${K[p.kind]?.[0] || p.kind}</b></span>`, p.ext && `<span>格式 <b>.${esc(p.ext)}</b></span>`, p.terms && `<span>关键词 <b>${esc(p.terms)}</b></span>`].filter(Boolean).join('');
    items = r?.results || []; sel = 0;
    if (!$('q').value.trim()) { $('list').innerHTML = `<div class="rc-empty"><b>用一句话找回任何看过、写过、聊过的东西</b>支持时间（昨天下午、上周）、类型（文章、PDF、微信）和关键词混合描述<div class="rc-sugg">${SUGG.map(s => `<button data-s="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`; document.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { $('q').value = b.dataset.s; search(); }); return; }
    if (!items.length) { $('list').innerHTML = `<div class="rc-empty"><b>没有找到匹配的内容</b>换个说法，或去掉时间限定再试试</div>`; return; }
    $('list').innerHTML = items.map((it, i) => { const [kn, kc] = K[it.kind] || K.activity; const sub = it.snippet || it.url || it.path || it.app || ''; return `<div class="rc-item ${i === sel ? 'sel' : ''}" data-i="${i}"><div class="rc-ic" style="--kc:${kc}">${kn}</div><div class="rc-main"><div class="rc-t">${hl(it.title, p.terms)}</div><div class="rc-s">${hl(sub, p.terms)}</div></div><div class="rc-m">${when(it.when)}<span class="src">${it.sources.map(s => SRC[s] || s).join(' · ')}${it.hits > 1 ? ` · ${it.hits} 次` : ''}</span></div></div>`; }).join('');
    document.querySelectorAll('.rc-item').forEach(el => { el.onclick = () => { sel = +el.dataset.i; open(false); }; });
  }
  function paint() { document.querySelectorAll('.rc-item').forEach((el, i) => el.classList.toggle('sel', i === sel)); document.querySelector('.rc-item.sel')?.scrollIntoView({ block: 'nearest' }); }
  let tmr = null;
  async function search() { const q = $('q').value; const my = ++seq; let r = null; if (q.trim()) { try { r = await mt.r24('recall', { q }); } catch (_) {} } if (my === seq) render(r); }
  async function open(inApp) { const it = items[sel]; if (!it) return; await mt.r24('recall-open', { url: it.url, path: it.path, activityId: it.activityId, inApp: inApp || (!it.url && !it.path) }); }
  $('q').addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(search, 120); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { mt.r24('recall-hide'); }
    else if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); paint(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); paint(); e.preventDefault(); }
    else if (e.key === 'Enter') { open(e.ctrlKey || e.metaKey); }
  });
  mt.onR24 && mt.onR24('recall-focus', () => { $('q').focus(); $('q').select(); });
  window.__recallSet = (q) => { $('q').value = q; return search(); };
  render(null); $('q').focus();
})();
