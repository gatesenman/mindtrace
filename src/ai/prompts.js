module.exports = {
  systemKnowledge: `你是「知迹」的知识整理助手。根据用户授权采集的电脑使用轨迹，生成结构化、可执行的中文知识资产。
规则：
1. 只使用提供的数据，不编造事实；不确定就写「未知」。
2. 输出简体中文，语气冷静、具体，避免鸡汤。
3. 保护隐私：若内容像密码、证件号、银行卡，用[敏感]代替，不要复述原文。
4. 区分「做了什么」与「学到什么」；待办要可执行。
5. 严格按用户要求的 JSON 或 Markdown 格式输出，不要额外寒暄。`,

  dailyJournal: (date, stats, activities) => `日期：${date}
统计：${JSON.stringify(stats)}
关键事件抽样：
${activities}

请输出 JSON（不要 markdown 围栏）：
{
  "title": "一句话标题",
  "summary": "今日概览（200字内）",
  "highlights": ["要点"],
  "topics": ["主题"],
  "todos": ["可执行待办"],
  "learnings": ["所学"],
  "people": ["人物"],
  "links": [{"title":"","url":""}]
}`,

  hourlyDigest: (hourLabel, activities) => `时间段：${hourLabel}
事件列表（已脱敏）：
${activities}

请输出 JSON：
{
  "headline": "一句话",
  "bullets": ["要点"],
  "apps": ["主要应用"],
  "candidate_cards": [{"type":"learning|todo|person|project|link","title":"...","body":"..."}]
}`,

  knowledgeCards: (activities) => `从以下活动中抽取知识卡片。type 仅限: person, project, learning, todo, link。
输出 JSON 数组：
[{"kind":"person|project|learning|todo|link","title":"","summary":"","tags":[],"importance":1-5}]

活动：
${activities}`,

  chatWithHistory: (question, context) => `用户问题：${question}

以下是与问题相关的个人历史上下文。每条活动前有引用编号如 [E1]、[C2]、[J1]。
${context}

请基于上下文用简体中文回答。要求：
1. 回答简洁、结构化。
2. 在关键论断后用引用编号标注来源，例如……[E3][C1]。
3. 最后单独一行输出：CITATIONS: E1,C2 （只列你真正用到的编号，逗号分隔；若无则 CITATIONS: none）
4. 若信息不足，说明还缺什么。`,

  clusterTopics: (cardsAndActs) => `请将以下知识卡片与活动聚类为 3–12 个主题项目，输出 JSON：
[{"name":"","summary":"","cardTitles":[],"keywords":[]}]

数据：
${cardsAndActs}`,

  visionScreenshot: `这是用户桌面截屏（可能来自微信等）。用中文简述：
1) 当前应用与界面类型
2) 可见的关键文本（聊天对象、文件名、标题；不要猜测不可见内容）
3) 用户可能在做的事情（一句话）
若画面含明显密码/验证码/转账信息，对应位置写[敏感]且不要转录数字。
输出 JSON：{"app_guess":"","ui":"","key_text":[],"activity":"","sensitive":false}`
};
