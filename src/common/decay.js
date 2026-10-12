/** 统一衰减/陈旧度（KB 页面、记忆共用）。半衰期单位：天；Infinity = 不衰减 */
const HALF_LIFE = {
  project: 30, topic: 90, person: 60, tool: 120, org: 120, source: 90, concept: 120,
  preference: 180, fact_self: 365, habit: 60, skill: 90, relationship: 120, decision: Infinity, commitment: 30, episodic: 30
};
const DAY = 86400000;
function halfLife(kind) { return HALF_LIFE[kind] ?? 90; }
function strength(lastSeen, kind, now = Date.now(), base = 1) {
  const hl = halfLife(kind); if (!isFinite(hl)) return base;
  return base * Math.pow(0.5, Math.max(0, now - (lastSeen || now)) / (hl * DAY));
}
function staleness(lastSeen, kind, now = Date.now()) {
  const hl = halfLife(kind); if (!isFinite(hl)) return 0;
  return Math.max(0, now - (lastSeen || now)) / (hl * DAY);
}
/** 噪声-或强化：单调递增有上限 */
const reinforce = (c, cNew) => 1 - (1 - c) * (1 - cNew * 0.5);
const counter = (c, cCounter) => c * (1 - 0.4 * cCounter);
module.exports = { HALF_LIFE, halfLife, strength, staleness, reinforce, counter };
