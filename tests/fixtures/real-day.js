// 2.3.3 真实使用形态样本：微信 / 资源管理器 / VS Code / Office / Edge，标题保留 Windows 原始后缀与未读数
module.exports = function realDay(base) {
  const M = 60000, S = 1000; const rows = []; let n = 0;
  const at = (h, m, s = 0) => base + h * 3600000 + m * M + s * S;
  const W = (h, m, s, app, proc, title, d) => rows.push({ id: 'rd-' + (++n), type: 'window', started_at: at(h, m, s), duration_ms: d, ended_at: at(h, m, s) + d, app_name: app, process_name: proc, window_title: title, meta: null });
  const B = (h, m, s, title, url) => rows.push({ id: 'rd-' + (++n), type: 'browser', started_at: at(h, m, s), duration_ms: 0, ended_at: null, app_name: 'Edge', window_title: title, url, meta: null });
  const O = (o) => rows.push({ id: 'rd-' + (++n), duration_ms: 0, ended_at: null, meta: null, ...o });
  // 09:02 早间：微信处理消息
  W(9, 2, 0, '微信', 'Weixin.exe', '微信 (12)', 40 * S);
  W(9, 2, 42, '微信', 'Weixin.exe', '产品研发群(5)', 6 * M);
  W(9, 8, 50, '微信', 'Weixin.exe', '张伟', 4 * M);
  W(9, 13, 0, '微信', 'Weixin.exe', '图片和视频', 20 * S);
  W(9, 13, 30, '微信', 'Weixin.exe', '李娜', 2 * M);
  // 09:16 VS Code 编码（混入 Edge 查文档、资源管理器找文件）
  W(9, 16, 0, 'VS Code', 'Code.exe', '● timeline.ts - mindtrace - Visual Studio Code', 28 * M);
  W(9, 44, 10, 'Edge', 'msedge.exe', 'Electron BrowserWindow | Electron - 个人 - Microsoft​ Edge', 3 * M);
  B(9, 44, 20, 'BrowserWindow | Electron', 'https://www.electronjs.org/docs/latest/api/browser-window');
  W(9, 47, 20, 'VS Code', 'Code.exe', 'noise.js - mindtrace - Visual Studio Code', 22 * M);
  W(10, 9, 30, 'VS Code', 'Code.exe', 'timeline.css - mindtrace - Visual Studio Code', 14 * M);
  O({ type: 'clipboard', started_at: at(10, 20, 0), app_name: 'VS Code', content: 'const GAP = 5 * 60000; // 同任务合并间隔', meta: JSON.stringify({ sourceApp: 'VS Code' }) });
  // 10:25 Edge 调研
  W(10, 25, 0, 'Edge', 'msedge.exe', 'DeepSeek API 文档 - 个人 - Microsoft​ Edge', 7 * M);
  B(10, 25, 5, 'DeepSeek API 文档', 'https://api-docs.deepseek.com/zh-cn/');
  W(10, 32, 10, 'Edge', 'msedge.exe', 'Screenpipe 时间线设计 · GitHub 和另外 3 个页面 - 个人 - Microsoft​ Edge', 9 * M);
  B(10, 32, 15, 'mediar-ai/screenpipe: 24/7 local AI screen recording', 'https://github.com/mediar-ai/screenpipe');
  B(10, 36, 0, 'Timing – Automatic Time Tracking for Mac', 'https://timingapp.com/');
  W(10, 41, 20, 'Edge', 'msedge.exe', '(3) 知乎 - 有问题，就会有答案 - 个人 - Microsoft​ Edge', 2 * M);
  B(10, 41, 25, '个人知识管理工具怎么选？ - 知乎', 'https://www.zhihu.com/question/12345');
  // 10:45 腾讯会议
  W(10, 45, 0, '腾讯会议', 'wemeetapp.exe', '2.4 版本评审会', 38 * M);
  // 11:25 Office：Word 写 PRD + Excel
  W(11, 25, 0, '资源管理器', 'explorer.exe', '产品文档', 50 * S);
  O({ type: 'document', started_at: at(11, 26, 0), app_name: 'Word', window_title: 'MindTrace-PRD-2.4.docx', file_path: 'E:\\工作\\产品文档\\MindTrace-PRD-2.4.docx' });
  W(11, 26, 0, 'Word', 'WINWORD.EXE', 'MindTrace-PRD-2.4.docx - Word', 31 * M);
  W(11, 57, 10, 'Excel', 'EXCEL.EXE', '2.4 需求排期.xlsx - Excel', 12 * M);
  O({ type: 'document', started_at: at(11, 57, 15), app_name: 'Excel', window_title: '2.4 需求排期.xlsx', file_path: 'E:\\工作\\产品文档\\2.4 需求排期.xlsx' });
  // 午休：锁屏
  W(12, 10, 0, 'LockApp', 'LockApp.exe', 'Windows 默认锁屏界面', 75 * M);
  // 13:30 微信 + 飞书沟通
  W(13, 30, 0, '微信', 'Weixin.exe', '张伟', 5 * M);
  W(13, 35, 5, '微信', 'Weixin.exe', '文件传输助手', 1 * M);
  W(13, 36, 10, '微信', 'Weixin.exe', '产品研发群(2)', 3 * M);
  // 13:40 PPT
  W(13, 40, 0, 'PowerPoint', 'POWERPNT.EXE', '周报-第42周.pptx - PowerPoint', 26 * M);
  O({ type: 'document', started_at: at(13, 40, 5), app_name: 'PowerPoint', window_title: '周报-第42周.pptx', file_path: 'E:\\工作\\周报\\周报-第42周.pptx' });
  // 14:10 VS Code 长专注
  W(14, 10, 0, 'VS Code', 'Code.exe', 'summarizer.js - mindtrace - Visual Studio Code', 48 * M);
  W(14, 58, 10, 'Edge', 'msedge.exe', 'better-sqlite3/docs/api.md at master · WiseLibs/better-sqlite3 - 个人 - Microsoft​ Edge', 4 * M);
  B(14, 58, 15, 'better-sqlite3 API', 'https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md');
  W(15, 2, 20, 'VS Code', 'Code.exe', 'store.js - mindtrace - Visual Studio Code', 33 * M);
  O({ type: 'ide', started_at: at(15, 40, 0), app_name: 'VS Code', window_title: 'IDE 会话快照 · 2 个工作区 · 3 提交', content: '## 今日提交', meta: JSON.stringify({ workspaces: ['e:/myapp/mindtrace', 'e:/myapp/grokweb'], recent: [{ source: 'VS Code', path: 'e:/myapp/mindtrace' }, { source: 'Cursor', path: 'e:/myapp/grokweb' }], commits: [{ hash: 'a1b2c3d4', subject: 'timeline: task sessions' }, { hash: 'b2c3d4e5', subject: 'clean window titles' }, { hash: 'c3d4e5f6', subject: 'day overview' }], commitCount: 3 }) });
  // 16:00 下载 + 资源管理器
  O({ type: 'download', started_at: at(16, 0, 0), app_name: 'Edge', window_title: 'electron-v33-win32-x64.zip', file_path: 'E:\\desktop\\下载\\electron-v33-win32-x64.zip' });
  W(16, 0, 30, '资源管理器', 'explorer.exe', '下载', 1 * M);
  W(16, 2, 0, '微信', 'Weixin.exe', '李娜', 7 * M);
  return rows;
};
