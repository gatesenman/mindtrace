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
活动摘要：
${activities}

请输出 JSON（不要 markdown 围栏）：
{
  "title": "一句话标题",
  "summary": "200字以内日总结",
  "highlights": ["要点1","要点2"],
  "topics": ["主题1"],
  "todos": ["可执行待办"],
  "learnings": ["学习收获"],
  "people": ["相关人物"],
  "links": [{"title":"","url":""}]
}`,

  hourlyDigest: (hourLabel, activities) => `时间段：${hourLabel}
事件：
${activities}

输出 JSON：
{
  "headline": "一句话",
  "bullets": ["要点"],
  "apps": ["主要应用"],
  "candidate_cards": [{"type":"learning|todo|person|project|link","title":"...","body":"..."}]
}`,

  knowledgeCards: (activities) => `从以下活动中抽取知识卡片。kind 仅限: person, project, learning, todo, link, note。
输出 JSON 数组：
[{"kind":"","title":"","summary":"","tags":[],"importance":1-5}]

活动：
${activities}`,

  chatWithHistory: (question, context) => `用户问题：${question}

相关摘录（可能不完整）：
${context}

请用中文回答。信息不足时说明还缺什么，不要编造。回答简洁、可复用，必要时分点。`,

  visionScreenshot: `这是用户桌面截屏（可能来自微信等）。用中文简述并输出 JSON：
{"app_guess":"","ui":"","key_text":[],"activity":"","sensitive":false}
规则：不要猜测不可见内容；密码/验证码/转账数字写[敏感]且不要转录。`,

  clusterTopics: (cardsAndActs) => `请将以下知识卡片与活动聚类为 3–12 个主题，输出 JSON：
[{"name":"","description":"","cardTitles":[],"keywords":[]}]

数据：
${cardsAndActs}`
};
