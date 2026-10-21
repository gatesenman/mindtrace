/**
 * 2.4 R7 · 解析 Windows .lnk 快捷方式目标路径（纯 JS，无原生依赖）
 * 格式参考 MS-SHLLINK；仅提取 LinkInfo / StringData 中的本地路径。
 * Linux/测试：可用 _resolveImpl 注入。
 */
const fs = require('fs');
const path = require('path');

function readU32(buf, off) { return buf.readUInt32LE(off); }
function readU16(buf, off) { return buf.readUInt16LE(off); }

function parseLnk(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 76) return null;
  // Header: size 0x4C, CLSID
  if (readU32(buf, 0) !== 0x4C) return null;
  const flags = readU32(buf, 0x14);
  let off = 0x4C;
  // Skip LinkTargetIDList
  if (flags & 0x01) {
    if (off + 2 > buf.length) return null;
    const idListSize = readU16(buf, off); off += 2 + idListSize;
  }
  let localPath = null, commonPath = null;
  if (flags & 0x02) {
    if (off + 28 > buf.length) return null;
    const linkInfoSize = readU32(buf, off);
    const linkInfoHeaderSize = readU32(buf, off + 4);
    const linkInfoFlags = readU32(buf, off + 8);
    const localBasePathOffset = readU32(buf, off + 16);
    const commonPathSuffixOffset = readU32(buf, off + 24);
    const end = off + linkInfoSize;
    if (linkInfoFlags & 0x01 && localBasePathOffset) {
      const p = off + localBasePathOffset;
      if (p < end) localPath = buf.slice(p, buf.indexOf(0, p) === -1 ? end : buf.indexOf(0, p)).toString('utf8');
    }
    // Optional unicode local base path
    if (linkInfoHeaderSize >= 0x3C) {
      const localBasePathOffsetUnicode = readU32(buf, off + 28 + 16); // after volume + network offsets... actually at header+0x30
    }
    if (commonPathSuffixOffset) {
      const p = off + commonPathSuffixOffset;
      if (p < buf.length) {
        const z = buf.indexOf(0, p);
        commonPath = buf.slice(p, z === -1 ? Math.min(p + 260, buf.length) : z).toString('utf8');
      }
    }
    off = end;
  }
  // StringData: NAME, RELATIVE, WORKING_DIR, ARGS, ICON — UTF16 if Has*Unicode
  const unicode = !!(flags & 0x80);
  function readString() {
    if (off + 2 > buf.length) return null;
    const n = readU16(buf, off); off += 2;
    if (!n) return '';
    if (unicode) {
      const bytes = n * 2;
      if (off + bytes > buf.length) return null;
      const s = buf.slice(off, off + bytes).toString('utf16le'); off += bytes; return s;
    }
    if (off + n > buf.length) return null;
    const s = buf.slice(off, off + n).toString('utf8'); off += n; return s;
  }
  let name = null, relative = null, workingDir = null;
  if (flags & 0x04) name = readString();
  if (flags & 0x08) relative = readString();
  if (flags & 0x10) workingDir = readString();
  let target = localPath || null;
  if (!target && relative && workingDir) target = path.resolve(workingDir, relative);
  else if (!target && relative) target = relative;
  if (target && commonPath) target = path.join(target, commonPath);
  if (target) target = target.replace(/\0/g, '').trim();
  return { target: target || null, workingDir, name, relative, localPath };
}

function resolveLnk(filePath) {
  if (typeof resolveLnk._impl === 'function') return resolveLnk._impl(filePath);
  try {
    if (!filePath || !/\.lnk$/i.test(filePath)) return { ok: false, error: 'not-lnk' };
    if (!fs.existsSync(filePath)) return { ok: false, error: 'missing' };
    const buf = fs.readFileSync(filePath);
    const p = parseLnk(buf);
    if (!p || !p.target) return { ok: false, error: 'unparsed', raw: p };
    return { ok: true, target: p.target, meta: p };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { parseLnk, resolveLnk };
