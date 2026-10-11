const titles = {
  dashboard: ['今日', '把今天的忙碌，变成可复用的资产'],
  timeline: ['时间线', '按时间回看你的桌面足迹'],
  knowledge: ['知识库', '日刊 · 主题 · 人物 · 项目 · 所学 · 待办'],
  chat: ['问问历史', '用自然语言检索你的数字资产'],
  collect: ['采集中心', '分项开关与隐私黑名单'],
  ai: ['设置', 'AI 模型 · 导出 · 本机 API · 关于']
};

let state = null;
let currentKind = '';
let presets = {};
let obStep = 1;
let obCollectors = { window: false, browser: false, documents: false, clipboard: false, screenshots: false };

function $(id) { return document.getElementById(id); }
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2600);
}

function fmtMin(ms) {
  const m = Math.round((ms || 0) / 60000);
  if (m < 60) return `${m} 分钟`;
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}
function fmtTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function typeLabel(t) {
  return ({ window: '窗口', browser: '浏览', document: '文档', clipboard: '剪贴板', screenshot: '截屏' })[t] || t;
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function lines(id) { return $(id).value.split(/\n+/).map(s => s.trim()).filter(Boolean); }

function greet() {
  const h = new Date().getHours();
  const hi = h < 12 ? '早上好' : h < 18 ? '下午好' : '晚上好';
  const d = new Date();
  $('greeting').textContent = `${hi}，今天是 ${d.getMonth()+1} 月 ${d.getDate()} 日`;
}

function showObStep(n) {
  obStep = n;
  [1,2,3,4].forEach(i => {
    $(`ob-step${i}`).classList.toggle('hidden', i !== n);
  });
  [...$('ob-steps').children].forEach((el, idx) => el.classList.toggle('on', idx < n));
}

async function refreshState() {
  state = await window.mindtrace.getState();
  presets = await window.mindtrace.getPresets();
  applyConfigToForm();
  fillPresetSelect($('ai-preset'), state.config.ai.provider);
  fillPresetSelect($('ob-ai-preset'), state.config.ai.provider);
  updateStatus();
  if (!state.config.onboardingCompleted) {
    $('onboarding').classList.remove('hidden');
    showObStep(1);
  } else {
    $('onboarding').classList.add('hidden');
  }
}

function fillPresetSelect(sel, current) {
  if (!sel) return;
  sel.innerHTML = '';
  for (const [k, v] of Object.entries(presets)) {
    const o = document.createElement('option');
    o.value = k; o.textContent = v.label || k;
    if (k === current) o.selected = true;
    sel.appendChild(o);
  }
}

function updateStatus() {
  const pill = $('status-pill');
  const paused = state.config.privacy.paused;
  const auth = state.config.authorized;
  const anyOn = Object.values(state.config.collectors || {}).some(Boolean);
  if (!auth || !state.config.onboardingCompleted) {
    pill.className = 'status-pill off'; $('status-text').textContent = '未就绪';
  } else if (paused || !anyOn) {
    pill.className = 'status-pill pause'; $('status-text').textContent = paused ? '已暂停' : '采集项均关';
  } else {
    pill.className = 'status-pill on'; $('status-text').textContent = '采集中';
  }
  $('btn-pause').textContent = paused ? '恢复采集' : '暂停采集';
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
  $('ai-base').value = c.ai.baseUrl || '';
  $('ai-model').value = c.ai.model || '';
  $('ai-key').value = '';
  $('ai-key').placeholder = state.configRawKeySet ? '已保存（输入新值可覆盖）' : 'sk-…';
  $('ai-vision') && ($('ai-vision').value = c.ai.visionModel || '');
  $('ai-auto').checked = !!c.ai.autoSummarize;
  $('ai-interval').value = c.ai.summarizeIntervalMin || 60;
  $('api-enabled').checked = !!c.api.enabled;
  $('api-port').value = c.api.port;
  $('api-token').value = c.api.token || '';
  $('ob-ai-base').value = c.ai.baseUrl || '';
  $('ob-ai-model').value = c.ai.model || '';
}

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $(`view-${name}`).classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  const [t, s] = titles[name];
  $('view-title').textContent = t;
  $('view-sub').textContent = s;
  greet();
  if (name === 'dashboard') loadDashboard();
  if (name === 'timeline') loadTimeline();
  if (name === 'knowledge') loadKnowledge();
  if (name === 'chat') loadChat();
}

