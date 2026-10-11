# 知迹 MindTrace

把每天散落在浏览器、文档、微信和各个窗口里的操作，**经你授权后**整理成可复用的个人数字资产。

- **本地优先**：数据默认只存在本机 `userData`
- **分项授权**：窗口 / 浏览器（Chrome·Edge 多配置档） / 文档 / 剪贴板 / 截屏识图
- **AI 沉淀**：日刊、主题、知识卡片、问问历史（带引用跳转）
- **可被其他 AI 使用**：Obsidian Markdown 导出 + 本机 HTTP API（端口默认 `17321`）
- **体验示例数据**：无需真实采集即可预览完整界面（含样例问答与引用）

> 不是监控软件。不做键盘记录，不破解微信数据库，不默认上传云端。

---

## 安装（Windows）

产物目录：`dist/`

| 文件 | 说明 |
|------|------|
| `MindTrace-1.0.0-setup.exe` | **NSIS 安装包**（简体中文、可选目录、桌面/开始菜单快捷方式） |
| `MindTrace-1.0.0-portable.exe` | 便携版，免安装直接运行 |
| `MindTrace-1.0.0-win-x64.zip` | 绿色解压版 |
| `MindTrace-1.0.0-source.zip` | 源码包（开发用） |

若 Windows SmartScreen 提示「未知发布者」，选择「仍要运行」（本地/开源构建未做代码签名属正常）。

### 从源码运行

```bash
npm install
npm start
# 开发模式
npm run dev
```

打包（需在可构建 Windows 目标的环境；本仓库 CI/开发机已可交叉打 win 包）：

```bash
npm run build:win
```

---

## 首次授权（必读）

首次启动会进入 **4 步引导**，不可跳过授权说明：

1. **欢迎** — 了解知迹做什么  
2. **选择采集项** — **默认全部关闭**；请主动勾选需要的项  
3. **配置 AI** — 可稍后配置  
4. **完成** — 可选开机自启 / 进入后开始采集  

随时可在 **采集中心** 开关单项、查看采集器状态，或用 `Ctrl+Shift+M` / 托盘菜单 **一键暂停**。

关闭主窗口不会退出，应用会留在系统托盘。

---

## 配置 AI 模型（推荐）

路径：**设置 → OpenAI 兼容接口**

| 预设 | Base URL（参考） | 推荐模型 |
|------|------------------|----------|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Ollama 本地 | `http://127.0.0.1:11434/v1` | 如 `llama3.2` |
| 自定义 | 任意兼容网关 | 自定 |

建议：

1. 填入 API Key 后点 **测试连接**  
2. 温度建议 `0.2–0.4`（结构化摘要更稳）  
3. 若要用截屏识图，填写支持视觉的 **视觉模型**（如 `gpt-4o`、`qwen-vl-plus`）；未配置时截屏仍会保存，只是没有 AI 描述  
4. 本地 Ollama 可不填 Key  

功能入口：

- 今日页 **生成本日摘要** → 日刊 + 卡片增量  
- 知识库 **从近况抽取卡片** / 主题聚类  
- **问问历史** → 自然语言检索（回答带引用芯片，可跳转时间线/卡片/日刊）

开发者可用内置 Mock：

```bash
node scripts/mock-openai-server.js 3921
# 然后在设置里把 Base URL 设为 http://127.0.0.1:3921/v1 ，Key 任意
```

---

## 导出到 Obsidian

点击顶栏 **导出知识库**，选择目录后生成：

```
MindTraceVault/
├── 00-首页.md
├── 日刊/
├── 主题/
├── 卡片/
│   ├── 人物/
│   ├── 项目/
│   ├── 所学/
│   ├── 待办/
│   └── 链接/
└── raw/export.json
```

用 Obsidian「打开文件夹作为库」即可。中文路径与文件名已做安全处理。

---

## 本地 API（供其他 AI 调用）

默认 **关闭**。在 **设置** 中启用后监听 `127.0.0.1:17321`。

