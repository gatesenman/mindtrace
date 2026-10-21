const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; console.log('PASS ' + n); } catch (e) { fail++; console.log('FAIL ' + n + ' — ' + e.message); } };
const lnk = require('../src/common/lnk');
const pro = require('../src/pro');

/** 构造极简 LinkInfo 含本地路径的伪 .lnk（仅够 parseLnk 读取） */
function buildFakeLnk(targetPath) {
  const header = Buffer.alloc(0x4C, 0);
  header.writeUInt32LE(0x4C, 0); // size
  // CLSID bytes 4..19 left zero (parser doesn't check strictly)
  header.writeUInt32LE(0x02, 0x14); // flags: HasLinkInfo only
  const pathBuf = Buffer.from(targetPath + '\0', 'utf8');
  const linkInfoHeaderSize = 0x1C;
  const localBasePathOffset = linkInfoHeaderSize;
  const linkInfoSize = localBasePathOffset + pathBuf.length;
  const info = Buffer.alloc(linkInfoSize, 0);
  info.writeUInt32LE(linkInfoSize, 0);
  info.writeUInt32LE(linkInfoHeaderSize, 4);
  info.writeUInt32LE(0x01, 8); // VolumeIDAndLocalBasePath
  info.writeUInt32LE(localBasePathOffset, 16);
  pathBuf.copy(info, localBasePathOffset);
  return Buffer.concat([header, info]);
}

t('parseLnk：读出本地目标路径', () => {
  const buf = buildFakeLnk('C:\\Users\\Administrator\\Documents\\方案.pdf');
  const p = lnk.parseLnk(buf);
  assert.ok(p);
  assert.ok(p.target.includes('方案.pdf') || p.localPath.includes('方案.pdf'));
});

t('resolveLnk：文件不存在 → missing', () => {
  const r = lnk.resolveLnk('/tmp/no-such.lnk');
  assert.strictEqual(r.ok, false);
});

t('resolveLnk：注入实现', () => {
  lnk.resolveLnk._impl = () => ({ ok: true, target: 'E:\\docs\\a.pdf' });
  const r = lnk.resolveLnk('x.lnk');
  assert.strictEqual(r.target, 'E:\\docs\\a.pdf');
  delete lnk.resolveLnk._impl;
});

t('resolveLnk：写临时 lnk 再解析', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-lnk-'));
  const f = path.join(dir, 'doc.lnk');
  fs.writeFileSync(f, buildFakeLnk('D:\\work\\MindTrace\\README.md'));
  const r = lnk.resolveLnk(f);
  assert.strictEqual(r.ok, true);
  assert.match(r.target, /README\.md/);
  fs.rmSync(dir, { recursive: true, force: true });
});

t('usageSummary 形状（无 DB 时也要可调用或跳过）', () => {
  // pro.init may need store; just check function exists and prices map
  assert.ok(typeof pro.usageSummary === 'function');
  assert.ok(pro.estimateTokens('你好世界 hello') > 0);
});

t('recentFiles 模块导出 backfill', () => {
  const rf = require('../src/collectors/recentFiles');
  assert.ok(typeof rf.backfill === 'function');
});

console.log(`r7: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