async function loadDashboard() {
  const stats = await window.mindtrace.getTodayStats();
  $('stat-time').textContent = fmtMin(stats.totalMs);
  $('stat-acts').textContent = stats.activityCount;
  $('stat-browse').textContent = stats.browserCount || 0;
  $('stat-cards').textContent = stats.cardsToday;

  const max = Math.max(1, ...(stats.appBreakdown || []).map(a => a.total_ms || 0));
  $('app-bars').innerHTML = (stats.appBreakdown || []).slice(0, 8).map(a => {
    const pct = Math.round((a.total_ms || 0) / max * 100);
    return `<div class="bar-row"><div>${escapeHtml(a.app_name || '未知')}</div><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><div>${fmtMin(a.total_ms)}</div></div>`;
  }).join('') || '<div class="empty">暂无数据。完成引导并开启采集，或点击「填充示例」。</div>';

  const journals = await window.mindtrace.getJournals();
  const today = new Date().toISOString().slice(0, 10);
  const j = journals.find(x => x.period_key === today) || journals[0];
  if (j) {
    let highlights = [];
    try { highlights = JSON.parse(j.highlights || '[]'); } catch {}
    $('journal-box').classList.remove('muted');
    $('journal-box').textContent = `${j.title || ''}\n\n${j.content || ''}\n\n${highlights.length ? '要点：\n- ' + highlights.join('\n- ') : ''}`;
  } else {
    $('journal-box').className = 'journal-box muted';
    $('journal-box').textContent = '还没有摘要。开启采集一段时间后，点击上方按钮生成。';
  }

  const recent = await window.mindtrace.getTimeline({ from: Date.now() - 86400000, limit: 12 });
  $('recent-list').innerHTML = recent.map(a => `
    <div class="list-item">
      <div>${fmtTime(a.started_at)}</div>
      <div class="tag">${typeLabel(a.type)}</div>
      <div class="title"><b>${escapeHtml(a.app_name || '')}</b> ${escapeHtml(a.window_title || a.url || a.file_path || '')}</div>
    </div>
  `).join('') || '<div class="empty">这一天还没有记录。确认采集已开启？</div>';
}

async function loadTimeline() {
  const q = $('tl-q').value.trim();
  const type = $('tl-type').value;
  const items = await window.mindtrace.getTimeline({ q, type, from: Date.now() - 7 * 86400000, limit: 200 });
  $('timeline-list').innerHTML = items.map(a => `
    <div class="tl-item">
      <div class="time">${fmtTime(a.started_at)}<div class="tag" style="margin-top:6px">${typeLabel(a.type)}</div></div>
      <div>
        <div><b>${escapeHtml(a.app_name || '')}</b> ${escapeHtml(a.window_title || '')}</div>
        <div class="meta">${escapeHtml(a.url || a.file_path || '')} ${a.content ? '· ' + escapeHtml(String(a.content).slice(0, 100)) : ''} ${a.duration_ms ? '· ' + fmtMin(a.duration_ms) : ''}</div>
      </div>
    </div>
  `).join('') || '<div class="empty">没有匹配的时间线记录</div>';
}

async function loadKnowledge() {
  const cards = await window.mindtrace.getCards({ kind: currentKind || undefined });
  $('cards-grid').innerHTML = cards.map(c => `
    <div class="kcard" data-kind="${escapeHtml(c.kind)}">
      <div class="kind">${escapeHtml(c.kind)}</div>
      <h4>${escapeHtml(c.title)}</h4>
      <p>${escapeHtml(c.summary || '')}</p>
    </div>
  `).join('') || '<div class="empty">暂无知识卡片。采集一段时间后，AI 会自动提炼；也可填充示例。</div>';

  const journals = await window.mindtrace.getJournals();
  $('journals-list').innerHTML = journals.map(j => `
    <div class="list-item" style="grid-template-columns: 100px 1fr">
      <div>${j.period_key}</div>
      <div><b>${escapeHtml(j.title || '')}</b><div class="tiny">${escapeHtml((j.content || '').slice(0, 120))}</div></div>
    </div>
  `).join('') || '<div class="empty">暂无日刊</div>';
}

function renderCitations(cites) {
  if (!cites || !cites.length) return '';
  return `<div class="cite-list">${cites.map(c => {
    const label = escapeHtml((c.label || c.key || '').slice(0, 48));
    const key = escapeHtml(c.key || '');
    const id = escapeHtml(c.id || '');
    const started = c.started_at || '';
    return `<button type="button" class="cite-chip" data-cite-id="${id}" data-started="${started}" title="${label}"><span class="k">${key}</span>${label}</button>`;
  }).join('')}</div>`;
}

