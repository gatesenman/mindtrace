const titles = {
  dashboard: ['今日概览', '把今天的忙碌，变成可复用的资产'],
  timeline: ['时间线', '按时间回看你的桌面足迹'],
  knowledge: ['知识库', '人物 · 项目 · 学习 · 待办 · 链接'],
  chat: ['问答', '用自然语言检索你的数字资产'],
  collect: ['采集与隐私', '授权范围内的可控采集'],
  ai: ['AI 设置', 'OpenAI 兼容接口与本机 API']
};

let state = null;
let currentKind = '';
let presets = {};

function $(id) { return document.getElementById(id); }
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2200);
}

function fmtMin(ms) {
  const m = Math.round((ms || 0) / 60000);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h} 小时 ${r} 分`;
}

function fmtTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function typeLabel(t) {
  return ({ window: '窗口', browser: '浏览', document: '文档', clipboard: '剪贴板', screenshot: '截图' })[t] || t;
}

async function refreshState() {
  state = await window.mindtrace.getState();
  presets = await window.mindtrace.getPresets();
  applyConfigToForm();
  updateStatus();
  if (!state.config.authorized) $('onboarding').classList.remove('hidden');
  else $('onboarding').classList.add('hidden');
}

function updateStatus() {
  const pill = $('status-pill');
  const paused = state.config.privacy.paused;
  const auth = state.config.authorized;
  if (!auth) { pill.className = 'status-pill off'; pill.textContent = '未授权'; }
  else if (paused) { pill.className = 'status-pill pause'; pill.textContent = '已暂停'; }
  else { pill.className = 'status-pill on'; pill.textContent = '采集中'; }
  $('btn-pause').textContent = paused ? '继续采集' : '暂停采集';
  $('api-hint').textContent = `http://127.0.0.1:${state.apiPort}`;
}

function applyConfigToForm() {
  const c = state.config;
  $('c-window').checked = !!c.collectors.window;
  $('c-browser').checked = !!c.collectors.browser;
  $('c-documents').checked = !!c.collectors.documents;
  $('c-clipboard').checked = !!c.collectors.clipboard;
  $('c-screenshots').checked = !!c.collectors.screenshots;
  $('shot-interval').value = c.privacy.screenshotIntervalSec;
  $('idle-threshold').value = c.privacy.idleThresholdSec;
  $('bl-apps').value = (c.privacy.blacklistApps || []).join('\n');
  $('bl-sites').value = (c.privacy.blacklistSites || []).join('\n');
  $('bl-keys').value = (c.privacy.blacklistKeywords || []).join('\n');
  $('start-boot').checked = !!c.startOnBoot;

  const sel = $('ai-preset');
  sel.innerHTML = '';
  for (const [k, v] of Object.entries(presets)) {
    const o = document.createElement('option');
    o.value = k; o.textContent = v.label || k;
    if (k === c.ai.provider) o.selected = true;
    sel.appendChild(o);
  }
  $('ai-base').value = c.ai.baseUrl || '';
  $('ai-model').value = c.ai.model || '';
  $('ai-key').value = c.configRawKeySet ? c.ai.apiKey : '';
  $('ai-auto').checked = !!c.ai.autoSummarize;
  $('ai-interval').value = c.ai.summarizeIntervalMin || 60;
  $('api-enabled').checked = !!c.api.enabled;
  $('api-port').value = c.api.port;
  $('api-token').value = c.api.token || '';
}

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $(`view-${name}`).classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  const [t, s] = titles[name];
  $('view-title').textContent = t;
  $('view-sub').textContent = s;
  if (name === 'dashboard') loadDashboard();
  if (name === 'timeline') loadTimeline();
  if (name === 'knowledge') loadKnowledge();
  if (name === 'chat') loadChat();
}

