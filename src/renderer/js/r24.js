// 知迹 2.4 渲染层：出网账本 / 本地 OCR 状态（R1）
(function () {
  const mt = window.mindtrace; if (!mt || !mt.r24) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PURPOSE = { 'llm:chat': 'AI 问答', 'llm:extract': 'AI 抽取', 'llm:vision': '云端识图', 'llm:test': '测试连接', 'llm:models': '模型列表', favicon: '网站图标' };
  const pname = (p) => PURPOSE[p] || (p.startsWith('llm:') ? 'AI · ' + p.slice(4) : p);
  async function refreshNet() {
    let s; try { s = await mt.r24('net-stats'); } catch (_) { return; }
    const pill = $('net-pill'), txt = $('net-pill-text');
    if (pill) {
      pill.classList.toggle('local', s.external === 0);
      pill.classList.toggle('blocked', s.blocked > 0);
      txt.innerHTML = s.localOnly ? `仅本地 · 外发 <b>${s.external}</b> · 拦截 <b>${s.blocked}</b>` : `本日外发 <b>${s.external}</b> 次${s.blocked ? ` · 拦截 <b>${s.blocked}</b>` : ''}`;
    }
    const led = $('net-ledger');
    if (led) {
      const rows = (s.last || []).map(r => `<div class="nl-row"><span>${new Date(r.t).toTimeString().slice(0, 5)}</span><span>${esc(r.host)}</span><span>${esc(pname(r.purpose))}</span><span class="${r.ok ? 'ok' : 'no'}">${r.ok ? (r.local ? '本机' : '已发送') : '已拦截'}</span></div>`).join('');
      led.innerHTML = `<div class="nl-head"><span><b>${s.external}</b>次外发</span><span><b>${s.blocked}</b>次拦截</span><span><b>${s.local}</b>次本机</span><span style="margin-left:auto">出网账本 · 今日</span></div>${rows || '<div class="nl-empty">今天没有任何出网请求。所有采集、OCR 与检索均在本机完成。</div>'}`;
    }
  }
  async function refreshOcr() {
    const host = $('pr-localonly')?.closest('.card') || $('net-ledger')?.parentElement; if (!host || $('ocr-status')) return;
    const el = document.createElement('div'); el.className = 'ocr-status'; el.id = 'ocr-status'; host.appendChild(el);
    let r; try { r = await mt.r24('ocr-status'); } catch (_) { r = { ok: false }; }
    el.innerHTML = `<span>截图文字识别</span><span class="chip ${r.ok ? 'on' : ''}">${r.ok ? 'Windows 本地 OCR · ' + esc(r.lang) : '本地 OCR 不可用'}</span><span class="tiny">${r.ok ? '截图文字在本机识别，不上传' : esc(r.error || '')}</span>`;
  }
  const LC = { focus: '#3B82F6', content: '#8B5CF6', authoring: '#10B981', artifact: '#F59E0B', communication: '#EC4899', context: '#64748B' };
  const CN = { window: '窗口', browser: '浏览器', uia: '界面文字', documents: '文档', screenshots: '截图 OCR', notes: '笔记', ide: 'IDE/Git', clipboard: '剪贴板', files: '最近文件', downloads: '下载' };
  const OT = { web: '网页', file: '文件', window: '窗口', conversation: '会话' };
  const AD = { window: '窗口', browser: '历史', uia: 'UIA', screenshot: 'OCR', document: '文档', clipboard: '复制', note: '笔记', ide: 'IDE', file: '文件', download: '下载' };
  async function refreshSignal() {
    const g = $('sig-grid'); if (!g) return;
    let r; try { r = await mt.r24('signal-overview'); } catch (_) { return; }
    const COMM_HINT = { communication: '来自微信/飞书等应用的内容层信号自动归入', context: '规划中：日历 / 网络 / 电源' };
    g.innerHTML = r.layers.map(l => `<div class="sig-tile ${l.enabled || l.today ? '' : 'off'}" style="--lc:${LC[l.key]}"><div class="sn"><i></i>${esc(l.name)}</div><div class="sv">${l.today}<small>条 · 今日</small></div><div class="sd">${esc(l.desc)}</div><div class="sc">${l.collectors.length ? l.collectors.map(c => `<span class="${(r.collectorsOn || {})[c] ? 'on' : ''}">${CN[c] || c}</span>`).join('') : `<span>${esc(COMM_HINT[l.key] || '')}</span>`}</div></div>`).join('');
    const d = r.dedup || { seen: 0, dropped: 0 };
    $('sig-objects').innerHTML = `<div class="sig-kpis"><div><b>${r.objects.total}</b>今日触达对象</div><div><b>${r.objects.multi}</b>多来源归并的对象</div><div><b>${d.dropped}</b>跨来源重复已去除（本次运行 ${d.seen} 条中）</div></div>
      <div class="sig-objlist"><div class="oh">今日高频对象 · 同一网页/文件无论来自历史、界面文字还是 OCR 都只算一个</div>${(r.objects.top || []).map(o => `<div class="orow"><span class="otype">${OT[o.type] || o.type}</span><span class="ot">${esc(o.title || o.uri)}<small>${esc(o.uri)}</small></span><span class="oa">${String(o.adapters || '').split(',').filter(Boolean).map(a => `<span>${AD[a] || a}</span>`).join('')}</span><span class="on">${o.touches} 次</span></div>`).join('') || '<div class="nl-empty">开启采集后，这里会列出今天反复触达的网页、文件和会话。</div>'}</div>`;
  }
  window.r24 = { refreshNet, refreshOcr, refreshSignal };
  document.addEventListener('DOMContentLoaded', () => {
    refreshNet(); setInterval(refreshNet, 15000);
    $('net-pill')?.addEventListener('click', () => { document.querySelector('[data-view=ai]')?.click(); setTimeout(() => { document.querySelector('[data-stab=usage]')?.click(); refreshNet(); refreshOcr(); $('net-ledger')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 300); });
    document.querySelector('[data-view=collect]')?.addEventListener('click', () => setTimeout(refreshSignal, 150));
    document.querySelector('[data-view=ai]')?.addEventListener('click', () => setTimeout(() => { refreshNet(); refreshOcr(); }, 200));
  });
})();