function parseMsgCitations(m) {
  if (!m.citations) return [];
  if (Array.isArray(m.citations)) return m.citations;
  try { return JSON.parse(m.citations); } catch { return []; }
}

async function loadChat() {
  const msgs = await window.mindtrace.getChat();
  const log = $('chat-log');
  log.innerHTML = msgs.map(m => {
    const cites = m.role === 'assistant' ? parseMsgCitations(m) : [];
    return `<div class="bubble ${m.role}">${escapeHtml(m.content)}${renderCitations(cites)}</div>`;
  }).join('') || '<div class="empty">向你的历史提问，例如：“我最近在看哪些技术资料？”</div>';
  log.scrollTop = log.scrollHeight;
  bindCiteClicks(log);
}

function bindCiteClicks(root) {
  root.querySelectorAll('.cite-chip').forEach(btn => {
    btn.onclick = () => {
      const started = Number(btn.dataset.started || 0);
      showView('timeline');
      if (started) {
        $('tl-q').value = btn.title || '';
        setTimeout(() => loadTimeline(), 50);
      }
      toast('已跳到时间线（可按引用关键词查看）');
    };
  });
}

function readObCollectors() {
  return {
    window: $('ob-c-window').checked,
    browser: $('ob-c-browser').checked,
    documents: $('ob-c-documents').checked,
    clipboard: $('ob-c-clipboard').checked,
    screenshots: $('ob-c-screenshots').checked
  };
}

