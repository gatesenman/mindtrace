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
  window.r24 = { refreshNet, refreshOcr };
  document.addEventListener('DOMContentLoaded', () => {
    refreshNet(); setInterval(refreshNet, 15000);
    $('net-pill')?.addEventListener('click', () => { document.querySelector('[data-view=ai]')?.click(); setTimeout(() => { document.querySelector('[data-stab=usage]')?.click(); refreshNet(); refreshOcr(); $('net-ledger')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 300); });
    document.querySelector('[data-view=ai]')?.addEventListener('click', () => setTimeout(() => { refreshNet(); refreshOcr(); }, 200));
  });
})();
