const titles = {
  dashboard: ['今日总览', '把今天的忙碌，沉淀为可复用的企业知识资产'],
  timeline: ['时间线', '按时 / 天 / 周 / 月回看桌面足迹'],
  wiki: ['Wiki', '时间卷 · 实体页 · 记忆与反链'],
  knowledge: ['知识库', '日刊 · 主题 · 人物 · 项目 · 所学 · 待办'],
  chat: ['智能问答', '用自然语言检索你的数字资产'],
  collect: ['采集中心', '分项开关、状态与隐私黑名单'],
  ai: ['设置', 'AI 模型 · 导出 · 本机 API · 关于']
};

let state = null;
let timelineZoom = 'day';
let wikiKind = '';
let currentKind = '';
let knowledgeTab = 'journals';
let presets = {};
let obStep = 1;
let highlightId = null;
let obCollectors = { window: false, browser: false, documents: false, clipboard: false, screenshots: false };

function $(id) { return document.getElementById(id); }
function emptyState(title, desc) {
  const illu = (window.MTIcons && MTIcons.empty) ? MTIcons.empty() : '';
  return `<div class="empty">${illu}<h3>${escapeHtml(title)}</h3><p>${escapeHtml(desc || '')}</p></div>`;
}
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2600);
}

function fmtMin(ms) {
  const m = Math.max(0, Math.round((ms || 0) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}
function fmtTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function typeLabel(t) {
  return ({ window: '窗口', browser: '浏览', document: '文档', clipboard: '剪贴板', screenshot: '截屏', note: '笔记', ide: 'IDE', download: '下载', file: '文件', uia: '界面文本' })[t] || t;
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
/** Lightweight markdown → HTML (headings, lists, bold/italic, paragraphs). */
function renderMarkdown(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inUl = false, inOl = false;
  const closeLists = () => {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  };
  const inline = (s) => escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { closeLists(); continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      closeLists();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }
    const ul = /^[-*+]\s+(.*)$/.exec(line);
    if (ul) {
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!inOl) { out.push('<ol>'); inOl = true; }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }
    closeLists();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeLists();
  return out.join('\n');
}
function setDelta(el, delta) {
  if (!el) return;
  const d = delta || { label: '较昨日 —', dir: 'flat' };
  el.textContent = d.label || '较昨日 —';
  el.className = 'delta ' + (d.dir === 'up' ? 'up' : d.dir === 'down' ? 'down' : 'flat');
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
    pill.className = 'status-pill pause'; $('status-text').textContent = paused ? '已暂停' : '未开启采集项';
  } else {
    pill.className = 'status-pill on'; $('status-text').textContent = '采集中';
  }
  $('btn-pause').textContent = paused ? '恢复采集' : (anyOn ? '暂停采集' : '去开启采集项');
  $('btn-pause').dataset.mode = (!paused && !anyOn) ? 'setup' : '';
  $('api-hint').textContent = `http://127.0.0.1:${state.apiPort}`;
}

function applyConfigToForm() {
  const c = state.config;
  $('c-window').checked = !!c.collectors.window;
  $('c-browser').checked = !!c.collectors.browser;
  $('c-documents').checked = !!c.collectors.documents;
  $('c-clipboard').checked = !!c.collectors.clipboard;
  $('c-screenshots').checked = !!c.collectors.screenshots;
  if ($('c-notes')) $('c-notes').checked = !!c.collectors.notes;
  if ($('c-ide')) $('c-ide').checked = !!c.collectors.ide;
  if ($('c-downloads')) $('c-downloads').checked = !!c.collectors.downloads;
  if ($('c-files')) $('c-files').checked = !!c.collectors.files;
  if ($('c-uia')) $('c-uia').checked = !!c.collectors.uia;
  $('shot-interval').value = c.privacy.screenshotIntervalSec;
  $('idle-threshold').value = c.privacy.idleThresholdSec;
  $('bl-apps').value = (c.privacy.blacklistApps || []).join('\n');
  $('bl-sites').value = (c.privacy.blacklistSites || []).join('\n');
  $('bl-keys').value = (c.privacy.blacklistKeywords || []).join('\n');
  $('start-boot').checked = !!c.startOnBoot;
  if ($('demo-mode')) $('demo-mode').checked = !!c.demoMode;
  $('demo-banner')?.classList.toggle('hidden', !c.demoMode);
  if ($('btn-seed')) $('btn-seed').textContent = c.demoMode ? '关闭示例数据' : '体验示例数据';
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
  if ($('ob-ai-vision')) $('ob-ai-vision').value = c.ai.visionModel || '';
}

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $(`view-${name}`).classList.remove('hidden');
  document.querySelectorAll('#nav .nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  const [tt, s] = titles[name];
  $('view-title').textContent = tt;
  $('view-sub').textContent = s;
  if ($('crumb-current')) $('crumb-current').textContent = tt;
  greet();
  if (name === 'dashboard') loadDashboard();
  if (name === 'timeline') loadTimeline();
  if (name === 'knowledge') loadKnowledge();
  if (name === 'chat') loadChat();
  if (name === 'collect') loadCollectorStatus();
  if (name === 'wiki') loadWiki();
}

async function loadDashboard() {
  const stats = await window.mindtrace.getTodayStats();
  $('stat-time').textContent = fmtMin(stats.totalMs);
  $('stat-acts').textContent = stats.activityCount;
  $('stat-browse').textContent = stats.browserCount || 0;
  $('stat-cards').textContent = stats.cardsToday;

  setDelta($('stat-time-delta'), stats.deltas?.time);
  setDelta($('stat-acts-delta'), stats.deltas?.acts);
  setDelta($('stat-browse-delta'), stats.deltas?.browse);
  setDelta($('stat-cards-delta'), stats.deltas?.cards);

  try {
    if (window.MTCharts) {
      MTCharts.appsRank($('chart-apps'), stats.appBreakdown || []);
      if ($('app-bars')) $('app-bars').innerHTML = '';
      MTCharts.heatmap($('chart-hourly'), stats.hourly || new Array(24).fill(0));
      const week = (stats.weekTrend && stats.weekTrend.length) ? stats.weekTrend : [0, 0, 0, 0, 0, 0, stats.activityCount || 0];
      MTCharts.weekTrend($('chart-week'), week);
      const sparkBase = week.map(v => Math.max(0, Number(v) || 0));
      const brand = getComputedStyle(document.body).getPropertyValue('--brand').trim();
      MTCharts.sparkline($('spark-time'), sparkBase, brand);
      MTCharts.sparkline($('spark-acts'), sparkBase, brand);
      MTCharts.sparkline($('spark-browse'), sparkBase.map((v, i) => Math.max(0, Math.round(v * 0.45))), brand);
      MTCharts.sparkline($('spark-cards'), sparkBase.map((v, i) => Math.max(0, Math.round(v * 0.25) + (i === 6 ? (stats.cardsToday || 0) : 0))), brand);
    }
  } catch (e) { console.warn('charts', e); }

  const journals = await window.mindtrace.getJournals();
  const today = new Date().toISOString().slice(0, 10);
  const j = journals.find(x => x.period_key === today) || journals[0];
  if (j) {
    let highlights = [];
    try { highlights = JSON.parse(j.highlights || '[]'); } catch {}
    const demo = /示例/.test(j.title || '') || /【示例数据】/.test(j.content || '');
    const md = [
      j.title ? `## ${j.title}` : '',
      j.content || '',
      highlights.length ? `### 要点\n\n${highlights.map(h => `- ${h}`).join('\n')}` : ''
    ].filter(Boolean).join('\n\n');
    $('journal-box').className = 'journal-box md';
    $('journal-box').innerHTML = (demo ? '<span class="demo-tag">示例</span>' : '') + renderMarkdown(md);
  } else {
    $('journal-box').className = 'journal-box muted';
    $('journal-box').textContent = '还没有摘要。开启采集一段时间后，点击上方按钮生成。';
  }

  const recent = await window.mindtrace.getTimeline({ from: Date.now() - 86400000, limit: 14 });
  $('recent-list').innerHTML = recent.map(a => {
    const demo = isDemoMeta(a.meta);
    return `<div class="recent-row">
      <div class="t">${fmtTime(a.started_at)}</div>
      <div class="cat-dot" data-type="${escapeHtml(a.type || '')}"></div>
      <div class="cat-label">${typeLabel(a.type)}</div>
      <div class="recent-title"><b>${escapeHtml(a.app_name || '')}</b> ${escapeHtml(a.window_title || a.url || a.file_path || '')}${demo ? '<span class="demo-tag">示例</span>' : ''}</div>
    </div>`;
  }).join('') || emptyState('暂无最近活动', '完成引导并开启采集，或打开体验示例数据。');
}

function isDemoMeta(meta) {
  try { const m = typeof meta === 'string' ? JSON.parse(meta) : meta; return !!(m && m.isDemo); } catch { return false; }
}

async function loadTimeline(opts = {}) {
  if (timelineZoom !== 'day' && !opts.forceDay) {
    const level = timelineZoom;
    const levelZh = { hour: '小时', week: '周', month: '月' }[level] || level;
    const rolls = await window.mindtrace.getRollups({ level });
    if (!rolls.length) {
      $('timeline-list').innerHTML = emptyState(`暂无按${levelZh}汇总的记录`, '汇总在采集满一个周期后自动生成；也可在 Wiki 页手动「生成今日日卷 / 上一小时卷」。');
      return;
    }
    $('timeline-list').innerHTML = rolls.map(r => `
      <div class="rollup-card" data-level="${escapeHtml(r.level)}" data-key="${escapeHtml(r.period_key)}">
        <h4>${escapeHtml(r.title || r.period_key)}</h4>
        <div class="preview">${escapeHtml((r.summary_md || '').replace(/[#>*`]/g,'').slice(0, 180))}</div>
      </div>`).join('');
    document.querySelectorAll('.rollup-card').forEach(card => {
      card.onclick = () => {
        if (card.dataset.level === 'month') { timelineZoom = 'week'; }
        else if (card.dataset.level === 'week') { timelineZoom = 'day'; }
        else if (card.dataset.level === 'day') {
          timelineZoom = 'day';
          document.querySelectorAll('#tl-zoom .chip').forEach(c => c.classList.toggle('active', c.dataset.zoom === 'day'));
          loadTimeline({ forceDay: true, day: card.dataset.key });
          return;
        } else if (card.dataset.level === 'hour') {
          timelineZoom = 'day';
          document.querySelectorAll('#tl-zoom .chip').forEach(c => c.classList.toggle('active', c.dataset.zoom === 'day'));
          const day = card.dataset.key.slice(0, 10);
          loadTimeline({ forceDay: true, day });
          return;
        }
        document.querySelectorAll('#tl-zoom .chip').forEach(c => c.classList.toggle('active', c.dataset.zoom === timelineZoom));
        loadTimeline();
      };
    });
    return;
  }
  const q = opts.q != null ? opts.q : $('tl-q').value.trim();
  const type = $('tl-type').value;
  let from = opts.from || (Date.now() - 7 * 86400000);
  let to = opts.to || Date.now();
  if (opts.day) {
    from = new Date(opts.day + 'T00:00:00').getTime();
    to = new Date(opts.day + 'T23:59:59').getTime();
  }
  const items = await window.mindtrace.getTimeline({ q, type, from, to, limit: opts.limit || 200 });
  if (opts.focusId && !items.find(x => x.id === opts.focusId)) {
    const r = await window.mindtrace.getById('activity', opts.focusId);
    if (r.ok && r.item) items.unshift(r.item);
  }
  $('timeline-list').innerHTML = items.map(a => {
    const demo = isDemoMeta(a.meta);
    const hl = (opts.focusId && a.id === opts.focusId) || (highlightId === a.id);
    return `<div class="tl-item${hl ? ' highlight' : ''}" data-type="${escapeHtml(a.type || '')}" data-id="${escapeHtml(a.id)}" id="act-${escapeHtml(a.id)}">
      <div class="time">${fmtTime(a.started_at)}<div class="tag" style="margin-top:6px">${typeLabel(a.type)}</div>${demo ? '<span class="demo-tag">示例</span>' : ''}</div>
      <div class="tl-card">
        <div><b>${escapeHtml(a.app_name || '')}</b> ${escapeHtml(a.window_title || '')}</div>
        <div class="meta">${escapeHtml(a.url || a.file_path || '')} ${a.content ? '· ' + escapeHtml(String(a.content).slice(0, 100)) : ''} ${a.duration_ms ? '· ' + fmtMin(a.duration_ms) : ''}</div>
      </div>
    </div>`;
  }).join('') || emptyState('没有匹配的时间线记录', '调整筛选条件，或切换到其他时间粒度。');
  if (opts.focusId) {
    const el = document.getElementById('act-' + opts.focusId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlightId = opts.focusId;
    setTimeout(() => { highlightId = null; }, 4000);
  }
}

async function loadKnowledge() {
  showKnowledgeTab(knowledgeTab);
  if (knowledgeTab === 'journals') await loadJournalsTab();
  else if (knowledgeTab === 'topics') await loadTopicsTab();
  else await loadCardsTab();
}

function showKnowledgeTab(tab) {
  knowledgeTab = tab;
  document.querySelectorAll('#knowledge-tabs .chip').forEach(c => c.classList.toggle('active', c.dataset.ktab === tab));
  ['journals','topics','cards'].forEach(k => {
    const el = $(`ktab-${k}`);
    if (el) el.classList.toggle('hidden', k !== tab);
  });
}

async function loadJournalsTab(focusId) {
  const journals = await window.mindtrace.getJournals();
  $('journals-list').innerHTML = journals.map(j => {
    const demo = /示例/.test(j.title || '') || /【示例数据】/.test(j.content || '');
    const hl = focusId && j.id === focusId;
    return `<div class="list-item${hl ? ' highlight' : ''}" style="grid-template-columns: 100px 1fr" data-id="${escapeHtml(j.id)}" id="journal-${escapeHtml(j.id)}" data-open-journal="${escapeHtml(j.id)}">
      <div>${j.period_key}${demo ? '<span class="demo-tag">示例</span>' : ''}</div>
      <div><b>${escapeHtml(j.title || '')}</b><div class="tiny">${escapeHtml((j.content || '').slice(0, 140))}</div></div>
    </div>`;
  }).join('') || emptyState('暂无日刊', '配置 AI 后可生成本日摘要，或开启体验示例数据。');
  document.querySelectorAll('[data-open-journal]').forEach(el => {
    el.onclick = async () => {
      const id = el.getAttribute('data-open-journal');
      const r = await window.mindtrace.getById('journal', id);
      if (r.ok && r.item) openDetail('日刊', r.item.title || r.item.period_key, r.item.content || '', r.item.period_key);
    };
  });
  if (focusId) {
    const el = document.getElementById('journal-' + focusId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

async function loadTopicsTab(focusId) {
  const topics = await window.mindtrace.getTopics();
  $('topics-grid').innerHTML = topics.map(tp => {
    const demo = /【示例】/.test(tp.name || '');
    return `<div class="kcard" data-kind="project" data-id="${escapeHtml(tp.id)}" id="topic-${escapeHtml(tp.id)}">
      <div class="kind">主题${demo ? '<span class="demo-tag">示例</span>' : ''}</div>
      <h4>${escapeHtml(tp.name)}</h4>
      <p>${escapeHtml(tp.summary || '')}</p>
      <div class="tiny">关联卡片 ${(() => { try { return JSON.parse(tp.card_ids||'[]').length; } catch { return 0; } })()} · 活动 ${tp.activity_count || 0}</div>
    </div>`;
  }).join('') || emptyState('暂无主题', '开启体验示例数据，或等待 AI 聚类。');
  document.querySelectorAll('#topics-grid .kcard').forEach(card => {
    card.onclick = () => {
      const id = card.dataset.id;
      const title = card.querySelector('h4')?.textContent || '主题';
      const body = card.querySelector('p')?.textContent || '';
      openDetail('主题', title, body, '');
    };
  });
  if (focusId) document.getElementById('topic-' + focusId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function loadCardsTab(focusId) {
  const q = ($('card-q')?.value || '').trim().toLowerCase();
  let cards = await window.mindtrace.getCards({ kind: currentKind || undefined });
  if (q) cards = cards.filter(c => `${c.title} ${c.summary} ${c.content}`.toLowerCase().includes(q));
  $('cards-grid').innerHTML = cards.map(c => {
    const demo = (c.tags || '').includes('示例') || /【示例】/.test(c.title || '');
    const hl = focusId && c.id === focusId;
    return `<div class="kcard${hl ? ' highlight' : ''}" data-kind="${escapeHtml(c.kind)}" data-id="${escapeHtml(c.id)}" id="card-${escapeHtml(c.id)}">
      <div class="kind">${escapeHtml(c.kind)}${demo ? '<span class="demo-tag">示例</span>' : ''}</div>
      <h4>${escapeHtml(c.title)}</h4>
      <p>${escapeHtml(c.summary || '')}</p>
    </div>`;
  }).join('') || emptyState('暂无知识卡片', '采集一段时间后由 AI 提炼，或开启体验示例数据。');
  document.querySelectorAll('#cards-grid .kcard').forEach(card => {
    card.onclick = async () => {
      const id = card.dataset.id;
      const r = await window.mindtrace.getById('card', id);
      if (r.ok && r.item) {
        openDetail('卡片 · ' + r.item.kind, r.item.title, `${r.item.summary || ''}\n\n${r.item.content || ''}`, (r.item.tags || ''));
      }
    };
  });
  if (focusId) {
    const el = document.getElementById('card-' + focusId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function openDetail(kindLabel, title, body, meta) {
  $('detail-title').textContent = title || kindLabel;
  $('detail-meta').textContent = `${kindLabel}${meta ? ' · ' + meta : ''}`;
  $('detail-body').textContent = body || '';
  $('detail-drawer').classList.remove('hidden');
}

function renderCitations(cites) {
  if (!cites || !cites.length) return '';
  return `<div class="cite-list">${cites.map(c => {
    const label = escapeHtml((c.label || c.key || '').slice(0, 64));
    const key = escapeHtml(c.key || '');
    const id = escapeHtml(c.id || '');
    const started = c.started_at || '';
    const kind = escapeHtml(c.kind === 'card' ? 'card' : c.kind === 'journal' ? 'journal' : 'activity');
    const kindZh = kind === 'card' ? '知识卡片' : kind === 'journal' ? '日刊' : '活动';
    return `<button type="button" class="cite-card" data-cite-id="${id}" data-cite-kind="${kind}" data-started="${started}" title="${label}"><span class="k">${key} · ${kindZh}</span><span class="cite-label">${label}</span></button>`;
  }).join('')}</div>`;
}

function parseMsgCitations(m) {
  if (!m.citations) return [];
  if (Array.isArray(m.citations)) return m.citations;
  try { return JSON.parse(m.citations); } catch { return []; }
}


async function loadWiki() {
  const pages = await window.mindtrace.getWiki(wikiKind || undefined);
  const mems = await window.mindtrace.getMemories();
  $('wiki-list').innerHTML = pages.map(p => `
    <div class="list-item" style="grid-template-columns: 72px 1fr; cursor:pointer" data-slug="${escapeHtml(p.slug)}">
      <div class="tag">${escapeHtml(p.kind)}</div>
      <div><b>${escapeHtml(p.title)}</b><div class="muted tiny">${escapeHtml((p.body_md||'').slice(0,80))}</div></div>
    </div>`).join('') || emptyState('暂无 Wiki 页', '生成日卷后将出现时间卷与实体。');
  $('memory-list').innerHTML = mems.map(m => `
    <div class="list-item" style="grid-template-columns: 72px 1fr">
      <div class="tag">${escapeHtml(m.kind)}</div>
      <div>${escapeHtml(m.text)} <span class="tiny muted">· ${(m.confidence*100|0)}%</span></div>
    </div>`).join('') || emptyState('暂无记忆条目', '生成日卷或摘要后将抽取记忆。');
  document.querySelectorAll('#wiki-list .list-item').forEach(el => {
    el.onclick = () => {
      const page = pages.find(x => x.slug === el.dataset.slug);
      if (!page) return;
      $('wiki-body').classList.remove('muted');
      $('wiki-body').textContent = page.body_md || '';
      if ($('wiki-tags')) {
        const tags = [page.kind, page.period_key].filter(Boolean);
        $('wiki-tags').innerHTML = tags.map(tg => `<span class="tag-pill">${escapeHtml(tg)}</span>`).join('') || '';
      }
      if ($('wiki-backlinks')) {
        const related = pages.filter(x => x.slug !== page.slug && (x.kind === page.kind || (page.body_md||'').includes(x.title))).slice(0, 6);
        $('wiki-backlinks').innerHTML = related.length
          ? related.map(r => `<div class="backlink" data-slug="${escapeHtml(r.slug)}">${escapeHtml(r.title)}</div>`).join('')
          : '<div class="tiny">暂无反向链接</div>';
        $('wiki-backlinks').querySelectorAll('.backlink').forEach(b => {
          b.onclick = () => {
            const tgt = pages.find(x => x.slug === b.dataset.slug);
            if (!tgt) return;
            $('wiki-body').textContent = tgt.body_md || '';
            if ($('wiki-tags')) $('wiki-tags').innerHTML = `<span class="tag-pill">${escapeHtml(tgt.kind||'')}</span>`;
          };
        });
      }
    };
  });
  const budget = await window.mindtrace.getBudget();
  if (budget && $('collector-status-list')) {
    /* optional */
  }
}

async function loadChat() {
  const msgs = await window.mindtrace.getChat();
  const log = $('chat-log');
  const sug = $('chat-suggestions');
  if (!msgs.length) {
    log.innerHTML = `<div class="chat-empty">${(window.MTIcons&&MTIcons.empty)?MTIcons.empty():''}
      <h3>智能问答</h3>
      <p>用自然语言检索日刊、卡片与时间线。开启「体验示例数据」可先看带引用的样例；配置 AI 后即可真实提问。</p>
    </div>`;
    sug?.classList.remove('hidden');
  } else {
    log.innerHTML = msgs.map(m => {
      const cites = m.role === 'assistant' ? parseMsgCitations(m) : [];
      return `<div class="bubble ${m.role}">${escapeHtml(m.content)}${renderCitations(cites)}</div>`;
    }).join('');
    sug?.classList.add('hidden');
  }
  log.scrollTop = log.scrollHeight;
  bindCiteClicks(log);
}

function bindCiteClicks(root) {
  root.querySelectorAll('.cite-card, .cite-chip').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.citeId;
      const kind = btn.dataset.citeKind || 'activity';
      if (!id) return;
      if (kind === 'card') {
        showView('knowledge');
        showKnowledgeTab('cards');
        await loadCardsTab(id);
        toast('已定位到知识卡片');
        return;
      }
      if (kind === 'journal') {
        showView('knowledge');
        showKnowledgeTab('journals');
        await loadJournalsTab(id);
        toast('已定位到日刊');
        return;
      }
      showView('timeline');
      $('tl-q').value = '';
      await loadTimeline({ focusId: id, from: 0, limit: 500 });
      toast('已定位到时间线事件');
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

async function loadCollectorStatus() {
  const rows = await window.mindtrace.getCollectorStatus();
  $('collector-status-list').innerHTML = rows.map(r => {
    const st = r.status || 'idle';
    return `<div class="collector-row">
      <div><span class="status-dot ${escapeHtml(st)}"></span><b>${escapeHtml(r.name)}</b>
        <div class="tiny">${escapeHtml(r.message || '')}${r.lastError ? ' · ' + escapeHtml(r.lastError) : ''}</div>
      </div>
      <div class="tiny">${st === 'ok' ? '运行中' : st === 'error' ? '异常' : st === 'off' ? '已关' : '空闲'}</div>
    </div>`;
  }).join('') || '<div class="empty">暂无状态</div>';
}

function bind() {
  document.querySelectorAll('#nav .nav-item').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

  $('ob-next1').onclick = () => showObStep(2);
  $('ob-back2').onclick = () => showObStep(1);
  $('ob-skip2').onclick = () => { obCollectors = { window:false,browser:false,documents:false,clipboard:false,screenshots:false }; showObStep(3); };
  $('ob-next2').onclick = () => { obCollectors = readObCollectors(); showObStep(3); };
  $('ob-back3').onclick = () => showObStep(2);
  $('ob-skip3').onclick = () => showObStep(4);
  $('ob-next3').onclick = async () => {
    const key = $('ob-ai-key').value.trim();
    const patch = { ai: {
      provider: $('ob-ai-preset').value,
      baseUrl: $('ob-ai-base').value.trim(),
      model: $('ob-ai-model').value.trim(),
      visionModel: ($('ob-ai-vision') && $('ob-ai-vision').value.trim()) || ''
    } };
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
    if ($('btn-pause').dataset.mode === 'setup') { showView('collect'); return; }
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
    if (!$('view-dashboard').classList.contains('hidden')) loadDashboard();
  };
  $('btn-seed').onclick = async () => {
    const next = !state.config.demoMode;
    await window.mindtrace.setDemoMode(next);
    await refreshState();
    toast(next ? '已开启体验示例数据' : '已关闭并清除示例数据');
    showView(document.querySelector('.nav-item.active')?.dataset.view || 'dashboard');
  };
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
      loadCardsTab();
    };
  });
  document.querySelectorAll('#knowledge-tabs .chip').forEach(ch => {
    ch.onclick = () => { showKnowledgeTab(ch.dataset.ktab); loadKnowledge(); };
  });
  $('detail-close')?.addEventListener('click', () => $('detail-drawer').classList.add('hidden'));
  $('detail-drawer')?.addEventListener('click', (e) => { if (e.target.id === 'detail-drawer') e.target.classList.add('hidden'); });
  $('card-q')?.addEventListener('keydown', e => { if (e.key === 'Enter') loadCardsTab(); });
  $('btn-refresh-status')?.addEventListener('click', loadCollectorStatus);
  $('btn-open-log')?.addEventListener('click', async () => { await window.mindtrace.openLog(); });
  $('btn-extract').onclick = async () => {
    toast('正在提炼知识卡片…');
    const r = await window.mindtrace.extractCards();
    toast(r.ok ? `已更新 ${r.ids?.length || 0} 张卡片` : (r.error || '提炼失败'));
    if (r.ok) loadKnowledge();
  };
  $('btn-ask').onclick = ask;
  document.querySelectorAll('.suggest-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const q = chip.dataset.q || chip.textContent;
      $('chat-input').value = q;
      // If demo mode and sample already exists, just ensure chat shows; else ask
      ask();
    });
  });
  $('chat-input').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); ask(); } };

  $('btn-save-collect').onclick = async () => {
    const demoOn = !!$('demo-mode')?.checked;
    if (demoOn !== !!state.config.demoMode) await window.mindtrace.setDemoMode(demoOn);
    await window.mindtrace.setConfig({
      startOnBoot: $('start-boot').checked,
      collectors: {
        window: $('c-window').checked,
        browser: $('c-browser').checked,
        documents: $('c-documents').checked,
        clipboard: $('c-clipboard').checked,
        screenshots: $('c-screenshots').checked,
        notes: !!$('c-notes')?.checked,
        ide: !!$('c-ide')?.checked,
        downloads: !!$('c-downloads')?.checked,
        files: !!$('c-files')?.checked,
        uia: !!$('c-uia')?.checked
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
        visionModel: ($('ai-vision') && $('ai-vision').value.trim()) || '',
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
  
  document.querySelectorAll('#tl-zoom .chip').forEach(ch => {
    ch.addEventListener('click', () => {
      document.querySelectorAll('#tl-zoom .chip').forEach(x => x.classList.remove('active'));
      ch.classList.add('active');
      timelineZoom = ch.dataset.zoom;
      loadTimeline();
    });
  });
  document.querySelectorAll('#wiki-kind-chips .chip').forEach(ch => {
    ch.addEventListener('click', () => {
      document.querySelectorAll('#wiki-kind-chips .chip').forEach(x => x.classList.remove('active'));
      ch.classList.add('active');
      wikiKind = ch.dataset.wkind || '';
      loadWiki();
    });
  });
  $('btn-build-day')?.addEventListener('click', async () => {
    toast('正在生成日卷…');
    const r = await window.mindtrace.buildRollup({ level: 'day' });
    toast(r.ok ? '日卷已生成' : (r.error || '失败'));
    loadWiki();
  });
  $('btn-build-hour')?.addEventListener('click', async () => {
    toast('正在生成小时卷…');
    const r = await window.mindtrace.buildRollup({ level: 'hour' });
    toast(r.ok ? '小时卷已生成' : (r.error || '失败'));
    loadWiki();
  });
  const openQn = () => { $('quick-note-modal')?.classList.remove('hidden'); $('qn-body')?.focus(); };
  const closeQn = () => $('quick-note-modal')?.classList.add('hidden');
  $('qn-cancel')?.addEventListener('click', closeQn);
  $('qn-save')?.addEventListener('click', async () => {
    await window.mindtrace.addQuickNote({ title: $('qn-title').value.trim(), content: $('qn-body').value.trim() });
    $('qn-title').value = ''; $('qn-body').value = '';
    closeQn(); toast('速记已保存');
  });
  window.mindtrace.onQuickNote?.(() => { showView('dashboard'); openQn(); });


  // Enterprise chrome: sidebar, command palette, window controls
  $('btn-sidebar-toggle')?.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-collapsed');
  });
  $('win-min')?.addEventListener('click', () => window.mindtrace.windowMinimize?.());
  $('win-max')?.addEventListener('click', () => window.mindtrace.windowMaximize?.());
  $('win-close')?.addEventListener('click', () => window.mindtrace.windowClose?.());

  const runFts = async (q) => {
    const hits = await window.mindtrace.searchFts(q);
    showView('timeline');
    timelineZoom = 'day';
    document.querySelectorAll('#tl-zoom .chip').forEach(c => c.classList.toggle('active', c.dataset.zoom === 'day'));
    if ($('tl-q')) $('tl-q').value = q;
    $('timeline-list').innerHTML = hits.map(h => `
      <div class="tl-item" data-type="${escapeHtml(h.type||'')}"><div class="time"><div class="tag">${escapeHtml(typeLabel(h.type)||'')}</div></div>
      <div class="tl-card"><div><b>${escapeHtml(h.app||'')}</b> ${escapeHtml(h.title||'')}</div>
      <div class="meta">${escapeHtml((h.content||'').slice(0,120))}</div></div></div>`).join('') || emptyState('无全文结果', '换个关键词试试');
  };
  const cmdItems = (q) => {
    const base = [
      { label: '今日总览', hint: '页面', run: () => showView('dashboard') },
      { label: '时间线', hint: '页面', run: () => showView('timeline') },
      { label: '知识库', hint: '页面', run: () => showView('knowledge') },
      { label: 'Wiki', hint: '页面', run: () => showView('wiki') },
      { label: '智能问答', hint: '页面', run: () => showView('chat') },
      { label: '采集中心', hint: '页面', run: () => showView('collect') },
      { label: '设置', hint: '页面', run: () => showView('ai') },
      { label: '生成本日摘要', hint: '操作', run: () => $('btn-summarize')?.click() },
      { label: '导出知识库', hint: '操作', run: () => $('btn-export')?.click() },
      { label: '打开速记', hint: '操作', run: () => { $('quick-note-modal')?.classList.remove('hidden'); $('qn-body')?.focus(); } },
      { label: '切换深色 / 浅色主题', hint: '外观', run: () => $('btn-theme')?.click() },
      { label: '暂停 / 恢复采集', hint: '采集', run: () => $('btn-pause')?.click() }
    ];
    const qq = (q || '').trim();
    if (qq) base.unshift({ label: `搜索「${qq}」`, hint: '全文', run: () => runFts(qq) });
    return base;
  };
  function renderCmd(q) {
    const qq = (q || '').trim().toLowerCase();
    const items = cmdItems(q).filter(it => !qq || it.label.toLowerCase().includes(qq) || it.hint.includes(qq) || it.hint === '全文');
    $('cmd-results').innerHTML = items.map((it, i) =>
      `<button type="button" class="cmd-item${i===0?' active':''}" data-idx="${i}"><span>${escapeHtml(it.label)}</span><span class="hint">${escapeHtml(it.hint)}</span></button>`
    ).join('') || '<div class="empty" style="padding:20px">无匹配命令</div>';
    $('cmd-results').querySelectorAll('.cmd-item').forEach(btn => {
      btn.onclick = () => {
        const it = items[Number(btn.dataset.idx)];
        closeCmd();
        it?.run?.();
      };
    });
  }
  function openCmd() {
    $('cmd-overlay')?.classList.remove('hidden');
    $('cmd-input').value = '';
    renderCmd('');
    setTimeout(() => $('cmd-input')?.focus(), 30);
  }
  function closeCmd() { $('cmd-overlay')?.classList.add('hidden'); }
  $('btn-cmd-open')?.addEventListener('click', openCmd);
  $('cmd-overlay')?.addEventListener('click', (e) => { if (e.target.id === 'cmd-overlay') closeCmd(); });
  $('cmd-input')?.addEventListener('input', () => renderCmd($('cmd-input').value));
  $('cmd-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCmd();
    if (e.key === 'Enter') {
      const first = $('cmd-results')?.querySelector('.cmd-item');
      first?.click();
    }
  });
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if ($('cmd-overlay')?.classList.contains('hidden')) openCmd(); else closeCmd();
    }
    if (e.key === 'Escape') closeCmd();
  });

  window.mindtrace.onStatus(async (data) => {
    await refreshState();
    if (data?.toast) toast(data.toast);
  });
}

async function ask() {
  const q = $('chat-input').value.trim();
  if (!q) return;
  $('chat-input').value = '';
  $('chat-suggestions')?.classList.add('hidden');
  const log = $('chat-log');
  log.insertAdjacentHTML('beforeend', `<div class="bubble user">${escapeHtml(q)}</div>`);
  log.insertAdjacentHTML('beforeend', `<div class="bubble assistant muted" id="thinking">正在检索你的历史…</div>`);
  log.scrollTop = log.scrollHeight;
  const r = await window.mindtrace.ask(q);
  $('thinking')?.remove();
  if (!r.ok) {
    const needKey = /key|配置/i.test(r.error || '');
    log.insertAdjacentHTML('beforeend', `<div class="bubble assistant error">${needKey ? '还没有配置 AI 模型，暂时无法生成回答。' : '回答生成失败：' + escapeHtml(r.error)}<br><button class="btn sm" onclick="document.querySelector('[data-view=ai]').click()">${needKey ? '去设置 AI 模型' : '打开设置检查'}</button></div>`);
  } else {
    const wrap = document.createElement('div');
    wrap.className = 'bubble assistant';
    wrap.innerHTML = `${escapeHtml(r.answer).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}${renderCitations(r.citations || [])}`;
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
  try {
    const ver = await window.mindtrace.getAppVersion?.();
    if (ver && $('app-version-label')) $('app-version-label').textContent = `v${ver} · Ctrl+Shift+M`;
  } catch (_) {}
  showView('dashboard');
  window.addEventListener('resize', () => {
    if (document.querySelector('#view-dashboard:not(.hidden)') && window.MTCharts) {
      // soft redraw on next dash load; skip heavy work
    }
  });
})();
