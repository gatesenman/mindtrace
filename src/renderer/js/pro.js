/* v2.2 专业功能：洞察 · 隐私规则 · 审计 · 记忆审核 · 用量预算 · 任务队列 · 备份 · MCP */
(function () {
  const mt = window.mindtrace;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => escapeHtml(s == null ? '' : String(s));
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const dt = (ts) => { const d = new Date(ts); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm(ts)}`; };
  const mins = (m) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + 'm' : ''}`.trim());
  const empty = (t, s) => `<tr><td colspan="9"><div class="empty" style="padding:20px;border:0">${esc(t)}${s ? `<p>${esc(s)}</p>` : ''}</div></td></tr>`;
  const STATUS = { queued: ['排队', 'flat'], running: ['运行中', 'info'], done: ['成功', 'ok'], failed: ['失败', 'err'] };
  const MODE = { none: '不采集', title: '仅标题', full: '完整' };

  titles.insights = ['洞察', '专注会话 · 上下文切换 · 深度工作 · 本周回顾'];
  titles.collect = ['采集中心', '分项开关 · 隐私规则 · 审计日志 · 数据清除'];
  titles.ai = ['设置', 'AI 模型 · 用量预算 · 任务队列 · 备份 · MCP · 关于'];

  const _show = window.showView;
  window.showView = function (name) {
    _show(name);
    const m = document.querySelector('.main'); if (m) m.scrollTo({ top: 0, behavior: 'instant' });
    if (name === 'insights') loadInsights();
    if (name === 'collect') loadPrivacy();
    if (name === 'ai') loadSettingsPro();
  };

  /* ── 洞察 ── */
  let allocMode = 'apps', lastA = null;
  async function loadInsights() {
    const [a, w] = await Promise.all([mt.proAnalytics({}), mt.proWeekly()]);
    lastA = a;
    $('in-score').textContent = a.events ? a.deepWorkScore : '—';
    $('in-deep').textContent = mins(a.deepWorkMinutes || 0);
    $('in-switch').textContent = a.contextSwitches ?? 0;
    $('in-switch-sub').textContent = `${a.switchesPerHour || 0} 次/小时`;
    $('in-afk').textContent = mins(a.afkMinutes || 0);
    $('in-sess-n').textContent = `${a.focusSessions.length} 段`;
    $('in-sessions').innerHTML = a.focusSessions.map(s => `<tr><td class="num">${hm(s.start)}–${hm(s.end)}</td><td class="num"><b>${mins(s.minutes)}</b></td><td>${s.apps.map(x => `<span class="tag-pill">${esc(x)}</span>`).join('')}</td></tr>`).join('') || empty('今天还没有 ≥25 分钟的专注会话', '连续使用同一组应用、中断不超过 5 分钟即计为一段。');
    renderAlloc();
    const max = Math.max(1, ...w.days.map(d => d.minutes));
    $('in-week').innerHTML = w.days.map(d => `<tr><td class="num">${d.day.slice(5)}</td><td><div class="mini-bar"><span style="width:${Math.round(d.minutes / max * 100)}%"></span></div><span class="num tiny">${mins(d.minutes)}</span></td><td class="num">${mins(d.deep)}</td><td class="num">${d.minutes ? d.score : '—'}</td><td class="num">${d.switches}</td></tr>`).join('');
    $('in-week-sum').textContent = `本周活跃 ${mins(w.totalMinutes)} · 深度工作 ${mins(w.deepWorkMinutes)} · 专注分 ${w.events ? w.deepWorkScore : '—'}`;
  }
  function renderAlloc() {
    if (!lastA) return;
    const rows = (lastA[allocMode] || []).map(r => ({ app_name: r.name, total_ms: r.minutes * 60000 }));
    if (!rows.length) { $('in-alloc').innerHTML = `<div class="empty" style="border:0">${allocMode === 'projects' ? '暂无项目数据（来自 IDE 窗口标题）' : '暂无应用数据'}</div>`; return; }
    MTCharts.appsRank($('in-alloc'), rows);
  }
  document.querySelectorAll('[data-alloc]').forEach(c => c.onclick = () => {
    document.querySelectorAll('[data-alloc]').forEach(x => x.classList.toggle('active', x === c));
    allocMode = c.dataset.alloc; renderAlloc();
  });

  /* ── 隐私规则 / 审计 / 清除 ── */
  let rules = [];
  async function loadPrivacy() {
    const r = await mt.proGetRules();
    rules = r.rules.slice();
    $('pr-sensitive').checked = r.sensitiveDetection;
    renderRules();
    loadAudit();
  }
  function renderRules() {
    $('rules-body').innerHTML = rules.map((r, i) => `<tr>
      <td><input class="input sm" data-ri="${i}" data-rf="match" value="${esc(r.match)}" placeholder="如 WeChat 或 bank.com" /></td>
      <td><select class="input sm" data-ri="${i}" data-rf="scope"><option value="app"${r.scope === 'app' ? ' selected' : ''}>应用</option><option value="site"${r.scope === 'site' ? ' selected' : ''}>网站</option></select></td>
      <td><select class="input sm" data-ri="${i}" data-rf="mode">${Object.entries(MODE).map(([k, v]) => `<option value="${k}"${r.mode === k ? ' selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><button class="btn ghost sm" data-rdel="${i}" title="删除">删除</button></td></tr>`).join('') || empty('暂无自定义规则', '未命中规则时使用黑名单与敏感窗口自动检测。');
    document.querySelectorAll('[data-ri]').forEach(el => el.onchange = () => { rules[+el.dataset.ri][el.dataset.rf] = el.value; });
    document.querySelectorAll('[data-rdel]').forEach(el => el.onclick = () => { rules.splice(+el.dataset.rdel, 1); renderRules(); });
  }
  $('btn-rule-add').onclick = () => { rules.push({ match: '', scope: 'app', mode: 'title' }); renderRules(); };
  $('btn-rules-save').onclick = async () => {
    const r = await mt.proSetRules({ rules: rules.filter(x => x.match.trim()), sensitiveDetection: $('pr-sensitive').checked });
    toast(r.ok ? '隐私规则已保存' : '保存失败：' + r.error); loadPrivacy();
  };
  let auditKind = '';
  const AK = { capture: '采集', mcp: 'MCP', llm: '模型', wipe: '清除', backup: '备份', privacy: '隐私', restore: '恢复' };
  async function loadAudit() {
    const rows = await mt.proAudit({ kind: auditKind || undefined, limit: 200 });
    $('audit-body').innerHTML = rows.map(r => `<tr><td class="num nowrap">${dt(r.ts)}</td><td><span class="tag-pill">${esc(AK[r.kind] || r.kind)}</span></td><td>${esc(r.action)}</td><td>${esc(r.target || '')}</td><td class="tiny muted ellip" title="${esc(r.detail || '')}">${esc((r.detail || '').slice(0, 80))}</td></tr>`).join('') || empty('暂无审计记录');
  }
  document.querySelectorAll('[data-akind]').forEach(c => c.onclick = () => {
    document.querySelectorAll('[data-akind]').forEach(x => x.classList.toggle('active', x === c));
    auditKind = c.dataset.akind; loadAudit();
  });
  const toLocal = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${hm(ts)}`; };
  document.querySelectorAll('[data-wipe]').forEach(c => c.onclick = () => { const now = Date.now(); $('wipe-from').value = toLocal(now - c.dataset.wipe * 60000); $('wipe-to').value = toLocal(now + 60000); });
  $('btn-wipe').onclick = async () => {
    const from = new Date($('wipe-from').value).getTime(), to = new Date($('wipe-to').value).getTime();
    if (!from || !to || to <= from) return toast('请选择有效的时间范围');
    if (!confirm(`确定永久删除 ${dt(from)} 至 ${dt(to)} 的全部采集数据？此操作不可撤销。`)) return;
    const r = await mt.proWipeRange({ from, to });
    toast(r.ok ? `已清除 ${r.activities} 条活动、${r.screenshots} 张截屏` : '清除失败：' + r.error); loadAudit();
  };

  /* ── 记忆审核 ── */
  let memStatus = 'active';
  const _loadWiki = window.loadWiki;
  window.loadWiki = async function () { await _loadWiki(); await renderMemories(); };
  async function renderMemories() {
    if (!$('memory-list')) return; // v2.3 记忆页由 v23.js 渲染
    const [c, list] = await Promise.all([mt.proMemoryCounts(), mt.proReviewQueue(memStatus)]);
    ['active', 'pending', 'rejected'].forEach(k => { if ($('mc-' + k)) $('mc-' + k).textContent = c[k] || 0; });
    $('memory-list').innerHTML = list.map(m => `
      <div class="mem-item" data-mid="${esc(m.id)}">
        <div class="mem-top"><span class="tag">${esc(m.kind)}</span><span class="tiny muted num">置信度 ${Math.round((m.confidence || 0) * 100)}%</span></div>
        <div class="mem-text">${escTitle(m.text)}</div>
        ${memStatus !== 'active' ? `<div class="mem-actions"><button class="btn sm primary" data-mact="approve">通过</button><button class="btn sm" data-mact="edit">编辑</button>${memStatus === 'pending' ? '<button class="btn sm ghost" data-mact="reject">驳回</button>' : ''}</div>` : `<div class="mem-actions"><button class="btn sm ghost" data-mact="reject">撤回</button></div>`}
      </div>`).join('') || emptyState(memStatus === 'pending' ? '没有待审记忆' : '暂无记忆条目', memStatus === 'pending' ? '低于置信阈值的记忆会进入这里，审核通过后才对问答与 MCP 可见。' : '生成日卷或摘要后将抽取记忆。');
    document.querySelectorAll('[data-mact]').forEach(b => b.onclick = async () => {
      const id = b.closest('[data-mid]').dataset.mid;
      let text;
      if (b.dataset.mact === 'edit') {
        const el = b.closest('.mem-item').querySelector('.mem-text');
        if (!el.isContentEditable) { el.contentEditable = 'true'; el.classList.add('editing'); el.focus(); b.textContent = '保存'; return; }
        text = el.textContent.trim();
      }
      const r = await mt.proReview({ id, action: b.dataset.mact, text });
      if (r && r.ok === false) toast('操作失败：' + r.error);
      if (b.dataset.mact === 'edit') await mt.proReview({ id, action: 'approve' });
      renderMemories();
    });
  }
  document.querySelectorAll('[data-mstatus]').forEach(c => c.onclick = () => {
    document.querySelectorAll('[data-mstatus]').forEach(x => x.classList.toggle('active', x === c));
    memStatus = c.dataset.mstatus; renderMemories();
  });

  /* ── 设置：用量 / 队列 / 备份 / MCP ── */
  const JOBN = { summarize: '今日摘要', rollup: 'Wiki 汇总卷', flaky: '测试任务' };
  async function loadSettingsPro() {
    const [u, rr, jobs, info] = await Promise.all([mt.proUsage(), mt.proGetRules(), mt.proJobs(), mt.proMcpInfo()]);
    $('us-cost').textContent = '$' + (u.month.cost || 0).toFixed(2);
    if ($('us-cost-cny')) $('us-cost-cny').textContent = u.month.costCny != null ? `≈ ¥${u.month.costCny}` : '';
    if ($('us-today')) $('us-today').textContent = '$' + ((u.today && u.today.cost) || 0).toFixed(3);
    if ($('us-today-meta')) $('us-today-meta').textContent = u.today ? `${u.today.calls || 0} 次 · ${(u.today.tokens || 0).toLocaleString()} tok` : '';
    $('us-tokens').textContent = (u.month.tokens || 0).toLocaleString();
    $('us-calls').textContent = u.month.calls || 0;
    $('us-budget').value = u.cap || 0;
    $('pr-localonly').checked = rr.localOnly;
    const pct = u.cap ? Math.min(100, Math.round(u.month.cost / u.cap * 100)) : 0;
    $('us-bar').style.width = pct + '%';
    $('us-bar').className = pct >= 90 ? 'err' : pct >= 70 ? 'warn' : '';
    $('us-cap-text').textContent = u.cap ? `已用 ${pct}% · 预算 $${u.cap}/月，剩余 $${(u.remaining || 0).toFixed(2)}，超出后自动停止调用` : '未设置预算（不限）';
    const PURPOSE = { 'llm:chat': '问答', 'llm:extract': '抽取', 'llm:vision': '识图', 'llm:test': '测试', summarize: '摘要', rollup: '汇总', chat: '问答', extract: '抽取', vision: '识图', journal: '日报' };
    if ($('us-purpose')) $('us-purpose').innerHTML = (u.byPurpose || []).map(m => `<tr><td>${esc(PURPOSE[m.purpose] || m.purpose || '其他')}</td><td class="num">${m.calls}</td><td class="num">${(m.tokens || 0).toLocaleString()}</td><td class="num">$${(m.cost || 0).toFixed(3)}</td></tr>`).join('') || empty('暂无');
    if ($('us-daybar')) {
      const days = (u.byDay || []).slice(0, 14).reverse();
      const max = Math.max(0.001, ...days.map(d => d.cost || 0));
      $('us-daybar').innerHTML = days.map(d => `<i style="height:${Math.max(4, Math.round((d.cost || 0) / max * 100))}%" title="$${(d.cost || 0).toFixed(3)} · ${d.calls} 次"></i>`).join('') || '<span class="tiny muted">近 14 日无调用</span>';
    }
    $('us-models').innerHTML = (u.byModel || []).map(m => `<tr><td>${esc(m.model)}</td><td class="num">${m.calls}</td><td class="num">${((m.pt || 0) + (m.ct || 0)).toLocaleString()}</td><td class="num">$${(m.cost || 0).toFixed(3)}</td><td class="num">${Math.round(m.avg_ms || 0)} ms</td><td class="num">${m.failed || 0}</td></tr>`).join('') || empty('本月暂无调用');
    renderJobs(jobs);
    renderMcp(info);
  }
  function renderJobs(jobs) {
    $('jobs-body').innerHTML = jobs.map(j => { const [t, c] = STATUS[j.status] || [j.status, 'flat']; return `<tr><td>${esc(JOBN[j.kind] || j.kind)}${j.error ? `<div class="tiny err-text" title="${esc(j.error)}">${esc(j.error.slice(0, 60))}</div>` : ''}</td><td><span class="status-dot ${c}"></span>${t}</td><td class="num">${j.attempts}</td><td class="num nowrap">${dt(j.created_at)}</td><td>${j.status === 'failed' ? `<button class="btn sm" data-retry="${esc(j.id)}">重试</button>` : ''}</td></tr>`; }).join('') || empty('暂无任务', '生成摘要、汇总卷等 LLM 任务会在此排队并可失败重试。');
    document.querySelectorAll('[data-retry]').forEach(b => b.onclick = async () => { b.disabled = true; b.textContent = '重试中…'; const r = await mt.proRetryJob(b.dataset.retry); toast(r.ok ? '重试成功' : '仍然失败：' + r.error); renderJobs(await mt.proJobs()); });
  }
  $('btn-jobs-refresh').onclick = async () => renderJobs(await mt.proJobs());
  $('btn-usage-save').onclick = async () => {
    const r = await mt.proSetRules({ monthlyBudgetUsd: Number($('us-budget').value) || 0, localOnly: $('pr-localonly').checked });
    toast(r.ok ? '已保存' : r.error); loadSettingsPro();
  };
  let mcpInfo = null, mcpTab = 'cursor';
  function mcpConfig() {
    if (!mcpInfo) return '';
    const headers = { Authorization: `Bearer ${mcpInfo.token || ''}` };
    if (mcpTab === 'cursor') return JSON.stringify({ mcpServers: { mindtrace: { url: mcpInfo.url, headers } } }, null, 2);
    return JSON.stringify({ mcpServers: { mindtrace: { command: 'npx', args: ['-y', 'mcp-remote', mcpInfo.url, '--header', `Authorization:Bearer ${mcpInfo.token || ''}`] } } }, null, 2);
  }
  function renderMcp(info) {
    mcpInfo = info;
    $('mcp-url').textContent = info.url;
    $('mcp-state').textContent = info.enabled ? '运行中' : '未启用';
    $('mcp-state').className = 'tag-pill ' + (info.enabled ? 'ok' : '');
    $('mcp-config').textContent = mcpConfig().replace(/Bearer [A-Za-z0-9]+/g, m => m.slice(0, 13) + '••••••');
    $('mcp-tools').innerHTML = '可用工具：' + info.tools.map(t => `<code title="${esc(t.description)}">${esc(t.name)}</code>`).join(' ');
  }
  document.querySelectorAll('[data-mcp]').forEach(c => c.onclick = () => {
    document.querySelectorAll('[data-mcp]').forEach(x => x.classList.toggle('active', x === c));
    mcpTab = c.dataset.mcp; if (mcpInfo) renderMcp(mcpInfo);
  });
  $('btn-mcp-copy').onclick = async () => { await navigator.clipboard.writeText(mcpConfig()); toast('已复制 MCP 配置（含令牌）'); };
  $('btn-backup').onclick = async () => {
    const pass = $('bk-pass').value;
    if (pass.length < 8) return toast('口令至少 8 位');
    const r = await mt.proBackup({ passphrase: pass });
    if (r.canceled) return;
    $('bk-status').textContent = r.ok ? `已导出 ${r.path || ''}（${Math.round((r.bytes || 0) / 1024)} KB）` : '导出失败：' + r.error;
  };
  $('btn-restore').onclick = async () => {
    if (!confirm('恢复将用备份内容替换当前全部数据，继续？')) return;
    const r = await mt.proRestore({ passphrase: $('bk-pass').value });
    if (r.canceled) return;
    $('bk-status').textContent = r.ok ? '恢复完成，正在刷新…' : '恢复失败：' + r.error;
    if (r.ok) setTimeout(() => location.reload(), 800);
  };
  $('btn-diag').onclick = async () => { const r = await mt.proDiagnostics(); if (!r.canceled) toast(r.ok ? '诊断包已导出（密钥已脱敏）' : r.error); };

  window.MTPro = { loadInsights, loadPrivacy, loadSettingsPro, renderMemories };
})();
