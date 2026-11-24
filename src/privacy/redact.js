/**
 * Sensitive content redaction + detection (before DB write / prompt send).
 * 借鉴 Microsoft Recall 默认开启的 Sensitive information filtering：
 * https://support.microsoft.com/en-us/windows/ai/ai-features/filtering-apps-websites-and-sensitive-information-in-recall
 * https://learn.microsoft.com/en-us/windows/client-management/recall-sensitive-information-filtering
 * 本机规则匹配（无 NPU / MCE），命中则脱敏或整条丢弃。
 */
function redactUrl(u) {
  const raw = String(u || '');
  if (!raw) return '';
  try {
    const x = new URL(raw);
    let changed = false;
    for (const k of [...x.searchParams.keys()]) {
      if (/(token|secret|password|passwd|apikey|api_key|access_key|auth|signature|sign|sid|session|jwt)/i.test(k)) {
        x.searchParams.set(k, 'REDACTED');
        changed = true;
      }
    }
    return changed ? x.toString() : raw;
  } catch (_) { return raw; }
}

function redactText(text, opts = {}) {
  if (!text || typeof text !== 'string') return text;
  if (opts.autoRedact === false) return text;
  let t = text;
  t = t.replace(/https?:\/\/[^\s)<>\]]+/g, (u) => redactUrl(u));
  // China ID
  t = t.replace(/\b\d{17}[\dXx]\b/g, '[敏感-证件号]');
  // Passport-ish
  t = t.replace(/\b[EeGgPpSsDd]\d{8}\b/g, '[敏感-护照]');
  // Bank card-ish 13-19 digits
  t = t.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => {
    const digits = m.replace(/\D/g, '');
    return digits.length >= 13 && digits.length <= 19 ? '[敏感-卡号]' : m;
  });
  // CN mobile
  t = t.replace(/(?<![0-9])1[3-9]\d{9}(?![0-9])/g, '[敏感-手机]');
  // API keys / tokens
  t = t.replace(/\bsk-[A-Za-z0-9]{16,}\b/g, '[敏感-Key]');
  t = t.replace(/\bAKIA[0-9A-Z]{16}\b/g, '[敏感-Key]');
  t = t.replace(/\bghp_[A-Za-z0-9]{20,}\b/g, '[敏感-Key]');
  t = t.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[敏感-Key]');
  t = t.replace(/\bglpat-[A-Za-z0-9_\-]{20,}\b/g, '[敏感-Key]');
  t = t.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[敏感-Key]');
  // SMS codes
  t = t.replace(/(验证码\s*[:：是为]?\s*)(\d{4,8})/g, '$1[敏感]');
  t = t.replace(/(验证码是\s*)(\d{4,8})/g, '$1[敏感]');
  t = t.replace(/(code\s*[:：]?\s*)(\d{4,8})/gi, '$1[敏感]');
  // CVV / CVC near card context
  t = t.replace(/\b(cvv|cvc|安全码)\s*[:：]?\s*\d{3,4}\b/gi, '[敏感-CVV]');
  return t;
}

function looksLikePassword(text, windowTitle = '') {
  const title = String(windowTitle || '');
  const body = String(text || '').trim();
  const hay = `${title} ${body}`.toLowerCase();
  if (!body || body.length > 64) return false;
  if (/密码|password|passwd|登录|login|signin|凭证|credential/.test(hay) && !/\s/.test(body)) return true;
  if (/密码|password|passwd/.test(title) && body.length <= 32) return true;
  return false;
}

/** 返回命中的敏感类型列表；空数组 = 安全 */
function detectSensitive(text, { title = '', url = '', app = '' } = {}) {
  const hits = [];
  const s = String(text || '');
  const hay = `${title} ${url} ${app} ${s}`;
  if (/\b\d{17}[\dXx]\b/.test(s)) hits.push('id-card');
  if (/\b[EeGgPpSsDd]\d{8}\b/.test(s)) hits.push('passport');
  {
    const m = s.match(/\b(?:\d[ -]?){13,19}\b/g) || [];
    for (const x of m) {
      const d = x.replace(/\D/g, '');
      if (d.length === 18 && /\d{17}[\dXx]/.test(d)) continue; // 身份证不是卡号
      if (d.length >= 13 && d.length <= 19) { hits.push('bank-card'); break; }
    }
  }
  if (/(?<![0-9])1[3-9]\d{9}(?![0-9])/.test(s)) hits.push('phone');
  if (/\bsk-[A-Za-z0-9]{16,}\b|\bAKIA[0-9A-Z]{16}\b|\bghp_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/.test(s)) hits.push('api-key');
  if (/验证码\s*[:：是为]?\s*\d{4,8}/.test(s)) hits.push('otp');
  if (looksLikePassword(s, title)) hits.push('password');
  if (/(1password|bitwarden|keepass|网银|网上银行|alipay.*登录)/i.test(hay)) hits.push('sensitive-app');
  if (/(inprivate|incognito|无痕|隐身)/i.test(title)) hits.push('private-browsing');
  return hits;
}

/** 是否应整条丢弃（对齐 Recall 默认敏感过滤） */
function shouldDropCapture(row, cfg = {}) {
  if (cfg.privacy && cfg.privacy.sensitiveDetection === false) return { drop: false, hits: [] };
  const hits = detectSensitive(row.content || '', {
    title: row.window_title || row.title || '',
    url: row.url || '',
    app: `${row.app_name || ''} ${row.process_name || ''}`
  });
  const hard = hits.filter(h => ['password', 'api-key', 'id-card', 'bank-card', 'otp', 'sensitive-app', 'private-browsing'].includes(h));
  return { drop: hard.length > 0, hits: hard };
}

module.exports = { redactText, redactUrl, looksLikePassword, detectSensitive, shouldDropCapture };