async function loadDashboard() {
  const stats = await window.mindtrace.getTodayStats();
  $('stat-time').textContent = fmtMin(stats.totalMs);
  $('stat-acts').textContent = stats.activityCount;
  $('stat-cards').textContent = stats.cardsToday;
  $('stat-shots').textContent = stats.screenshotsToday;

  const max = Math.max(1, ...(stats.appBreakdown || []).map(a => a.total_ms || 0));
  $('app-bars').innerHTML = (stats.appBreakdown || []).slice(0, 8).map(a => {
    const pct = Math.round((a.total_ms || 0) / max * 100);
    return `<div class="bar-row"><div>${a.app_name || '未知'}</div><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><div>${fmtMin(a.total_ms)}</div></div>`;
  }).join('') || '<div class="muted">暂无数据。授权后开始采集，或点击「填充示例数据」。</div>';

  const journals = await window.mindtrace.getJournals();
  const today = new Date().toISOString().slice(0, 10);
  const j = journals.find(x => x.period_key === today) || journals[0];
  if (j) {
    let highlights = [];
    try { highlights = JSON.parse(j.highlights || '[]'); } catch {}
    $('journal-box').classList.remove('muted');
    $('journal-box').textContent = `${j.title || ''}\n\n${j.content || ''}\n\n${highlights.length ? '要点：\n- ' + highlights.join('\n- ') : ''}`;
  }

  const recent = await window.mindtrace.getTimeline({ from: Date.now() - 86400000, limit: 12 });
  $('recent-list').innerHTML = recent.map(a => `
    <div class="list-item">
      <div>${fmtTime(a.started_at)}</div>
      <div class="tag">${typeLabel(a.type)}</div>
      <div class="title"><b>${a.app_name || ''}</b> ${a.window_title || a.url || a.file_path || ''}</div>
    </div>
  `).join('') || '<div class="muted">暂无最近活动</div>';
}

async function loadTimeline() {
  const q = $('tl-q').value.trim();
  const type = $('tl-type').value;
  const items = await window.mindtrace.getTimeline({ q, type, from: Date.now() - 7 * 86400000, limit: 200 });
  $('timeline-list').innerHTML = items.map(a => `
    <div class="tl-item">
      <div class="time">${fmtTime(a.started_at)}<div class="tag" style="margin-top:6px">${typeLabel(a.type)}</div></div>
      <div>
        <div><b>${a.app_name || ''}</b> ${a.window_title || ''}</div>
        <div class="meta">${a.url || a.file_path || ''} ${a.content ? '· ' + String(a.content).slice(0, 100) : ''} ${a.duration_ms ? '· ' + fmtMin(a.duration_ms) : ''}</div>
      </div>
    </div>
  `).join('') || '<div class="muted">没有匹配的时间线记录</div>';
}

async function loadKnowledge() {
  const cards = await window.mindtrace.getCards({ kind: currentKind || undefined });
  $('cards-grid').innerHTML = cards.map(c => `
    <div class="kcard">
      <div class="kind">${c.kind}</div>
      <h4>${escapeHtml(c.title)}</h4>
      <p>${escapeHtml(c.summary || '')}</p>
    </div>
  `).join('') || '<div class="muted">暂无知识卡片。可填充示例数据，或配置 AI 后抽取。</div>';

  const journals = await window.mindtrace.getJournals();
  $('journals-list').innerHTML = journals.map(j => `
    <div class="list-item" style="grid-template-columns: 100px 1fr">
      <div>${j.period_key}</div>
      <div><b>${escapeHtml(j.title || '')}</b><div class="muted tiny">${escapeHtml((j.content || '').slice(0, 120))}</div></div>
    </div>
  `).join('') || '<div class="muted">暂无日报</div>';
}

