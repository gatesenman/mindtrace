// 真实 Windows 采集噪声样本（来自 2.3.1 用户时间线）：任务切换、0 驻留、同应用连切、知迹自身复制、仅窗口名界面文本、原始 ## IDE 快照
module.exports = function noisyDay(base) {
  const M = 60000, S = 1000; const rows = []; let n = 0;
  const add = (o) => rows.push({ id: 'fx-' + (++n), duration_ms: 0, ended_at: null, meta: null, ...o, started_at: base + o.t, ...(o.d != null ? { duration_ms: o.d, ended_at: base + o.t + o.d } : {}) });
  // 上午：VS Code 专注 + Edge 查资料
  add({ t: 9 * 60 * M, type: 'window', app_name: 'VS Code', process_name: 'Code.exe', window_title: 'store.js — mindtrace', d: 42 * M });
  add({ t: 9 * 60 * M + 42 * M, type: 'window', app_name: '资源管理器', process_name: 'explorer.exe', window_title: '任务切换', d: 2 * S });
  add({ t: 9 * 60 * M + 43 * M, type: 'window', app_name: 'Edge', process_name: 'msedge.exe', window_title: 'better-sqlite3 文档', d: 6 * M });
  add({ t: 9 * 60 * M + 43 * M + 30 * S, type: 'browser', app_name: 'Edge', window_title: 'better-sqlite3 API', url: 'https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md' });
  add({ t: 9 * 60 * M + 49 * M, type: 'window', app_name: 'Search', process_name: 'SearchHost.exe', window_title: '搜索', d: 4 * S });
  add({ t: 9 * 60 * M + 50 * M, type: 'window', app_name: 'VS Code', process_name: 'Code.exe', window_title: 'noise.js — mindtrace', d: 35 * M });
  // 微信连切（同应用多窗口）
  const wx = [['微信', 1 * M], ['张三', 3 * M], ['图片和视频', 40 * S], ['2.3 发布群', 5 * M], ['李四', 2 * M], ['微信', 0]];
  let t = 15 * 60 * M;
  for (const [title, d] of wx) { add({ t, type: 'window', app_name: '微信', process_name: 'Weixin.exe', window_title: title, d: d || 1500 }); t += (d || 1500) + 2 * S; }
  add({ t, type: 'window', app_name: '资源管理器', process_name: 'explorer.exe', window_title: '任务切换', d: 0 });
  add({ t: t + 3 * S, type: 'window', app_name: 'ShellExperienceHost', process_name: 'ShellExperienceHost.exe', window_title: '新通知', d: 1 * S });
  add({ t: t + 5 * S, type: 'window', app_name: '开始', process_name: 'StartMenuExperienceHost.exe', window_title: '开始', d: 3 * S });
  // 剪贴板：知迹自身内部 JSON、短复制、有价值复制、60s 内重复
  add({ t: t + 10 * S, type: 'clipboard', content: '{"purpose":"chat","prompt_tokens":99,"completion_tokens":200,"chars":30}' });
  add({ t: t + 12 * S, type: 'clipboard', content: 'ok' });
  add({ t: t + 14 * S, type: 'clipboard', content: 'deepseek-v4-pro' });
  add({ t: t + 20 * S, type: 'clipboard', app_name: 'Edge', content: '会议纪要：周四下午 3 点和李四评审 2.3 发布清单，张三负责安装包签名。', meta: JSON.stringify({ sourceApp: 'Edge' }) });
  add({ t: t + 40 * S, type: 'clipboard', app_name: 'Edge', content: '会议纪要：周四下午 3 点和李四评审 2.3 发布清单，张三负责安装包签名。', meta: JSON.stringify({ sourceApp: 'Edge' }) });
  // 界面文本：只有窗口名 vs 有正文
  add({ t: t + 60 * S, type: 'uia', app_name: '资源管理器', window_title: 'grokweb', content: null });
  add({ t: t + 70 * S, type: 'uia', app_name: '飞书', window_title: '2.3 发布群', content: '王芳：测试平台接入方案我明天下午 4 点前给到；李雷：安装包签名证书已经申请，预计周五到位。' });
  // IDE 快照（旧格式 ## markdown + 结构化 meta）
  add({ t: t + 90 * S, type: 'ide', app_name: 'VS Code', window_title: 'IDE 会话快照 · 3 个工作区 · 2 提交', content: '## 最近工作区\n- [VS Code] e:/BEEVER/EVER-BUDDY\n- [Cursor] e:/myapp/FavoriteOrganizer\n- [Cursor] e:/myapp\n## 今日提交\n- mindtrace a1b2c3d fix noise\n- mindtrace e4f5a6b timeline sessions', meta: JSON.stringify({ workspaces: ['e:/BEEVER/EVER-BUDDY', 'e:/myapp/FavoriteOrganizer', 'e:/myapp'], recent: [{ source: 'VS Code', path: 'e:/BEEVER/EVER-BUDDY' }, { source: 'Cursor', path: 'e:/myapp/FavoriteOrganizer' }, { source: 'Cursor', path: 'e:/myapp' }], commits: [{ workspace: 'mindtrace', hash: 'a1b2c3d4', subject: 'fix noise' }, { workspace: 'mindtrace', hash: 'e4f5a6b7', subject: 'timeline sessions' }], commitCount: 2 }) });
  add({ t: t + 120 * S, type: 'document', app_name: '文档', window_title: 'everontology-three-slides.html', file_path: 'C:\\Users\\Administrator\\Documents\\Codex\\2026-10-12\\everontology-three-slides.html' });
  // 知迹自身窗口
  add({ t: t + 150 * S, type: 'window', app_name: 'MindTrace', process_name: 'MindTrace.exe', window_title: '知迹', d: 4 * M });
  // 晚上：锁屏 + Edge
  add({ t: 22 * 60 * M, type: 'window', app_name: 'LockApp', process_name: 'LockApp.exe', window_title: 'Windows 默认锁屏界面', d: 30 * M });
  add({ t: 22 * 60 * M + 43 * M, type: 'browser', app_name: 'Edge', window_title: 'PhotoSuite - Open source photo editor', url: 'https://photosuite.app/' });
  add({ t: 22 * 60 * M + 44 * M, type: 'window', app_name: 'Edge', process_name: 'msedge.exe', window_title: 'PhotoSuite', d: 8 * M });
  return rows;
};
