/** Lightweight chart helpers (uPlot + canvas sparklines + CSS heatmap). */
window.MTCharts = {
  _plots: {},
  destroy(key) {
    if (this._plots[key]) {
      try { this._plots[key].destroy(); } catch (_) {}
      delete this._plots[key];
    }
  },
  sparkline(canvas, values, color) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width, h = canvas.height;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const data = (values && values.length) ? values : [2, 3, 2, 4, 3, 5, 4];
    const min = Math.min(...data), max = Math.max(...data);
    const span = Math.max(1, max - min);
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / Math.max(1, data.length - 1)) * (w - 2) + 1;
      const y = h - 2 - ((v - min) / span) * (h - 4);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color || getComputedStyle(document.body).getPropertyValue('--brand').trim() || '#3B6CED';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
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
  appsBar(el, breakdown) {
    this.destroy('apps');
    if (!el || typeof uPlot === 'undefined') return;
    el.innerHTML = '';
    const rows = (breakdown || []).slice(0, 8);
    if (!rows.length) {
      el.innerHTML = '<div class="empty" style="padding:24px">暂无应用分布</div>';
      return;
    }
    const labels = rows.map(r => (r.app_name || '未知').slice(0, 10));
    const mins = rows.map(r => Math.round((r.total_ms || 0) / 60000));
    const brand = getComputedStyle(document.body).getPropertyValue('--brand').trim() || '#3B6CED';
    const text2 = getComputedStyle(document.body).getPropertyValue('--text-2').trim() || '#5B6170';
    const xs = labels.map((_, i) => i);
    const opts = {
      width: Math.max(280, el.clientWidth || 360),
      height: 200,
      padding: [8, 8, 8, 8],
      cursor: { show: false },
      legend: { show: false },
      scales: { x: { time: false }, y: { range: (u, dmin, dmax) => [0, dmax * 1.15 || 1] } },
      axes: [
        { stroke: text2, grid: { show: false }, ticks: { show: false }, values: (u, vals) => vals.map(i => labels[i] || ''), font: '11px Inter, sans-serif', size: 48 },
        { stroke: text2, grid: { stroke: getComputedStyle(document.body).getPropertyValue('--border').trim() || '#E2E5EB', width: 1 }, font: '11px Inter, sans-serif', size: 40 }
      ],
      series: [{}, { stroke: brand, fill: brand + '33', width: 0, paths: uPlot.paths.bars({ size: [0.55, 20], align: 0 }) }]
    };
    this._plots.apps = new uPlot(opts, [xs, mins], el);
  },
  weekTrend(el, series) {
    this.destroy('week');
    if (!el || typeof uPlot === 'undefined') return;
    el.innerHTML = '';
    const data = series && series.length ? series : [20, 35, 28, 40, 32, 48, 42];
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