async function loadChat() {
  const msgs = await window.mindtrace.getChat();
  const log = $('chat-log');
  log.innerHTML = msgs.map(m => `<div class="bubble ${m.role}">${escapeHtml(m.content)}</div>`).join('')
    || '<div class="muted">向你的历史提问，例如：“我最近在看哪些技术资料？”</div>';
  log.scrollTop = log.scrollHeight;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function lines(id) {
  return $(id).value.split(/\n+/).map(s => s.trim()).filter(Boolean);
}

function bind() {
  document.querySelectorAll('.nav-item').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

  $('consent-check').addEventListener('change', (e) => {
    $('btn-authorize').disabled = !e.target.checked;
  });
  $('btn-authorize').addEventListener('click', async () => {
    await window.mindtrace.authorize(true);
    await refreshState();
    toast('已授权，开始采集');
    showView('dashboard');
  });
  $('btn-refuse').addEventListener('click', () => {
    toast('未授权将无法采集；你仍可浏览界面与示例数据');
    $('onboarding').classList.add('hidden');
  });

  $('btn-pause').addEventListener('click', async () => {
    const next = !state.config.privacy.paused;
    await window.mindtrace.setPaused(next);
    await refreshState();
    toast(next ? '已暂停采集' : '已继续采集');
  });

  $('btn-theme').addEventListener('click', () => {
    const light = document.body.classList.toggle('theme-light');
    document.body.classList.toggle('theme-dark', !light);
    window.mindtrace.setConfig({ theme: light ? 'light' : 'dark' });
  });

  $('btn-seed').addEventListener('click', async () => {
    await window.mindtrace.seedDemo();
    toast('已填充示例数据');
    loadDashboard();
  });

  $('btn-export').addEventListener('click', async () => {
    const r = await window.mindtrace.exportVault();
    if (r.ok) { toast(`已导出到 ${r.vaultPath}`); }
    else toast(r.error || '导出失败');
  });

  $('btn-summarize').addEventListener('click', async () => {
    toast('正在生成日报…');
    const r = await window.mindtrace.summarizeToday();
    if (r.ok) { toast('日报已生成'); loadDashboard(); }
    else toast(r.error || '生成失败（请检查 AI 设置）');
  });
  $('btn-refresh-journal')?.addEventListener('click', loadDashboard);

  $('btn-tl-search').addEventListener('click', loadTimeline);
  $('tl-q').addEventListener('keydown', e => { if (e.key === 'Enter') loadTimeline(); });

  document.querySelectorAll('#kind-chips .chip').forEach(ch => {
    ch.addEventListener('click', () => {
      document.querySelectorAll('#kind-chips .chip').forEach(x => x.classList.remove('active'));
      ch.classList.add('active');
      currentKind = ch.dataset.kind;
      loadKnowledge();
    });
  });
  $('btn-extract').addEventListener('click', async () => {
    toast('正在抽取知识卡片…');
    const r = await window.mindtrace.extractCards();
    if (r.ok) { toast(`已更新 ${r.ids?.length || 0} 张卡片`); loadKnowledge(); }
    else toast(r.error || '抽取失败');
  });

  $('btn-ask').addEventListener('click', ask);
  $('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') ask(); });

  $('btn-save-collect').addEventListener('click', async () => {
    await window.mindtrace.setConfig({
      startOnBoot: $('start-boot').checked,
      collectors: {
        window: $('c-window').checked,
        browser: $('c-browser').checked,
        documents: $('c-documents').checked,
        clipboard: $('c-clipboard').checked,
        screenshots: $('c-screenshots').checked
      },
      privacy: {
        screenshotIntervalSec: Number($('shot-interval').value) || 120,
        idleThresholdSec: Number($('idle-threshold').value) || 180,
        blacklistApps: lines('bl-apps'),
        blacklistSites: lines('bl-sites'),
        blacklistKeywords: lines('bl-keys')
      }
    });
    await refreshState();
    toast('采集设置已保存');
  });

  $('btn-capture').addEventListener('click', async () => {
    const r = await window.mindtrace.captureNow();
    toast(r.ok ? '截图已保存' : '截图失败（Linux 上可能受限）');
  });

  $('ai-preset').addEventListener('change', () => {
    const p = presets[$('ai-preset').value];
    if (p) {
      if (p.baseUrl) $('ai-base').value = p.baseUrl;
      if (p.model) $('ai-model').value = p.model;
    }
  });

  $('btn-save-ai').addEventListener('click', async () => {
    const key = $('ai-key').value.trim();
    const patch = {
      ai: {
        provider: $('ai-preset').value,
        baseUrl: $('ai-base').value.trim(),
        model: $('ai-model').value.trim(),
        autoSummarize: $('ai-auto').checked,
        summarizeIntervalMin: Number($('ai-interval').value) || 60
      }
    };
    if (key && !key.startsWith('••••')) patch.ai.apiKey = key;
    await window.mindtrace.setConfig(patch);
    await refreshState();
    toast('AI 设置已保存');
  });

  $('btn-test-ai').addEventListener('click', async () => {
    $('ai-test-result').textContent = '测试中…';
    const r = await window.mindtrace.testAi();
    $('ai-test-result').textContent = r.ok ? r.content : ('错误：' + r.error);
  });

  $('btn-save-api').addEventListener('click', async () => {
    await window.mindtrace.setConfig({
      api: {
        enabled: $('api-enabled').checked,
        port: Number($('api-port').value) || 17890
      }
    });
    await refreshState();
    toast('API 设置已保存');
  });

  window.mindtrace.onStatus(async () => { await refreshState(); });
}

async function ask() {
  const q = $('chat-input').value.trim();
  if (!q) return;
  $('chat-input').value = '';
  const log = $('chat-log');
  log.insertAdjacentHTML('beforeend', `<div class="bubble user">${escapeHtml(q)}</div>`);
  log.insertAdjacentHTML('beforeend', `<div class="bubble assistant muted" id="thinking">思考中…</div>`);
  log.scrollTop = log.scrollHeight;
  const r = await window.mindtrace.ask(q);
  const thinking = $('thinking');
  if (thinking) thinking.remove();
  log.insertAdjacentHTML('beforeend', `<div class="bubble assistant">${escapeHtml(r.ok ? r.answer : ('错误：' + r.error))}</div>`);
  log.scrollTop = log.scrollHeight;
}

(async function init() {
  bind();
  await refreshState();
  if (state.config.theme === 'light') {
    document.body.classList.add('theme-light');
    document.body.classList.remove('theme-dark');
  }
  showView('dashboard');
})();
