/**
 * 2.4.9 · 首次引导采集预设（与 renderer/ux.js 保持一致）
 * 推荐预设默认打开「文档 + 最近文件 + 界面文字」，保证内容层可总结。
 * 隐私闸门仍生效：shouldDropCapture / 仅本地 / 黑名单。
 */
const CAPTURE_PRESETS = {
  light: ['window', 'browser'],
  recommended: ['window', 'browser', 'documents', 'files', 'uia', 'ide', 'downloads'],
  full: ['window', 'browser', 'documents', 'files', 'uia', 'ide', 'downloads', 'clipboard', 'screenshots']
};

const PRESET_LABELS = {
  light: { title: '轻量', span: '窗口 + 浏览器', em: '最低打扰，先试用' },
  recommended: { title: '推荐', span: '+ 文档 · 界面文字 · IDE · 下载', em: '能认出文档并读正文，便于总结' },
  full: { title: '全面', span: '+ 剪贴板 · 截屏识图', em: '覆盖微信等不便读库的软件' }
};

function collectorsFromPreset(name) {
  const keys = CAPTURE_PRESETS[name] || CAPTURE_PRESETS.recommended;
  const all = ['window', 'browser', 'documents', 'clipboard', 'screenshots', 'notes', 'ide', 'downloads', 'files', 'uia', 'context'];
  const on = new Set(keys);
  const out = {};
  for (const k of all) out[k] = on.has(k);
  return out;
}

module.exports = { CAPTURE_PRESETS, PRESET_LABELS, collectorsFromPreset };