Header：`Authorization: Bearer <Token>`（设置页可复制）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/stats/today` | 今日统计 |
| GET | `/activities?q=&type=&limit=` | 时间线 |
| GET | `/cards?kind=` | 知识卡片 |
| GET | `/journals` | 日刊列表 |
| GET | `/journals/:day` | 单日日刊 |
| GET | `/topics` | 主题 |
| POST | `/ask` | `{"question":"..."}` → `{answer,citations}` |
| POST | `/summarize` | 触发生成日刊 |
| POST | `/extract-cards` | 抽取卡片 |
| POST | `/cluster-topics` | 主题聚类 |
| GET | `/mcp/tools` | 工具清单（轻量 MCP 风格发现） |

示例：

```bash
curl -s http://127.0.0.1:17321/health -H "Authorization: Bearer <token>"
curl -s http://127.0.0.1:17321/ask -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"question":"今天我和谁讨论过项目？"}'
```

---

## 隐私

1. **未授权不采集**；每项默关  
2. 数据仅在本机；调用云端 AI 时才会发送你触发摘要/问答所需的上下文  
3. 应用 / 网站 / 关键词 **黑名单**；剪贴板 **自动脱敏**（证件号、银行卡、API Key、验证码等）  
4. **不会记录知迹自身窗口**；应用名会显示为友好名称（微信、Chrome、VS Code…）  
5. 截屏默认可限微信等封闭应用；空闲过久不截；可设保留天数  
6. 崩溃日志：`采集中心 → 打开崩溃日志`

---

## 界面说明

| 导航 | 内容 |
|------|------|
| 今日 | 专注时长、浏览页数、摘要、应用分布、最近活动 |
| 时间线 | 按日/类型检索窗口·浏览·文档·剪贴板·截屏 |
| 知识库 | **日刊 / 主题 / 卡片** 三 Tab |
| 问问历史 | 建议问题芯片；示例模式下预置带引用的问答 |
| 采集中心 | 开关、状态、黑名单、示例数据 |
| 设置 | AI、本机 API、关于 |

支持浅色 / 深色主题切换。

---

## 常见问题

**Q: 安装后提示无法运行？**  
A: 允许 SmartScreen「仍要运行」；或改用 portable / zip。检查是否被杀软隔离。

**Q: Chrome 历史读不到？**  
A: 知迹会 **复制 History 文件再读**。请确认已授权「浏览器历史」，并至少用过 Chrome/Edge。多配置档（Profile 1…）会自动扫描。

**Q: 微信为什么没有聊天记录？**  
A: 不破解微信数据库。请开启「定时截屏」，并在前台使用微信时由 AI 识图生成描述（需配置视觉模型）。

**Q: 为什么统计里没有「electron」？**  
A: 已刻意忽略知迹自身窗口，避免污染专注统计。

**Q: 问问历史是空白？**  
A: 未配置 AI 且无历史时显示引导与建议问题。可先开「体验示例数据」查看样例问答；或配置 API 后提问。

**Q: 生成摘要失败？**  
A: 到设置测试连接；检查 Key、Base URL、网络与模型名。也可用本地 Ollama / Mock 服务排查。

**Q: 数据在哪？如何清除？**  
A: `%APPDATA%/知迹 MindTrace/`（或 Electron `userData`）。采集中心可关示例数据；卸载时可选保留用户数据。

---

## 开发与测试

```bash
# Mock OpenAI
node scripts/mock-openai-server.js 3921

# AI / API / 脱敏 / 自窗口过滤 等自动化
./node_modules/.bin/electron scripts/e2e-ai-test.js --no-sandbox

# 截图巡游（覆盖 screenshots/）
./node_modules/.bin/electron . --dev --screenshot-tour --no-sandbox --user-data-dir=/tmp/mindtrace-shots
```

设计规格（若同级目录存在）：`../mindtrace-design/DESIGN.md`

## 许可证

MIT
