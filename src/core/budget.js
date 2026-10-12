/** 按用途分配每日 token 预算：抽取 60% / 编译 25% / 汇总 15% */
const store = require('../main/store');
const SPLIT = { extract: 0.6, compile: 0.25, rollup: 0.15 };
function dayStart(now = Date.now()) { const d = new Date(now + 8 * 3600000); d.setUTCHours(0, 0, 0, 0); return d.getTime() - 8 * 3600000; }
function daily(cfg) { return Number(cfg?.ai?.dailyTokenBudget || 200000); }
function used(purpose, now = Date.now()) {
  try { return store.get(`SELECT COALESCE(SUM(prompt_tokens+completion_tokens),0) t FROM llm_usage WHERE ts>=? AND purpose=?`, [dayStart(now), purpose])?.t || 0; } catch (_) { return 0; }
}
function cap(purpose, cfg) { return Math.floor(daily(cfg) * (SPLIT[purpose] ?? 0.1)); }
function allow(purpose, cfg, est = 0) { return used(purpose) + est <= cap(purpose, cfg); }
function status(cfg) { return Object.keys(SPLIT).map(p => ({ purpose: p, used: used(p), cap: cap(p, cfg), share: SPLIT[p] })); }
module.exports = { SPLIT, allow, used, cap, status, daily };
