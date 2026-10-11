# 知迹 MindTrace

把每天散落在浏览器、文档、微信和各个窗口里的操作，**经你授权后**整理成可复用的个人数字资产。

- 本地优先：数据默认只存在本机
- 分项授权：窗口 / 浏览器 / 文档 / 剪贴板 / 截屏均可单独开关
- AI 沉淀：日刊、知识卡片、问问历史
- 可被其他 AI 使用：Obsidian Markdown 导出 + 本机 HTTP API

> 不是监控软件。不做键盘记录，不破解微信数据库，不默认上传云端。

## 安装（Windows）

1. 下载 `dist/` 中的便携包：
   - `MindTrace-1.0.0-portable.exe`（推荐，解压即用 / 便携运行）
   - 或 `MindTrace-1.0.0-win-x64.zip`
2. 双击运行。首次启动进入四步引导。
3. 若 SmartScreen 提示，选择「仍要运行」（本地构建未签名属正常）。

开发模式（需 Node 20+）：

```bash
npm install
npm start
```

## 授权与采集

首次启动必须完成引导：

1. **欢迎** — 了解知迹做什么
2. **选择采集项** — 默认全部关闭，请主动打开需要的项
3. **配置 AI** — DeepSeek / 通义千问 / Kimi / OpenAI / Ollama，可稍后配置
4. **完成** — 可选开机自启，进入主界面

随时可在「采集中心」调整开关与黑名单。  
全局暂停快捷键：`Ctrl+Shift+M`（托盘菜单也可暂停）。

### 各采集项说明

| 项 | 说明 |
|----|------|
| 窗口时间线 | 前台应用名、窗口标题、停留时长；空闲自动断开 |
| 浏览器历史 | 复制 Chrome/Edge 本地 History 后只读解析 |
| 文档与笔记 | 关注 Documents/Desktop/Downloads 等目录变动；尝试提取 pdf/docx/md/txt 文本 |
| 剪贴板 | 文本与链接；自动脱敏证件号/卡号/密钥等 |
| 定时截屏 | 用于微信等不便读库的软件；结合视觉模型可生成描述（需配置支持视觉的模型） |

## 配置 AI

在「设置」中填写 OpenAI 兼容接口：

- **DeepSeek**：`https://api.deepseek.com/v1` · `deepseek-chat`
- **通义千问**：DashScope compatible-mode
- **Kimi**：`https://api.moonshot.cn/v1`
- **OpenAI** / **Ollama 本地**（`http://127.0.0.1:11434/v1`）

保存后可点「测试连接」。配置成功后可：

- 生成本日摘要（日刊）
- 从近况提炼知识卡片
- 在「问问历史」里用自然语言检索

## 导出与对接其他 AI

- **导出知识库**：生成 Obsidian 兼容文件夹（日刊 / 卡片 / 时间线 / raw JSON）
- **本机 API**（默认端口 `17321`，需 Token）：
  - `GET /health`
  - `GET /stats/today`
  - `GET /activities?q=`
  - `GET /cards`
  - `GET /journals`
  - `POST /ask` body: `{"question":"..."}`
  - Header: `Authorization: Bearer <token>`

## 隐私说明

1. 未完成引导授权前，不启动任何采集。
2. 所有原始数据与截屏保存在应用 `userData` 目录，默认不上云。
3. 调用 AI API 时，会将**你触发的摘要/问答所需上下文**发送到你配置的模型服务商；请自行选择可信服务或本地 Ollama。
4. 支持应用 / 网站 / 关键词黑名单；写入前自动脱敏常见敏感模式。
5. 关闭主窗口会最小化到托盘，不会退出；托盘可彻底退出。

## 目录结构（开发）

```
src/main/        Electron 主进程、配置、存储
src/collectors/  各类采集器
src/ai/          模型客户端与提示词
src/export/      Markdown / JSON 导出
src/api/         本机 HTTP API
src/renderer/    界面（简体中文）
src/privacy/     脱敏
```

## 许可证

MIT
