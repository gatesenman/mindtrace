/** 2.4.8 · 内容层逐层计数（运行健康用）。只计数，不存内容。 */
const C = {};
const KEYS = ['windows', 'titleParsed', 'docNamed', 'pathResolved', 'snippet', 'uiaOk', 'uiaEmpty', 'uiaFail', 'ocrOk', 'ocrFail', 'browserJoined', 'browserBody', 'privacySkipped'];
let day = '';
const today = () => new Date().toDateString();
function roll() { if (day !== today()) { day = today(); for (const k of KEYS) C[k] = 0; C.via = {}; C.lastErr = {}; } }
function inc(k, n = 1) { roll(); C[k] = (C[k] || 0) + n; }
function via(src) { roll(); C.via[src] = (C.via[src] || 0) + 1; }
function err(layer, e) { roll(); C.lastErr[layer] = String(e && e.message || e).slice(0, 80); }
function snapshot() { roll(); return JSON.parse(JSON.stringify(C)); }
function reset() { day = ''; roll(); }
module.exports = { inc, via, err, snapshot, reset };