function bind() {
  document.querySelectorAll('.nav-item').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

  $('ob-next1').onclick = () => showObStep(2);
  $('ob-back2').onclick = () => showObStep(1);
  $('ob-skip2').onclick = () => { obCollectors = { window:false,browser:false,documents:false,clipboard:false,screenshots:false }; showObStep(3); };
  $('ob-next2').onclick = () => { obCollectors = readObCollectors(); showObStep(3); };
  $('ob-back3').onclick = () => showObStep(2);
  $('ob-skip3').onclick = () => showObStep(4);
  $('ob-next3').onclick = async () => {
    const key = $('ob-ai-key').value.trim();
    const patch = { ai: { provider: $('ob-ai-preset').value, baseUrl: $('ob-ai-base').value.trim(), model: $('ob-ai-model').value.trim() } };
    if (key) patch.ai.apiKey = key;
    await window.mindtrace.setConfig(patch);
    showObStep(4);
  };
  $('ob-back4').onclick = () => showObStep(3);
  $('ob-ai-preset').onchange = () => {
    const p = presets[$('ob-ai-preset').value];
    if (p?.baseUrl) $('ob-ai-base').value = p.baseUrl;
    if (p?.model) $('ob-ai-model').value = p.model;
  };
  $('ob-test').onclick = async () => {
    const key = $('ob-ai-key').value.trim();
    if (key) await window.mindtrace.setConfig({ ai: { apiKey: key, baseUrl: $('ob-ai-base').value.trim(), model: $('ob-ai-model').value.trim(), provider: $('ob-ai-preset').value } });
    $('ob-ai-result').textContent = '测试中…';
    const r = await window.mindtrace.testAi();
    $('ob-ai-result').textContent = r.ok ? r.content : ('错误：' + r.error);
  };
  $('ob-finish').onclick = async () => {
    await window.mindtrace.setConfig({
      collectors: obCollectors,
      startOnBoot: $('ob-boot').checked,
      startCollectingOnLaunch: $('ob-start').checked
    });
    await window.mindtrace.authorize(true);
    await refreshState();
    toast('欢迎使用知迹');
    showView('dashboard');
  };

  $('btn-pause').onclick = async () => {
    const next = !state.config.privacy.paused;
    await window.mindtrace.setPaused(next);
    await refreshState();
    toast(next ? '已暂停采集' : '已恢复采集');
  };
  $('btn-theme').onclick = () => {
    const dark = document.body.getAttribute('data-theme') !== 'dark';
    document.body.setAttribute('data-theme', dark ? 'dark' : 'light');
    document.body.classList.toggle('theme-dark', dark);
    window.mindtrace.setConfig({ theme: dark ? 'dark' : 'light' });
  };
  $('btn-seed').onclick = async () => { await window.mindtrace.seedDemo(); toast('已填充示例数据'); loadDashboard(); };
  $('btn-export').onclick = $('btn-export2').onclick = async () => {
    const r = await window.mindtrace.exportVault();
    toast(r.ok ? `已导出到 ${r.vaultPath}` : (r.error || '导出失败'));
  };
  $('btn-summarize').onclick = async () => {
    toast('正在整理今日轨迹…');
    const r = await window.mindtrace.summarizeToday();
    toast(r.ok ? '日刊已生成' : (r.error || '生成失败（请检查 AI 设置）'));
    if (r.ok) loadDashboard();
  };
  $('btn-refresh-journal').onclick = loadDashboard;
  $('btn-tl-search').onclick = loadTimeline;
  $('tl-q').onkeydown = e => { if (e.key === 'Enter') loadTimeline(); };
  document.querySelectorAll('#kind-chips .chip').forEach(ch => {
    ch.onclick = () => {
      document.querySelectorAll('#kind-chips .chip').forEach(x => x.classList.remove('active'));
      ch.classList.add('active');
      currentKind = ch.dataset.kind;
      loadKnowledge();
    };
  });
  $('btn-extract').onclick = async () => {
    toast('正在提炼知识卡片…');
    const r = await window.mindtrace.extractCards();
    toast(r.ok ? `已更新 ${r.ids?.length || 0} 张卡片` : (r.error || '提炼失败'));
    if (r.ok) loadKnowledge();
  };
  $('btn-ask').onclick = ask;
  $('chat-input').onkeydown = e => { if (e.key === 'Enter') ask(); };

  $('btn-save-collect').onclick = async () => {
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
        screenshotIntervalSec: Number($('shot-interval').value) || 300,
        idleThresholdSec: Number($('idle-threshold').value) || 180,
        blacklistApps: lines('bl-apps'),
        blacklistSites: lines('bl-sites'),
        blacklistKeywords: lines('bl-keys')
      }
    });
    await refreshState();
    toast('采集设置已保存');
  };
  $('btn-capture').onclick = async () => {
    const r = await window.mindtrace.captureNow();
    toast(r.ok ? '截屏已保存' : '截屏失败（当前环境可能受限）');
  };
  $('ai-preset').onchange = () => {
    const p = presets[$('ai-preset').value];
    if (p?.baseUrl) $('ai-base').value = p.baseUrl;
    if (p?.model) $('ai-model').value = p.model;
  };
  $('btn-save-ai').onclick = async () => {
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
  };
  $('btn-test-ai').onclick = async () => {
    $('ai-test-result').textContent = '测试中…';
    const r = await window.mindtrace.testAi();
    $('ai-test-result').textContent = r.ok ? r.content : ('错误：' + r.error);
  };
  $('btn-save-api').onclick = async () => {
    await window.mindtrace.setConfig({ api: { enabled: $('api-enabled').checked, port: Number($('api-port').value) || 17321 } });
    await refreshState();
    toast('API 设置已保存');
  };
  window.mindtrace.onStatus(async (data) => {
    await refreshState();
    if (data?.toast) toast(data.toast);
  });
}

async function ask() {
  const q = $('chat-input').value.trim();
  if (!q) return;
  $('chat-input').value = '';
  const log = $('chat-log');
  log.insertAdjacentHTML('beforeend', `<div class="bubble user">${escapeHtml(q)}</div>`);
  log.insertAdjacentHTML('beforeend', `<div class="bubble assistant muted" id="thinking">正在检索你的历史…</div>`);
  log.scrollTop = log.scrollHeight;
  const r = await window.mindtrace.ask(q);
  $('thinking')?.remove();
  if (!r.ok) {
    log.insertAdjacentHTML('beforeend', `<div class="bubble assistant">${escapeHtml('错误：' + r.error)}</div>`);
  } else {
    const wrap = document.createElement('div');
    wrap.className = 'bubble assistant';
    wrap.innerHTML = `${escapeHtml(r.answer)}${renderCitations(r.citations || [])}`;
    log.appendChild(wrap);
    bindCiteClicks(wrap);
  }
  log.scrollTop = log.scrollHeight;
}

(async function init() {
  bind();
  await refreshState();
  if (state.config.theme === 'dark') {
    document.body.setAttribute('data-theme', 'dark');
    document.body.classList.add('theme-dark');
  }
  showView('dashboard');
})();
