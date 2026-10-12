/* v2.3：知识库 · 日历（计划/实际双轨）· 待处理中心 · 记忆 2.0 · 今日合并视图 */
(function () {
  const mt = window.mindtrace;
  if (!mt || !mt.v23) return;
  const call = (ch, arg) => mt.v23(ch, arg);
  const $ = (id) => document.getElementById(id);
  const esc = (s) => escapeHtml(s == null ? '' : String(s));
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const ymd = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const md = (ts) => { const d = new Date(ts); return `${d.getMonth() + 1}月${d.getDate()}日`; };
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const dayStart = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const DAY = 86400000;
  const demoTag = (o) => (o && (o.demo || o._demoPrefix) ? '<span class="demo-tag">示例</span>' : '');
  const txt = (o, k = 'text') => { const s = String((o && o[k]) || ''); if (/^【示例(数据)?】/.test(s)) { o._demoPrefix = true; return esc(s.replace(/^【示例(数据)?】\s*/, '')); } return esc(s); };
  const TYPE = { person: '人物', project: '项目', tool: '工具', topic: '主题', org: '组织', concept: '概念', source: '资料' };
  const MEMT = { preference: '偏好', habit: '习惯', skill: '技能', relationship: '关系', fact_self: '个人事实', decision: '决策', project: '项目', episodic: '情景' };
  const KIND = { meeting: '会议', todo: '待办', deadline: '截止', reminder: '提醒', commitment: '承诺', focus: '专注', event: '事件' };
  const rel = (ts) => { const s = (Date.now() - ts) / 1000; if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' 分钟前'; if (s < 86400) return Math.round(s / 3600) + ' 小时前'; return Math.round(s / 86400) + ' 天前'; };

  Object.assign(titles, {
    kb: ['知识库', '资料 → 实体 → 事实，带引用的实体页；「我的笔记」永不被 AI 改写'],
    calendar: ['日历', '计划轨（会议 / 待办 / 截止）与实际轨（活动块）对照'],
    inbox: ['待处理', '记忆审核 · 日程建议 · 改期 · 实体合并 · 事实冲突，一处处理'],
    memory: ['记忆', '关于你的偏好、习惯、技能、关系与决策：带证据、会衰减、可锁定'],
    wiki: ['时间卷', '小时 / 日 / 周 / 月 汇总卷与历史 Wiki 页面']
  });

  /* ───── 视图挂载 ───── */
  const _show = window.showView;
  window.showView = function (name) {
    _show(name);
    if (name === 'kb') KB.load();
    if (name === 'calendar') CAL.load();
    if (name === 'inbox') INBOX.load();
    if (name === 'dashboard') TODAY.load();
    refreshBadge();
  };
  // Ctrl+1..9：总览 / 时间线 / 知识库 / 记忆 / 报告 / 问答 / 洞察 / 日历 / 待处理
  const ORDER = ['dashboard', 'timeline', 'kb', 'memory', 'knowledge', 'chat', 'insights', 'calendar', 'inbox'];
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); showView(ORDER[Number(e.key) - 1]); }
  }, true);

  async function refreshBadge() {
    const c = await call('v23-inbox-counts'); const b = $('nav-inbox-badge'); if (!b || !c) return;
    b.textContent = c.total; b.classList.toggle('hidden', !c.total);
  }
  $('btn-h-kb-run')?.addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true; const t = b.textContent; b.innerHTML = '<span class="spinner"></span>整理中';
    const r = await call('v23-run-pipeline'); b.disabled = false; b.textContent = t;
    if (r?.error) toast('整理失败：' + r.error, { type: 'error' });
    else toast(`已整理：${r?.newChunks || 0} 个新资料块 · ${r?.batches || 0} 批抽取 · 更新 ${r?.pages || 0} 个实体页`, { type: 'success' });
    reloadCurrent();
  });
  function reloadCurrent() { const v = document.querySelector('#nav .nav-item.active')?.dataset.view; if (v) window.showView(v); }
  mt.onV23?.('v23-changed', () => { refreshBadge(); const v = document.querySelector('#nav .nav-item.active')?.dataset.view; if (['kb', 'calendar', 'inbox', 'memory', 'dashboard'].includes(v)) window.showView(v); });
  mt.onV23?.('open-view', (d) => { if (d?.view) showView(d.view); });
  mt.onV23?.('reminder', (n) => {
    document.querySelector('.reminder-banner')?.remove();
    const el = document.createElement('div'); el.className = 'reminder-banner'; el.setAttribute('role', 'alert');
    el.innerHTML = `<div class="v-row"><span class="v-pill brand">提醒</span><b class="v-grow">${esc(n.title)}</b></div><div class="v-meta" style="margin:6px 0 10px">${esc(n.body)}</div><div class="v-row"><button class="btn sm" data-a="snooze">稍后 10 分钟</button><button class="btn sm" data-a="open">打开日历</button><button class="btn sm ghost" data-a="close">知道了</button></div>`;
    document.body.appendChild(el);
    el.addEventListener('click', async (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return; if (a === 'snooze') { await call('v23-calendar-snooze', { id: n.id, minutes: 10 }); toast('将在 10 分钟后再次提醒', { type: 'success' }); } if (a === 'open') showView('calendar'); el.remove(); });
  });

  /* 简单 markdown 渲染：脚注 → 上标，脚注定义 → 引用列表 */
  function renderPage(body) {
    let fm = ''; let txt = String(body || '');
    const m = /^---\n([\s\S]*?)\n---\n/.exec(txt); if (m) { fm = m[1]; txt = txt.slice(m[0].length); }
    const lines = txt.split('\n'); const cites = []; const main = [];
    let notes = null;
    for (const l of lines) { const f = /^\[\^(\d+)\]:\s*(.*)$/.exec(l); if (f) cites.push([f[1], f[2]]); else main.push(l); }
    let mdText = main.join('\n').replace(/\n---\s*$/, '');
    const ni = mdText.indexOf('## 我的笔记');
    if (ni >= 0) { notes = mdText.slice(ni); mdText = mdText.slice(0, ni); }
    let summary = ''; mdText = mdText.replace(/^> (.*)$/m, (_, s) => { summary = s; return ''; });
    let html = renderMarkdown(mdText).replace(/(<h1>.*?<\/h1>)/, `$1<div class="kb-summary">${esc(summary)}</div>`);
    html = html.replace(/\[\^(\d+)\]/g, '<a class="fn-ref" data-fn="$1">[$1]</a>');
    html = html.replace(/\[\[([^\]]+)\]\]/g, '<a class="wikilink" data-kbname="$1">$1</a>');
    const front = fm.split('\n').map(l => l.split(': ')).filter(x => x.length === 2 && ['first_seen', 'last_seen', 'sources', 'aliases'].includes(x[0]));
    const fmHtml = front.map(([k, v]) => `<span class="v-pill">${esc({ first_seen: '首次', last_seen: '最近', sources: '资料数', aliases: '别名' }[k])} · ${esc(v.replace(/^\[|\]$/g, '') || '—')}</span>`).join('');
    const citeHtml = cites.length ? `<ol class="kb-cites">${cites.map(([n, t]) => `<li id="fn-${n}" data-n="${n}">${esc(t.replace(/ · mt:\/\/event\/[\w-]+$/, ''))}</li>`).join('')}</ol>` : '';
    return { fmHtml, html, citeHtml, stale: /stale: true/.test(fm) };
  }

  /* ═════════ 知识库 ═════════ */
  const KB = {
    filter: '', q: '', sel: null, tab: 'page',
    async load() {
      const root = $('kb-root');
      if (!root.dataset.ready) {
        root.dataset.ready = '1';
        root.innerHTML = `<div class="v-kpis" id="kb-kpis"></div>
          <div class="v-split">
            <div class="card"><div class="v-row" style="margin-bottom:10px"><input class="v-input v-grow" id="kb-q" placeholder="搜索实体 / 拼音，如 zhangsan"></div>
              <div class="chips" id="kb-filter" style="margin-bottom:8px">${[['', '全部'], ['person', '人物'], ['project', '项目'], ['tool', '工具'], ['topic', '主题'], ['candidate', '候选']].map(([k, l]) => `<button class="chip${k === '' ? ' active' : ''}" data-k="${k}">${l}</button>`).join('')}</div>
              <div id="kb-list" class="v-scroll"></div></div>
            <div class="card kb-page"><div class="v-tabs" id="kb-tabs"><button data-t="page" class="active">实体页</button><button data-t="facts">事实与证据</button><button data-t="hist">修订历史</button><button data-t="log">变更日志</button></div><div id="kb-main"></div></div>
            <div class="v-side-r" id="kb-side"></div>
          </div>`;
        $('kb-q').addEventListener('input', (e) => { KB.q = e.target.value.trim(); clearTimeout(KB._t); KB._t = setTimeout(() => KB.list(), 180); });
        $('kb-filter').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; KB.filter = b.dataset.k; $('kb-filter').querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === b)); KB.list(); });
        $('kb-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (!b) return; KB.tab = b.dataset.t; $('kb-tabs').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); KB.render(); });
        $('kb-list').addEventListener('click', (e) => { const it = e.target.closest('[data-id]'); if (it) KB.open(it.dataset.id); });
        $('kb-main').addEventListener('click', (e) => {
          const f = e.target.closest('.fn-ref'); if (f) { const li = $('fn-' + f.dataset.fn); if (li) { li.scrollIntoView({ block: 'center', behavior: 'smooth' }); li.classList.add('flash'); setTimeout(() => li.classList.remove('flash'), 1400); } return; }
          const w = e.target.closest('[data-kbname]'); if (w) { KB.open(w.dataset.kbname); return; }
          const r = e.target.closest('[data-rev]'); if (r) KB.showRev(r.dataset.rev);
        });
      }
      const o = await call('v23-overview');
      if (o?.kb) {
        const k = o.kb;
        $('kb-kpis').innerHTML = [['资料', k.documents, '归一化后的文档'], ['资料块', k.chunks, `检索引擎 ${o.fts?.mode?.toUpperCase() || '—'}`], ['实体', k.entities, `候选 ${k.candidates}（≥2 次目击转正）`], ['事实', k.claims, '100% 带引用'], ['冲突', k.conflicts, '在「待处理」确认'], ['实体页', k.pages, o.last ? '上次整理 ' + rel(o.last.ts) : '尚未整理']]
          .map(([l, v, s]) => `<div class="card v-kpi"><div class="label">${l}</div><div class="value">${v ?? 0}</div><div class="sub">${esc(s)}</div></div>`).join('');
      }
      await KB.list();
      if (!KB.sel) { const first = $('kb-list').querySelector('[data-id]'); if (first) KB.open(first.dataset.id); else KB.render(); } else KB.open(KB.sel);
    },
    async list() {
      const o = KB.filter === 'candidate' ? { status: 'candidate' } : { type: KB.filter || undefined };
      if (KB.q) o.q = KB.q;
      const rows = await call('v23-kb-entities', o) || [];
      $('kb-list').innerHTML = rows.length ? rows.map(e => `<div class="v-list-item${e.id === KB.sel ? ' active' : ''}" data-id="${e.id}">
          <div class="v-avatar ${e.type}">${esc((e.name || '?').slice(0, 1))}</div>
          <div class="v-grow"><div class="v-title">${esc(e.name)}${demoTag(e)}</div>
          <div class="v-meta">${TYPE[e.type] || e.type} · ${e.doc_count} 份资料 · ${e.day_count} 天${e.conflicts ? ` · <span style="color:var(--warning)">${e.conflicts} 冲突</span>` : ''}</div></div>
          ${e.status === 'candidate' ? '<span class="v-pill">候选</span>' : (e.staleness >= 1.5 ? '<span class="v-pill warn">可能过时</span>' : '')}</div>`).join('')
        : `<div class="v-empty">${KB.q ? '没有匹配的实体' : '还没有实体。开启采集后点击右上角「立即整理」，或打开体验示例。'}</div>`;
    },
    async open(id) {
      const d = await call('v23-kb-entity', id); if (!d) return;
      KB.sel = d.entity.id; KB.d = d;
      $('kb-list').querySelectorAll('.v-list-item').forEach(x => x.classList.toggle('active', x.dataset.id === KB.sel));
      KB.render(); KB.side();
    },
    render() {
      const el = $('kb-main'); const d = KB.d;
      if (!d) { el.innerHTML = '<div class="v-empty">选择左侧实体查看带引用的实体页。</div>'; return; }
      if (KB.tab === 'page') {
        if (!d.page) { el.innerHTML = `<div class="v-empty"><b>${esc(d.entity.name)}</b> 仍是候选实体（${d.entity.mention_count} 次提及）。<br>在 ≥2 份资料或 ≥2 天中出现、被写入「我的笔记」或作为会议参与者后，将自动生成实体页。</div>`; return; }
        const r = renderPage(d.page.body_md);
        el.innerHTML = `${r.stale ? '<div class="kb-stale">⚠ 该页面超过半衰期 1.5 倍未再出现新证据，内容可能已过时。</div>' : ''}<div class="kb-front">${r.fmHtml}${demoTag(d)}</div><div class="doc-body">${r.html}</div>
          <div class="kb-notes-box"><div class="v-row"><b>我的笔记</b><span class="kb-lock lock">🔒 AI 永不修改此区块</span></div><div class="doc-body" style="margin-top:6px">${d.page.user_notes ? renderMarkdown(d.page.user_notes) : '<span class="muted tiny">在右侧编辑你的笔记，重新编译时逐字保留。</span>'}</div></div>${r.citeHtml}`;
      } else if (KB.tab === 'facts') {
        const st = { active: ['生效', 'ok'], conflict: ['冲突', 'warn'], superseded: ['已取代', ''], rejected: ['已驳回', 'danger'] };
        el.innerHTML = d.claims.length ? d.claims.map(c => `<div class="kb-claim"><div class="v-row"><b>${esc(c.predicate)}</b><span>${esc(c.object)}</span>${c.locked ? '<span class="v-pill brand">🔒 已确认</span>' : ''}<span class="v-pill ${st[c.status]?.[1] || ''}">${st[c.status]?.[0] || c.status}</span><span class="v-grow"></span><span class="tiny muted">置信 ${(c.confidence || 0).toFixed(2)}</span></div>
            ${(c.evidence || []).map(ev => `<div class="v-quote">${esc(ev.quote || '')}<div class="src">${esc(ev.app_name || '采集')} · ${ev.ts ? ymd(ev.ts) + ' ' + hm(ev.ts) : ''}${ev.window_title ? ' · ' + esc(ev.window_title) : ''}</div></div>`).join('')}</div>`).join('')
          : '<div class="v-empty">暂无结构化事实。事实来自资料中的「X 的发布日期是…」「负责人是…」等陈述。</div>';
      } else if (KB.tab === 'hist') {
        el.innerHTML = (d.revisions || []).length ? `<div class="tiny muted" style="margin-bottom:8px">每次编译都会记录修订，可查看任一版本全文。</div>` + d.revisions.map(r => `<div class="kb-rev"><span class="v-pill ${r.author === 'user' ? 'brand' : ''}">${r.author === 'user' ? '我' : 'AI'}</span><span>${ymd(r.ts)} ${hm(r.ts)}</span><span class="muted">${esc({ extract: '新证据', user_notes: '编辑笔记', merge: '合并', stale: '陈旧标记', test: '重编译', 'undo-merge': '撤销合并' }[r.trigger] || r.trigger)}</span><span class="v-grow"></span><span class="tiny muted">${r.len || 0} 字</span><button class="btn sm" data-rev="${r.id}">查看</button></div>`).join('') + '<div id="kb-rev-view"></div>'
          : '<div class="v-empty">暂无修订</div>';
      } else {
        el.innerHTML = '<div class="kb-log" id="kb-logbox">加载中…</div>';
        call('v23-kb-log').then(t => { const b = $('kb-logbox'); if (b) b.textContent = t || ''; });
      }
    },
    async showRev(id) { const r = await call('v23-kb-revision', id); const v = $('kb-rev-view'); if (v && r) v.innerHTML = `<div class="v-section-title">${ymd(r.ts)} ${hm(r.ts)} 版本</div><div class="kb-log">${esc(r.after || '')}</div>`; },
    side() {
      const d = KB.d; const el = $('kb-side'); if (!d) { el.innerHTML = ''; return; }
      const e = d.entity;
      el.innerHTML = `<div class="card"><h3 style="margin:0 0 8px">我的笔记</h3>
          ${d.page ? `<textarea class="v-textarea" id="kb-notes" placeholder="写下你自己的判断、待办或补充。AI 重新编译页面时会逐字保留。">${esc(d.page.user_notes || '')}</textarea><div class="v-row" style="margin-top:8px"><span class="tiny muted v-grow">Markdown · 仅本机保存</span><button class="btn sm primary" id="kb-notes-save">保存笔记</button></div>`
          : `<textarea class="v-textarea" id="kb-notes" placeholder="为候选实体写笔记会立即将其转正并生成实体页。"></textarea><div class="v-row" style="margin-top:8px"><span class="v-grow"></span><button class="btn sm primary" id="kb-notes-save" disabled title="候选实体暂无页面">保存笔记</button></div>`}
        </div>
        <div class="card" style="margin-top:12px"><h3 style="margin:0 0 8px">概览</h3>
          <div class="v-row" style="gap:6px"><span class="v-pill brand">${TYPE[e.type] || e.type}</span><span class="v-pill ${e.status === 'active' ? 'ok' : ''}">${e.status === 'active' ? '已转正' : '候选'}</span>${e.promoted_reason ? `<span class="v-pill">${esc(e.promoted_reason)}</span>` : ''}</div>
          <div class="v-section-title">别名（含拼音 / 英文匹配）</div><div class="v-row" style="gap:6px">${d.aliases.map(a => `<span class="v-pill" title="${esc(a.source)}">${esc(a.alias)}</span>`).join('') || '<span class="tiny muted">—</span>'}</div>
          <div class="v-section-title">统计</div><div class="tiny muted">提及 ${e.mention_count} 次 · ${e.doc_count} 份资料 · ${e.day_count} 天<br>首次 ${e.first_seen ? ymd(e.first_seen) : '—'} · 最近 ${e.last_seen ? ymd(e.last_seen) : '—'}</div>
          <div class="v-section-title">隐私</div><button class="btn sm" id="kb-forget" style="color:var(--danger)">遗忘「${esc(e.name)}」…</button>
          <div class="tiny muted" style="margin-top:6px">从知识库、记忆、日历中级联删除，并阻止再次生成。</div></div>`;
      $('kb-notes-save').onclick = async () => { if (!d.page) return; const r = await call('v23-kb-set-notes', { pageId: d.page.id, notes: $('kb-notes').value }); toast(r?.ok ? '笔记已保存，AI 不会修改' : '保存失败', { type: r?.ok ? 'success' : 'error' }); KB.open(e.id); };
      $('kb-forget').onclick = () => forgetDialog(e.name);
    }
  };

  async function forgetDialog(subject) {
    const p = await call('v23-forget-preview', subject);
    const ov = document.createElement('div'); ov.className = 'overlay'; ov.style.zIndex = 80;
    ov.innerHTML = `<div class="card" style="width:440px;margin:12vh auto;padding:20px"><h3 style="margin:0 0 8px">遗忘「${esc(subject)}」</h3>
      <p class="muted" style="font-size:13px">将从三处级联删除与其相关的内容，并写入墓碑以防 AI 再次生成：</p>
      <div class="cal-cmp" style="margin:12px 0"><div><div class="n">${p.chunks}</div><div class="l">资料块</div></div><div><div class="n">${p.memories}</div><div class="l">记忆</div></div><div><div class="n">${p.calendar}</div><div class="l">日程</div></div></div>
      <label class="v-row tiny" style="margin:6px 0 14px"><input type="checkbox" id="fg-raw"> 同时删除原始活动记录（${p.activities} 条）</label>
      <div class="v-row" style="justify-content:flex-end"><button class="btn" data-a="cancel">取消</button><button class="btn primary" style="background:var(--danger);border-color:var(--danger)" data-a="ok">确认遗忘</button></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', async (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (e.target === ov || a === 'cancel') ov.remove(); if (a === 'ok') { const r = await call('v23-forget', { subject, purgeRaw: $('fg-raw').checked }); ov.remove(); toast(`已遗忘「${subject}」：实体 ${r.entities} · 记忆 ${r.memories} · 日程 ${r.calendar} · 资料块 ${r.chunks}`, { type: 'success' }); KB.sel = null; KB.d = null; reloadCurrent(); } });
  }

  /* ═════════ 日历 ═════════ */
  const CAL = {
    mode: 'week', cursor: Date.now(), data: null,
    range() {
      const c = dayStart(CAL.cursor);
      if (CAL.mode === 'day') return [c, c + DAY];
      if (CAL.mode === 'week') { const d = new Date(c); const off = (d.getDay() + 6) % 7; const s = c - off * DAY; return [s, s + 7 * DAY]; }
      if (CAL.mode === 'month') { const d = new Date(c); const first = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); const off = (new Date(first).getDay() + 6) % 7; const s = first - off * DAY; return [s, s + 42 * DAY]; }
      return [c - DAY, c + 14 * DAY];
    },
    label() { const [a, b] = CAL.range(); const d = new Date(CAL.cursor); if (CAL.mode === 'day') return `${d.getFullYear()}年${md(a)} ${WEEK[d.getDay()]}`; if (CAL.mode === 'month') return `${d.getFullYear()}年${d.getMonth() + 1}月`; if (CAL.mode === 'week') return `${md(a)} – ${md(b - 1)}`; return `议程 · ${md(a)} 起 14 天`; },
    async load() {
      const root = $('cal-root');
      if (!root.dataset.ready) {
        root.dataset.ready = '1';
        root.innerHTML = `<div class="cal-toolbar">
            <div class="v-seg" id="cal-mode">${[['day', '日'], ['week', '周'], ['month', '月'], ['agenda', '议程']].map(([k, l]) => `<button data-m="${k}"${k === CAL.mode ? ' class="active"' : ''}>${l}</button>`).join('')}</div>
            <div class="v-seg"><button data-nav="-1" aria-label="上一页">‹</button><button data-nav="0">今天</button><button data-nav="1" aria-label="下一页">›</button></div>
            <div class="cal-label" id="cal-label"></div>
            <div class="cal-quick"><input class="v-input" id="cal-quick" placeholder="快速添加：明天下午3点 和李四评审 / 每周一上午10点 周会 / 周五前 提交周报"><span class="cal-parse" id="cal-parse"></span><button class="btn sm primary" id="cal-add">添加</button></div>
          </div>
          <div class="v-split two"><div><div class="cal-legend" style="margin-bottom:8px"><span><i style="background:var(--plan)"></i>计划</span><span><i style="background:var(--meet)"></i>会议</span><span><i style="background:var(--todo-c)"></i>待办/提醒</span><span><i style="background:var(--deadline)"></i>截止</span><span><i style="background:var(--actual)"></i>实际活动</span><span><i style="border:1px dashed var(--brand);background:transparent"></i>AI 建议（待确认）</span></div><div id="cal-body"></div></div>
          <div><div class="card"><h3 style="margin:0 0 10px">计划 vs 实际 · <span id="cal-cmp-day" class="muted"></span></h3><div id="cal-cmp"></div></div>
          <div class="card" style="margin-top:12px"><div class="card-head"><h3>AI 建议</h3><span class="tiny muted">默认不直接写入日历</span></div><div id="cal-props"></div></div>
          <div class="card" style="margin-top:12px"><h3 style="margin:0 0 8px">订阅与导出</h3><div class="tiny muted" style="margin-bottom:8px">在 Outlook / 手机日历中订阅本机 ICS（仅本机可访问，带令牌）。</div><div class="v-row"><button class="btn sm" id="cal-feed">复制订阅链接</button><button class="btn sm" id="cal-ics">导出 .ics</button></div></div></div></div>`;
        $('cal-mode').addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b) return; CAL.mode = b.dataset.m; $('cal-mode').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); CAL.load(); });
        root.querySelector('[data-nav="-1"]').parentElement.addEventListener('click', (e) => { const b = e.target.closest('[data-nav]'); if (!b) return; const n = Number(b.dataset.nav); if (n === 0) CAL.cursor = Date.now(); else { if (CAL.mode === 'month') { const d = new Date(CAL.cursor); d.setMonth(d.getMonth() + n); CAL.cursor = d.getTime(); } else CAL.cursor += n * (CAL.mode === 'day' ? 1 : CAL.mode === 'week' ? 7 : 14) * DAY; } CAL.load(); });
        const q = $('cal-quick');
        q.addEventListener('input', async () => { const v = q.value.trim(); const p = $('cal-parse'); if (!v) { p.textContent = ''; p.className = 'cal-parse'; return; } const r = await call('v23-calendar-parse', v); if (r && r[0]) { p.textContent = '→ ' + r[0].label + (r[0].rrule ? ' · 重复' : ''); p.className = 'cal-parse ok'; } else { p.textContent = '未识别时间（将作为无日期待办）'; p.className = 'cal-parse'; } });
        const add = async () => { const v = q.value.trim(); if (!v) return; const r = await call('v23-calendar-parse', v); let title = v; if (r && r[0]) title = v.replace(r[0].text, '').replace(/^[\s，,]+|[\s，,]+$/g, '') || v; const kind = /会|评审|面试|约/.test(v) ? 'meeting' : /前|截止/.test(v) ? 'deadline' : 'todo'; const o = await call('v23-calendar-create', { title, when: v, kind, rrule: r?.[0]?.rrule, end_at: r?.[0]?.end || (kind === 'meeting' && r?.[0] ? r[0].start + 3600000 : null), start_at: r?.[0]?.start }); if (o?.id) { q.value = ''; $('cal-parse').textContent = ''; toast('已添加到日历', { type: 'success' }); CAL.load(); } };
        $('cal-add').onclick = add; q.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
        $('cal-feed').onclick = async () => { const f = await call('v23-calendar-feed'); await navigator.clipboard.writeText(f.url); toast(f.apiEnabled ? '订阅链接已复制' : '订阅链接已复制（需在 设置 → 集成 中开启本机 API）', { type: 'success' }); };
        $('cal-ics').onclick = () => exportIcs();
        $('cal-body').addEventListener('click', (e) => { const ev = e.target.closest('[data-ev]'); if (ev) { CAL.pop(ev.dataset.ev, e); return; } const dc = e.target.closest('[data-day]'); if (dc) { CAL.cursor = Number(dc.dataset.day); CAL.mode = 'day'; $('cal-mode').querySelectorAll('button').forEach(x => x.classList.toggle('active', x.dataset.m === 'day')); CAL.load(); } });
        $('cal-props').addEventListener('click', async (e) => { const b = e.target.closest('[data-pa]'); if (!b) return; await call('v23-inbox-act', { type: b.dataset.type, id: b.dataset.id, action: b.dataset.pa }); toast(b.dataset.pa === 'accept' ? '已加入日历' : '已忽略，不会再提示', { type: 'success' }); CAL.load(); refreshBadge(); });
      }
      $('cal-label').textContent = CAL.label();
      const [a, b] = CAL.range();
      CAL.data = await call('v23-calendar-range', { from: a, to: b });
      CAL.byId = new Map((CAL.data?.plan || []).map(e => [e.id + '@' + e.start_at, e]));
      ({ day: CAL.day, week: CAL.week, month: CAL.month, agenda: CAL.agenda })[CAL.mode]();
      CAL.cmp(); CAL.props();
    },
    evHtml(e, top, h) { return `<div class="cal-ev ${e.kind} ${e.status === 'proposed' ? 'proposed' : ''} ${e.status === 'done' ? 'done' : ''}" style="top:${top}px;height:${Math.max(20, h)}px" data-ev="${e.id}@${e.start_at}" title="${esc(e.title)}"><b>${e.status === 'proposed' ? '建议 · ' : ''}${esc(e.title)}${e.demo ? ' ·示例' : ''}</b>${h > 30 ? `<span class="muted">${hm(e.start_at)}${e.end_at ? '–' + hm(e.end_at) : ''}</span>` : ''}</div>`; },
    hoursCol(H0, H1) { let s = ''; for (let h = H0; h < H1; h++) s += `<div class="cal-hour">${pad(h)}:00</div>`; return s; },
    day() {
      const H0 = 7, H1 = 24, PX = 48; const s = dayStart(CAL.cursor);
      const y = (t) => ((t - s) / 3600000 - H0) * PX;
      const plan = CAL.data.plan.filter(e => !e.all_day);
      const lanes = []; const place = plan.sort((a, b) => a.start_at - b.start_at).map(e => { const end = e.end_at || e.start_at + 30 * 60000; let l = lanes.findIndex(x => x <= e.start_at); if (l < 0) { l = lanes.length; lanes.push(0); } lanes[l] = end; return { e, l, end }; });
      const n = Math.max(1, lanes.length);
      const ph = place.map(({ e, l, end }) => CAL.evHtml(e, y(e.start_at), y(end) - y(e.start_at) - 2).replace('style="', `style="left:${6 + l * (100 / n)}%;right:auto;width:calc(${100 / n}% - 10px);`)).join('');
      const ah = CAL.data.actual.map(b => `<div class="cal-blk ${b.kind}" style="top:${y(b.start)}px;height:${Math.max(14, y(b.end) - y(b.start) - 1)}px" title="${esc(b.title)} · ${b.minutes} 分钟&#10;${esc((b.titles || []).join('\n'))}">${y(b.end) - y(b.start) >= 15 ? esc(b.title) + ' · ' + b.minutes + '′' : ''}</div>`).join('');
      const allDay = CAL.data.plan.filter(e => e.all_day).map(e => `<span class="cal-chip ${e.kind}" data-ev="${e.id}@${e.start_at}">${esc(e.title)}</span>`).join('');
      const now = Date.now(); const nowLine = now >= s && now < s + DAY ? `<div class="cal-now" style="top:${y(now) + 37}px"></div>` : '';
      $('cal-body').innerHTML = `${allDay ? `<div class="card" style="padding:8px;margin-bottom:8px"><span class="tiny muted">全天</span> ${allDay}</div>` : ''}<div class="v-scroll" style="max-height:calc(100vh - 260px)"><div class="cal-day">${nowLine}<div class="cal-col-head"></div><div class="cal-col-head">计划</div><div class="cal-col-head">实际（采集到的活动块）</div>
        <div class="cal-hours">${CAL.hoursCol(H0, H1)}</div><div class="cal-track" style="height:${(H1 - H0) * PX}px">${ph}</div><div class="cal-track" style="height:${(H1 - H0) * PX}px">${ah}</div></div></div>`;
      const sc = $('cal-body').querySelector('.v-scroll'); if (sc) sc.scrollTop = Math.max(0, y(Math.min(now, s + 20 * 3600000)) - 160);
    },
    week() {
      const H0 = 7, H1 = 23, PX = 40; const [a] = CAL.range();
      let head = '<div class="cal-col-head"></div>'; let cols = '';
      for (let i = 0; i < 7; i++) {
        const s = a + i * DAY; const y = (t) => ((t - s) / 3600000 - H0) * PX;
        head += `<div class="cal-col-head${ymd(s) === ymd(Date.now()) ? ' today' : ''}" data-day="${s}" style="cursor:pointer">${WEEK[new Date(s).getDay()]} ${new Date(s).getDate()}</div>`;
        const ev = CAL.data.plan.filter(e => e.start_at >= s && e.start_at < s + DAY && !e.all_day).map(e => CAL.evHtml(e, y(e.start_at), y(e.end_at || e.start_at + 30 * 60000) - y(e.start_at) - 2)).join('');
        const bl = CAL.data.actual.filter(b => b.start >= s && b.start < s + DAY).map(b => `<div class="cal-blk ${b.kind}" style="top:${y(b.start)}px;height:${Math.max(4, y(b.end) - y(b.start))}px" title="${esc(b.title)} · ${b.minutes} 分钟"></div>`).join('');
        cols += `<div class="cal-track" style="height:${(H1 - H0) * PX}px;background-image:repeating-linear-gradient(to bottom,transparent 0,transparent ${PX - 1}px,var(--border) ${PX - 1}px,var(--border) ${PX}px)">${ev}${bl}</div>`;
      }
      const hours = `<div class="cal-hours">${Array.from({ length: H1 - H0 }, (_, i) => `<div class="cal-hour" style="height:${PX}px">${pad(H0 + i)}:00</div>`).join('')}</div>`;
      $('cal-body').innerHTML = `<div class="v-scroll" style="max-height:calc(100vh - 260px)"><div class="cal-week">${head}${hours}${cols}</div></div>`;
    },
    month() {
      const [a] = CAL.range(); const cur = new Date(CAL.cursor).getMonth();
      let h = WEEK.slice(1).concat(WEEK[0]).map(w => `<div class="cal-mh">${w}</div>`).join('');
      for (let i = 0; i < 42; i++) {
        const s = a + i * DAY; const d = new Date(s);
        const evs = CAL.data.plan.filter(e => e.start_at >= s && e.start_at < s + DAY);
        const act = CAL.data.actual.filter(b => b.start >= s && b.start < s + DAY).reduce((t, b) => t + b.minutes, 0);
        h += `<div class="cal-mc${d.getMonth() !== cur ? ' other' : ''}${ymd(s) === ymd(Date.now()) ? ' today' : ''}" data-day="${s}"><div class="d"><span>${d.getDate()}</span>${act ? `<span class="muted">${Math.round(act / 6) / 10}h</span>` : ''}</div>
          ${evs.slice(0, 3).map(e => `<span class="cal-chip ${e.kind} ${e.status === 'proposed' ? 'proposed' : ''}" data-ev="${e.id}@${e.start_at}">${e.all_day ? '' : hm(e.start_at) + ' '}${esc(e.title)}</span>`).join('')}${evs.length > 3 ? `<span class="muted">+${evs.length - 3} 项</span>` : ''}
          ${act ? `<div class="act" title="实际活动 ${act} 分钟"><i style="width:${Math.min(100, act / 6)}%"></i></div>` : ''}</div>`;
      }
      $('cal-body').innerHTML = `<div class="cal-month">${h}</div>`;
    },
    agenda() {
      const evs = [...CAL.data.plan].sort((a, b) => a.start_at - b.start_at);
      const groups = {}; for (const e of evs) (groups[ymd(e.start_at)] ||= []).push(e);
      const und = CAL.data.undated || [];
      $('cal-body').innerHTML = `<div class="card">${Object.entries(groups).map(([d, es]) => `<div class="cal-agenda-day">${d} ${WEEK[new Date(es[0].start_at).getDay()]}${d === ymd(Date.now()) ? ' · 今天' : ''}</div>` + es.map(e => `<div class="cal-agenda-row" data-ev="${e.id}@${e.start_at}"><span class="t">${e.all_day ? '全天' : hm(e.start_at) + (e.end_at ? '–' + hm(e.end_at) : '')}</span><span><b>${esc(e.title)}</b>${demoTag(e)} ${e.participants?.length ? `<span class="tiny muted">· ${esc(e.participants.join('、'))}</span>` : ''}</span><span class="v-row" style="gap:6px"><span class="v-pill ${e.kind === 'meeting' ? 'violet' : e.kind === 'deadline' ? 'danger' : 'brand'}">${KIND[e.kind] || e.kind}</span>${e.status === 'proposed' ? '<span class="v-pill warn">待确认</span>' : e.status === 'done' ? '<span class="v-pill ok">已完成</span>' : e.overdue ? '<span class="v-pill danger">已逾期</span>' : ''}${e.rrule ? '<span class="v-pill">重复</span>' : ''}</span></div>`).join('')).join('') || '<div class="v-empty">未来 14 天没有日程</div>'}
        ${und.length ? `<div class="cal-agenda-day">无日期待办</div>` + und.map(e => `<div class="cal-agenda-row" data-ev="${e.id}@${e.start_at}"><span class="t">—</span><span><b>${esc(e.title)}</b>${demoTag(e)}</span><span class="v-pill">${KIND[e.kind] || e.kind}</span></div>`).join('') : ''}</div>`;
      CAL.byId = new Map([...CAL.byId, ...und.map(e => [e.id + '@' + e.start_at, e])]);
    },
    async cmp() {
      const d = CAL.mode === 'day' ? CAL.cursor : (dayStart(Date.now()) >= CAL.range()[0] && dayStart(Date.now()) < CAL.range()[1] ? Date.now() : CAL.range()[0]);
      const c = await call('v23-calendar-day-compare', d); $('cal-cmp-day').textContent = md(d);
      const f = (m) => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? (m % 60) + 'm' : ''}` : `${m}m`;
      $('cal-cmp').innerHTML = `<div class="cal-cmp"><div><div class="n">${f(c.planned_min)}</div><div class="l">计划时长</div></div><div><div class="n" style="color:var(--actual)">${f(c.actual_min)}</div><div class="l">实际活动</div></div><div><div class="n" style="color:var(--meet)">${f(c.meeting_min)}</div><div class="l">会议实际</div></div></div>
        <div class="v-section-title">完成度 ${c.done}/${c.items}</div><div class="v-bar green"><i style="width:${c.items ? Math.round(c.done / c.items * 100) : 0}%"></i></div>`;
    },
    async props() {
      const items = (await call('v23-inbox') || []).filter(i => i.type === 'calendar' || i.type === 'calendar_change').slice(0, 6);
      $('cal-props').innerHTML = items.length ? items.map(i => `<div style="padding:8px 0;border-bottom:1px solid var(--border)"><div class="v-row"><span class="v-pill ${i.type === 'calendar_change' ? 'warn' : 'brand'}">${i.type === 'calendar_change' ? '改期' : '新日程'}</span><b class="v-grow" style="font-size:13px">${esc(i.title)}</b>${demoTag(i)}</div><div class="tiny muted" style="margin:4px 0 6px">${esc(i.subtitle)}</div>${i.evidence?.[0]?.quote ? `<div class="v-quote">${esc(i.evidence[0].quote)}</div>` : ''}<div class="v-row" style="margin-top:6px"><button class="btn sm primary" data-pa="accept" data-type="${i.type}" data-id="${i.id}">${i.type === 'calendar_change' ? '采纳改期' : '加入日历'}</button><button class="btn sm" data-pa="reject" data-type="${i.type}" data-id="${i.id}">忽略</button></div></div>`).join('')
        : '<div class="v-empty">没有待确认的建议。AI 从聊天、邮件、文档中识别的会议与承诺会先出现在这里。</div>';
    },
    pop(key, ev) {
      document.querySelector('.cal-pop')?.remove();
      const e = CAL.byId.get(key); if (!e) return;
      const el = document.createElement('div'); el.className = 'cal-pop';
      el.innerHTML = `<div class="v-row"><span class="v-pill ${e.kind === 'meeting' ? 'violet' : e.kind === 'deadline' ? 'danger' : 'brand'}">${KIND[e.kind] || e.kind}</span>${e.status === 'proposed' ? '<span class="v-pill warn">AI 建议</span>' : ''}${demoTag(e)}<span class="v-grow"></span><button class="icon-btn" data-a="x" aria-label="关闭">×</button></div>
        <h4 style="margin-top:8px">${esc(e.title)}</h4><div class="tiny muted">${ymd(e.start_at)} ${e.all_day ? '全天' : hm(e.start_at) + (e.end_at ? ' – ' + hm(e.end_at) : '')}${e.rrule ? ' · 重复' : ''} · 时间${{ exact: '明确', date_only: '仅日期', fuzzy: '模糊', none: '未定' }[e.time_certainty] || '明确'}</div>
        ${e.participants?.length ? `<div class="tiny" style="margin-top:6px">参与：${esc(e.participants.join('、'))}</div>` : ''}${e.notes ? `<div class="v-quote">${esc(e.notes)}</div>` : ''}${e.source_app ? `<div class="tiny muted" style="margin-top:6px">来源：${esc(e.source_app)} · 置信 ${(e.confidence || 0).toFixed(2)}</div>` : ''}
        <div class="v-row" style="margin-top:12px">${e.status === 'proposed' ? `<button class="btn sm primary" data-a="accept">确认</button><button class="btn sm" data-a="dismiss">忽略</button>` : `<button class="btn sm primary" data-a="done">${e.status === 'done' ? '已完成' : '标记完成'}</button><button class="btn sm" data-a="snooze">提前提醒 / 稍后</button>`}<span class="v-grow"></span><button class="btn sm ghost" data-a="del" style="color:var(--danger)">删除</button></div>`;
      document.body.appendChild(el);
      const r = ev.target.getBoundingClientRect(); el.style.left = Math.min(window.innerWidth - 336, r.right + 8) + 'px'; el.style.top = Math.min(window.innerHeight - el.offsetHeight - 12, r.top) + 'px';
      el.addEventListener('click', async (x) => {
        const a = x.target.closest('[data-a]')?.dataset.a; if (!a) return;
        if (a === 'accept') await call('v23-inbox-act', { type: e.change_of ? 'calendar_change' : 'calendar', id: e.id, action: 'accept' });
        if (a === 'dismiss') await call('v23-inbox-act', { type: 'calendar', id: e.id, action: 'reject' });
        if (a === 'done') await call('v23-calendar-complete', e.id);
        if (a === 'snooze') { await call('v23-calendar-snooze', { id: e.id, minutes: 10 }); toast('将在 10 分钟后提醒', { type: 'success' }); }
        if (a === 'del') await call('v23-calendar-delete', e.id);
        el.remove(); if (a !== 'x' && a !== 'snooze') { CAL.load(); refreshBadge(); }
      });
      setTimeout(() => document.addEventListener('mousedown', function h(m) { if (!el.contains(m.target)) { el.remove(); document.removeEventListener('mousedown', h); } }), 0);
    }
  };
  async function exportIcs() { const r = await call('v23-calendar-export-ics'); if (r?.ok) toast('已导出 ' + r.path, { type: 'success' }); }
  $('btn-h-cal-ics')?.addEventListener('click', exportIcs);
  $('btn-h-cal-new')?.addEventListener('click', () => { showView('calendar'); setTimeout(() => $('cal-quick')?.focus(), 50); });

  /* ═════════ 待处理 ═════════ */
  const INBOX = {
    tab: 'all',
    async load() {
      const root = $('inbox-root');
      const items = await call('v23-inbox') || [];
      const cnt = { all: items.length, memory: 0, calendar: 0, merge: 0, conflict: 0 };
      for (const i of items) cnt[i.type === 'calendar_change' ? 'calendar' : i.type]++;
      const list = items.filter(i => INBOX.tab === 'all' || i.type === INBOX.tab || (INBOX.tab === 'calendar' && i.type === 'calendar_change'));
      const icon = { memory: '◎', calendar: '◷', calendar_change: '⇄', merge: '⋈', conflict: '!' };
      const label = { memory: '记忆', calendar: '日程建议', calendar_change: '改期建议', merge: '实体合并', conflict: '事实冲突' };
      root.innerHTML = `<div class="v-tabs" id="ib-tabs">${[['all', '全部'], ['memory', '记忆'], ['calendar', '日程'], ['merge', '合并'], ['conflict', '冲突']].map(([k, l]) => `<button data-t="${k}"${INBOX.tab === k ? ' class="active"' : ''}>${l}<b>${cnt[k]}</b></button>`).join('')}</div>
        <div class="v-split two"><div id="ib-list">${list.length ? list.map(i => `<div class="ib-item" data-id="${i.id}" data-type="${i.type}">
            <div class="ib-ico ${i.type}">${icon[i.type]}</div>
            <div style="min-width:0"><div class="v-row"><span class="v-pill">${label[i.type]}</span><b style="font-size:14px">${txt(i, 'title')}</b>${demoTag(i)}</div>
              <div class="tiny muted" style="margin-top:4px">${esc(i.subtitle || '')} · ${i.ts ? rel(i.ts) : ''}</div>
              ${i.conflict ? `<div class="ib-diff"><span class="old">${esc(i.conflict)}</span><span>→</span><span>${esc(i.title)}</span></div>` : ''}
              ${i.type === 'conflict' ? (i.options || []).map(o => `<label class="ib-opt"><input type="radio" name="opt-${i.id}" value="${o.id}"> 保留「${esc(o.object)}」<span class="tiny muted">· 最近 ${ymd(o.last_seen)} · 置信 ${(o.confidence || 0).toFixed(2)}</span></label>`).join('') : ''}
              ${(i.evidence || []).filter(e => e.quote).slice(0, 2).map(e => `<div class="v-quote">${esc(e.quote)}<div class="src">${esc(e.app_name || '采集')} · ${e.ts ? ymd(e.ts) + ' ' + hm(e.ts) : ''}</div></div>`).join('')}
            </div>
            <div class="ib-actions">${i.type === 'conflict' ? '<button class="btn sm primary" data-a="accept">确认所选</button>' : i.type === 'merge' ? '<button class="btn sm primary" data-a="accept">合并</button><button class="btn sm" data-a="reject">不是同一个</button>' : `<button class="btn sm primary" data-a="accept">${i.type === 'memory' ? '记住' : i.type === 'calendar_change' ? '采纳改期' : '加入日历'}</button><button class="btn sm" data-a="reject">忽略</button>`}${i.type === 'memory' ? '<button class="btn sm ghost" data-a="never" title="拒绝并不再提示同类内容">不再提示</button>' : ''}</div></div>`).join('')
          : `<div class="card v-empty" style="padding:48px">🎉 全部处理完毕<br><span class="tiny">AI 产出的记忆、日程、合并建议与事实冲突都会汇总到这里，由你最终决定。</span></div>`}</div>
        <div><div class="card"><h3 style="margin:0 0 8px">处理原则</h3><div class="tiny muted" style="line-height:1.8">• 人工决定优先：你确认或编辑过的内容会被锁定，AI 不会覆盖。<br>• 「不再提示」会写入墓碑，相同内容不会再次出现。<br>• 每条建议都附带原文证据，可追溯到采集来源与时间。<br>• 快捷键：Ctrl+9 打开待处理。</div></div>
        <div class="card" style="margin-top:12px"><h3 style="margin:0 0 8px">队列概况</h3>${[['记忆', cnt.memory, 'violet'], ['日程', cnt.calendar, 'brand'], ['合并', cnt.merge, ''], ['冲突', cnt.conflict, 'warn']].map(([l, n, c]) => `<div class="v-row" style="margin:6px 0"><span class="v-pill ${c}" style="width:44px;justify-content:center">${l}</span><div class="v-bar v-grow"><i style="width:${cnt.all ? Math.round(n / cnt.all * 100) : 0}%"></i></div><b style="width:24px;text-align:right">${n}</b></div>`).join('')}</div></div></div>`;
      $('ib-tabs').onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) { INBOX.tab = b.dataset.t; INBOX.load(); } };
      $('ib-list').onclick = async (e) => {
        const b = e.target.closest('[data-a]'); if (!b) return; const it = b.closest('.ib-item'); const type = it.dataset.type, id = it.dataset.id;
        let extra = {};
        if (type === 'conflict') { const sel = it.querySelector('input[type=radio]:checked'); if (!sel) { toast('请先选择要保留的值', { type: 'info' }); return; } extra = { keep: sel.value }; }
        const r = await call('v23-inbox-act', { type, id, action: b.dataset.a, extra });
        if (r?.ok === false) { toast('操作失败', { type: 'error' }); return; }
        it.style.opacity = '.4'; toast({ accept: '已确认', reject: '已忽略', never: '已拒绝，不再提示' }[b.dataset.a], { type: 'success' });
        setTimeout(() => { INBOX.load(); refreshBadge(); }, 180);
      };
    }
  };

  /* ═════════ 记忆 2.0 ═════════ */
  const MEM = {
    status: 'active', kind: '', sel: null,
    async load() {
      const root = $('view-memory');
      if (!root.dataset.v23) {
        root.dataset.v23 = '1';
        root.innerHTML = `<div class="toolbar" style="flex-wrap:wrap"><div class="v-seg" id="mm-status">${[['active', '生效'], ['pending', '待审核'], ['superseded', '已取代'], ['archived', '已归档'], ['rejected', '已驳回']].map(([k, l]) => `<button data-s="${k}"${k === 'active' ? ' class="active"' : ''}>${l} <b id="mm-c-${k}"></b></button>`).join('')}</div>
          <div class="chips" id="mm-kind"><button class="chip active" data-k="">全部类型</button>${Object.entries(MEMT).filter(([k]) => k !== 'episodic' && k !== 'project').map(([k, l]) => `<button class="chip" data-k="${k}">${l}</button>`).join('')}</div>
          <span class="v-grow"></span><button class="btn sm" id="mm-add">新增记忆</button><button class="btn sm" id="mm-export">导出 JSON</button></div>
          <div class="v-split"><div class="card mm-prof"><h3 style="margin:0 0 4px">关于我</h3><div class="tiny muted">AI 助手通过 MCP get_profile 读取（不含私密）</div><dl class="mm-profile" id="mm-profile"></dl></div>
          <div class="card"><div id="mm-list" class="v-scroll"></div></div><div class="v-side-r card" id="mm-detail"></div></div>`;
        $('mm-status').onclick = (e) => { const b = e.target.closest('[data-s]'); if (!b) return; MEM.status = b.dataset.s; $('mm-status').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); MEM.sel = null; MEM.load(); };
        $('mm-kind').onclick = (e) => { const b = e.target.closest('[data-k]'); if (!b) return; MEM.kind = b.dataset.k; $('mm-kind').querySelectorAll('.chip').forEach(x => x.classList.toggle('active', x === b)); MEM.load(); };
        $('mm-list').onclick = (e) => { const c = e.target.closest('[data-id]'); if (c) MEM.open(c.dataset.id); };
        $('mm-export').onclick = async () => { const r = await call('v23-memory-export'); if (r?.ok) toast('已导出 ' + r.path, { type: 'success' }); };
        $('mm-add').onclick = () => MEM.addDialog();
      }
      const all = await call('v23-memories', { status: 'all', limit: 2000 }) || [];
      for (const s of ['active', 'pending', 'superseded', 'archived', 'rejected']) { const b = $('mm-c-' + s); if (b) b.textContent = all.filter(m => m.status === s).length || ''; }
      const rows = all.filter(m => m.status === MEM.status && (!MEM.kind || m.kind === MEM.kind));
      $('mm-list').innerHTML = rows.length ? rows.map(m => `<div class="mm-card${m.id === MEM.sel ? ' active' : ''}" data-id="${m.id}">
          <div class="v-row"><span class="v-pill ${m.kind === 'decision' ? 'brand' : m.kind === 'relationship' ? 'violet' : ''}">${MEMT[m.kind] || m.kind}</span>${m.locked ? '<span class="v-pill brand" title="人工编辑，AI 不会覆盖">🔒 已锁定</span>' : ''}${m.pinned ? '<span class="v-pill ok">📌 置顶</span>' : ''}${m.source === 'mcp' ? '<span class="v-pill">来自 MCP</span>' : m.source === 'user' ? '<span class="v-pill">手动</span>' : ''}${m.conflict_with ? '<span class="v-pill warn">与已有记忆冲突</span>' : ''}${/^【示例/.test(m.text || '') || m.demo ? '<span class="demo-tag">示例</span>' : ''}</div>
          <div style="margin-top:6px;font-size:14px">${txt(m)}</div>
          <div class="mm-bars"><span>置信</span><div class="v-bar"><i style="width:${Math.round((m.confidence || 0) * 100)}%"></i></div><span>强度</span><div class="v-bar green"><i style="width:${Math.round((m.strength_now ?? 1) * 100)}%"></i></div></div>
          <div class="v-meta" style="margin-top:6px">${m.evidence_count || 0} 条证据 · 最近出现 ${m.last_seen_at ? rel(m.last_seen_at) : '—'}</div></div>`).join('')
        : `<div class="v-empty">${{ active: '还没有生效的记忆。', pending: '没有待审核的记忆。', superseded: '没有被取代的记忆（例如“主力语言从 Python 改为 TypeScript”时，旧记忆会出现在这里）。', archived: '没有因长期未出现而归档的记忆。', rejected: '没有已驳回的记忆。' }[MEM.status]}</div>`;
      const p = await call('v23-profile');
      $('mm-profile').innerHTML = Object.entries(p?.profile || {}).map(([k, v]) => `<dt>${esc(k)}</dt>${v.slice(0, 4).map(t => { const o = { text: t }; const s = txt(o); return `<dd>${s}${demoTag(o)}</dd>`; }).join('')}`).join('') + (p?.commitments?.length ? `<dt>进行中的承诺</dt>${p.commitments.slice(0, 4).map(t => `<dd>${esc(t)}</dd>`).join('')}` : '') || '<dd class="muted tiny">暂无</dd>';
      if (!MEM.sel && rows[0]) MEM.open(rows[0].id); else if (MEM.sel) MEM.open(MEM.sel); else $('mm-detail').innerHTML = '<div class="v-empty">选择一条记忆查看证据与历史</div>';
    },
    async open(id) {
      MEM.sel = id; $('mm-list').querySelectorAll('.mm-card').forEach(x => x.classList.toggle('active', x.dataset.id === id));
      const m = await call('v23-memory', id); if (!m) return;
      const OP = { add: '新增', reinforce: '再次出现 · 强化', supersede: '取代旧记忆', superseded: '被新记忆取代', conflict: '与已有记忆冲突', edit: '你编辑并锁定', approve: '你确认', reject: '你驳回', 'reject-never': '你驳回（不再提示）', archive: '长期未出现 · 归档' };
      $('mm-detail').innerHTML = `<h3 style="margin:0 0 6px">${MEMT[m.kind] || m.kind}${m.demo ? '<span class="demo-tag">示例</span>' : ''}</h3><textarea class="v-textarea" id="mm-text" style="min-height:70px">${esc(m.text)}</textarea>
        <div class="v-row" style="margin:8px 0 4px">${m.status === 'pending' ? '<button class="btn sm primary" data-a="approve">记住</button><button class="btn sm" data-a="reject">驳回</button>' : ''}<button class="btn sm" data-a="save">保存并锁定</button><button class="btn sm" data-a="pin">${m.pinned ? '取消置顶' : '置顶'}</button><span class="v-grow"></span><button class="btn sm ghost" data-a="del" style="color:var(--danger)">删除</button></div>
        <div class="tiny muted">编辑后自动锁定：AI 不会再改写或取代这条记忆。</div>
        <div class="v-section-title">证据（${(m.evidence_list || []).length}）</div>${(m.evidence_list || []).slice(0, 6).map(e => `<div class="v-quote">${esc(e.quote || '')}<div class="src">${esc(e.app_name || '采集')} · ${e.ts ? ymd(e.ts) + ' ' + hm(e.ts) : ''}${e.window_title ? ' · ' + esc(e.window_title) : ''}</div></div>`).join('') || '<div class="tiny muted">无（手动或 MCP 写入）</div>'}
        <div class="v-section-title">历史</div><div class="mm-hist">${(m.history || []).map(h => `<div><b>${ymd(h.ts)} ${hm(h.ts)}</b> · ${OP[h.op] || h.op}${h.actor === 'user' ? '（你）' : ''}</div>`).join('') || '<div>—</div>'}</div>
        <div class="v-section-title">有效期</div><div class="tiny muted">自 ${m.valid_from ? ymd(m.valid_from) : '—'}${m.valid_to ? ' 至 ' + ymd(m.valid_to) : ' 起至今'} · 置信 ${(m.confidence || 0).toFixed(2)}</div>`;
      $('mm-detail').onclick = async (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
        if (a === 'approve') await call('v23-inbox-act', { type: 'memory', id, action: 'accept' });
        if (a === 'reject') await call('v23-inbox-act', { type: 'memory', id, action: 'reject' });
        if (a === 'save') await call('v23-memory-edit', { id, text: $('mm-text').value });
        if (a === 'pin') await call('v23-memory-pin', { id, on: !m.pinned });
        if (a === 'del') { await call('v23-memory-delete', id); MEM.sel = null; }
        toast({ approve: '已记住', reject: '已驳回', save: '已保存并锁定', pin: '已更新置顶', del: '已删除' }[a], { type: 'success' }); MEM.load(); refreshBadge();
      };
    },
    addDialog() {
      const ov = document.createElement('div'); ov.className = 'overlay'; ov.style.zIndex = 80;
      ov.innerHTML = `<div class="card" style="width:440px;margin:14vh auto;padding:20px"><h3 style="margin:0 0 10px">新增记忆</h3><select class="v-input" id="na-k" style="width:100%;margin-bottom:8px">${Object.entries(MEMT).filter(([k]) => !['episodic', 'project'].includes(k)).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><textarea class="v-textarea" id="na-t" style="min-height:80px" placeholder="例如：我偏好在上午做需要深度专注的工作"></textarea><div class="v-row" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-a="c">取消</button><button class="btn primary" data-a="ok">保存</button></div></div>`;
      document.body.appendChild(ov);
      ov.onclick = async (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (e.target === ov || a === 'c') ov.remove(); if (a === 'ok') { const t = $('na-t').value.trim(); if (!t) return; await call('v23-memory-add', { text: t, kind: $('na-k').value }); ov.remove(); toast('已保存', { type: 'success' }); MEM.load(); } };
    }
  };
  if (window.MTPro) window.MTPro.renderMemories = () => MEM.load();

  /* ═════════ 今日合并视图 ═════════ */
  const TODAY = {
    async load() {
      const host = $('view-dashboard'); if (!host) return;
      let box = $('today-v23');
      if (!box) { box = document.createElement('div'); box.id = 'today-v23'; box.className = 'today-v23'; const g = host.querySelector('.grid.charts'); host.insertBefore(box, g); }
      const t = await call('v23-today'); if (!t || t.ok === false) return;
      const s = dayStart(Date.now()); const H0 = 8, H1 = 22; const X = (ts) => Math.max(0, Math.min(100, ((ts - s) / 3600000 - H0) / (H1 - H0) * 100));
      const segP = t.plan.filter(e => !e.all_day && e.start_at).map(e => `<span class="seg" style="left:${X(e.start_at)}%;width:${Math.max(0.8, X(e.end_at || e.start_at + 30 * 60000) - X(e.start_at))}%" title="${esc(e.title)}"></span>`).join('');
      const segA = t.actual.map(b => `<span class="seg ${b.kind}" style="left:${X(b.start)}%;width:${Math.max(0.5, X(b.end) - X(b.start))}%" title="${esc(b.title)} · ${b.minutes} 分钟"></span>`).join('');
      const evs = t.plan.sort((a, b) => a.start_at - b.start_at).slice(0, 6);
      box.innerHTML = `<div class="card"><div class="card-head"><h3>今日日程 · 计划 vs 实际</h3><button class="btn sm" data-go="calendar">打开日历</button></div>
          <div class="tiny muted v-row" style="gap:12px"><span><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--plan)"></i> 计划 ${t.compare.planned_min} 分钟</span><span><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--actual)"></i> 实际 ${t.compare.actual_min} 分钟</span><span><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--meet)"></i> 会议 ${t.compare.meeting_min} 分钟</span></div>
          <div class="mini-tracks"><div class="row-p">${segP}</div><div class="row-a">${segA}</div></div><div class="mini-axis"><span>08:00</span><span>12:00</span><span>16:00</span><span>22:00</span></div>
          <div style="margin-top:8px">${evs.map(e => `<div class="today-ev"><span class="t">${e.all_day ? '全天' : hm(e.start_at)}</span><span>${esc(e.title)}${demoTag(e)}</span><span class="v-pill ${e.status === 'proposed' ? 'warn' : e.status === 'done' ? 'ok' : e.kind === 'meeting' ? 'violet' : 'brand'}">${e.status === 'proposed' ? '待确认' : e.status === 'done' ? '完成' : KIND[e.kind] || e.kind}</span></div>`).join('') || '<div class="v-empty" style="padding:12px">今天没有计划中的日程</div>'}</div></div>
        <div class="card"><div class="card-head"><h3>今日新知</h3><button class="btn sm" data-go="kb">知识库</button></div>
          ${t.entities.length ? t.entities.map(e => `<div class="v-list-item" data-kb="${e.id}"><div class="v-avatar ${e.type}">${esc(e.name.slice(0, 1))}</div><div class="v-grow"><div class="v-title">${esc(e.name)}${demoTag(e)}</div><div class="v-meta">${TYPE[e.type] || e.type} · 今日 ${e.n} 次提及</div></div></div>`).join('') : '<div class="v-empty">今天还没有新的实体。</div>'}</div>
        <div class="card"><div class="card-head"><h3>记忆与待处理</h3><button class="btn sm ${t.inbox.total ? 'primary' : ''}" data-go="inbox">待处理 ${t.inbox.total}</button></div>
          ${t.memories.length ? t.memories.map(m => `<div class="today-ev" style="grid-template-columns:auto 1fr"><span class="v-pill ${m.status === 'pending' ? 'warn' : ''}">${MEMT[m.kind] || m.kind}</span><span>${txt(m)}${demoTag(m)}</span></div>`).join('') : '<div class="v-empty">今天没有新的记忆。</div>'}
          <div class="tiny muted" style="margin-top:8px">记忆 ${t.inbox.memory} · 日程 ${t.inbox.calendar} · 合并 ${t.inbox.merge} · 冲突 ${t.inbox.conflict} 待你确认</div></div>`;
      box.onclick = (e) => { const g = e.target.closest('[data-go]'); if (g) showView(g.dataset.go); const k = e.target.closest('[data-kb]'); if (k) { KB.sel = k.dataset.kb; showView('kb'); } };
    }
  };

  window.MTV23 = { KB, CAL, INBOX, MEM, TODAY, refreshBadge };
  setTimeout(() => { refreshBadge(); if (!document.getElementById('view-dashboard').classList.contains('hidden')) TODAY.load(); }, 600);
})();
