/** Chart helpers: horizontal app ranking, canvas sparklines, CSS heatmap, uPlot week trend. */
window.MTCharts = {
  _plots: {},
  destroy(key) {
    if (this._plots[key]) {
      try { this._plots[key].destroy(); } catch (_) {}
      delete this._plots[key];
    }
  },
  _esc(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  },
  _badgeColor(name) {
    const palette = ['#3B6CED','#0F9F6E','#D97706','#8B5CF6','#F43F5E','#0EA5E9','#14B8A6','#6366F1'];
    let h = 0;
    for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return palette[h % palette.length];
  },
  sparkline(canvas, values, color) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cssW = 72, cssH = 28;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const data = (values && values.length) ? values.map(Number) : [2, 3, 2, 4, 3, 5, 4];
    const min = Math.min(...data), max = Math.max(...data);
    const span = Math.max(1e-6, max - min);
    const brand = color || getComputedStyle(document.body).getPropertyValue('--brand').trim() || '#3B6CED';
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / Math.max(1, data.length - 1)) * (cssW - 4) + 2;
      const y = cssH - 3 - ((v - min) / span) * (cssH - 8);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = brand;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  },
  heatmap(el, hourly) {
    if (!el) return;
    const arr = hourly && hourly.length === 24 ? hourly : new Array(24).fill(0);
    const max = Math.max(1, ...arr);
    el.innerHTML = arr.map((v) => {
      const level = v <= 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4));
      return `<div class="cell" data-v="${level}" title="${v}"></div>`;
    }).join('');
  },
  /** Clean horizontal ranking — single source of truth (no uPlot, no duplicate list). */
  appsRank(el, breakdown) {
    this.destroy('apps');
    if (!el) return;
    const rows = (breakdown || []).slice(0, 8);
    if (!rows.length) {
      el.innerHTML = '<div class="empty" style="padding:28px;border:0;background:transparent">暂无应用分布</div>';
      return;
    }
    const total = rows.reduce((s, r) => s + (r.total_ms || 0), 0) || 1;
    const max = Math.max(1, ...rows.map(r => r.total_ms || 0));
    el.innerHTML = rows.map(r => {
      const name = r.app_name || '未知';
      const initial = (name.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '') || '?').slice(0, 1);
      const pctBar = Math.round((r.total_ms || 0) / max * 100);
      const pctShare = Math.round((r.total_ms || 0) / total * 100);
      const mins = Math.round((r.total_ms || 0) / 60000);
      const dur = mins < 60 ? `${mins} 分` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
      const color = this._badgeColor(name);
      return `<div class="app-rank-row">
        <div class="app-badge" style="background:${color}">${this._esc(initial)}</div>
        <div class="name" title="${this._esc(name)}">${this._esc(name)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pctBar}%;background:${color}"></div></div>
        <div class="dur">${dur}</div>
        <div class="pct">${pctShare}%</div>
      </div>`;
    }).join('');
  },
  // backward-compatible alias
  appsBar(el, breakdown) { return this.appsRank(el, breakdown); },
  weekTrend(el, series) {
    this.destroy('week');
    if (!el) return;
    el.innerHTML = '';
    const data = series && series.length ? series.map(Number) : [20, 35, 28, 40, 32, 48, 42];
    if (typeof uPlot === 'undefined') {
      // fallback spark-style bars
      const max = Math.max(1, ...data);
      el.innerHTML = `<div style="display:flex;align-items:flex-end;gap:6px;height:100px;padding:8px 4px">${data.map(v =>
        `<div style="flex:1;background:var(--brand);opacity:.85;border-radius:4px 4px 0 0;height:${Math.max(4, Math.round(v/max*88))}px"></div>`
      ).join('')}</div>`;
      return;
    }
    const xs = data.map((_, i) => i);
    const brand = getComputedStyle(document.body).getPropertyValue('--brand').trim() || '#3B6CED';
    const text2 = getComputedStyle(document.body).getPropertyValue('--text-2').trim() || '#5B6170';
    const border = getComputedStyle(document.body).getPropertyValue('--border').trim() || '#E2E5EB';
    const opts = {
      width: Math.max(240, el.clientWidth || 300),
      height: 120,
      padding: [8, 8, 4, 8],
      cursor: { show: false },
      legend: { show: false },
      scales: { x: { time: false } },
      axes: [
        { show: false },
        { stroke: text2, grid: { stroke: border, width: 1 }, font: '10px Inter, sans-serif', size: 36 }
      ],
      series: [{}, { stroke: brand, width: 2, fill: brand + '22', points: { show: false } }]
    };
    this._plots.week = new uPlot(opts, [xs, data], el);
  }
};
