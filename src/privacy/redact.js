/**
 * Sensitive content redaction before DB write / prompt send.
 */
function redactText(text, opts = {}) {
  if (!text || typeof text !== 'string') return text;
  if (opts.autoRedact === false) return text;
  let t = text;
  // China ID
  t = t.replace(/\b\d{17}[\dXx]\b/g, '[敏感-证件号]');
  // Bank card-ish 13-19 digits (avoid years/phones somewhat by length+grouping)
  t = t.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => {
    const digits = m.replace(/\D/g, '');
    return digits.length >= 13 && digits.length <= 19 ? '[敏感-卡号]' : m;
  });
  // API keys
  t = t.replace(/\bsk-[A-Za-z0-9]{16,}\b/g, '[敏感-Key]');
  t = t.replace(/\bAKIA[0-9A-Z]{16}\b/g, '[敏感-Key]');
  // SMS codes
  t = t.replace(/(验证码\s*[:：是为]?\s*)(\d{4,8})/g, '$1[敏感]');
  t = t.replace(/(验证码是\s*)(\d{4,8})/g, '$1[敏感]');
  t = t.replace(/(code\s*[:：]?\s*)(\d{4,8})/gi, '$1[敏感]');
  return t;
}

function looksLikePassword(text, windowTitle = '') {
  const hay = `${windowTitle} ${text}`.toLowerCase();
  if (/密码|password|passwd|登录|login/.test(hay) && text && text.length < 64 && !/\s/.test(text.trim())) {
    return true;
  }
  return false;
}

module.exports = { redactText, looksLikePassword };
