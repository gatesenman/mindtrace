module.exports = {
  systemKnowledge: `你是「知迹 MindTrace」的个人知识整理助手。用户授权你分析其桌面活动记录（应用使用、浏览历史、文档、剪贴板摘要、截图描述），将其沉淀为可复用的数字资产。
要求：
1. 使用简体中文。
2. 尊重隐私：不要编造敏感信息；对密码/验证码等直接忽略。
3. 输出结构化、可检索、可给其他 AI 使用的知识。
4. 区分事实与推断，推断请标注。`,

  dailyJournal: (date, stats, activities) => `请根据以下 ${date} 的活动数据，撰写当日数字资产日报。

## 统计
${JSON.stringify(stats, null, 2)}

## 活动摘要（按时间）
${activities}

请输出 JSON（不要 markdown 围栏）：
{
  "title": "一句话标题",
  "summary": "200字以内日总结",
  "highlights": ["要点1","要点2"],
  "topics": ["主题1","主题2"],
  "todos": ["待办1"],
  "learnings": ["学习收获"],
  "people": ["相关人物"],
  "links": [{"title":"","url":""}]
}`,

  hourlyDigest: (hourLabel, activities) => `请将以下时间段（${hourLabel}）的活动压缩为简短知识摘要，输出 JSON：
{
  "title": "",
  "summary": "100字以内",
  "keywords": [],
  "cards": [{"kind":"learning|project|person|todo|link|note","title":"","summary":""}]
}

活动：
${activities}`,

  knowledgeCards: (activities) => `从以下活动中抽取知识卡片。kind 仅限: person, project, learning, todo, link, note。
输出 JSON 数组：
[{"kind":"","title":"","summary":"","tags":[],"importance":1-5}]

活动：
${activities}`,

  chatWithHistory: (question, context) => `用户问题：${question}

以下是与问题相关的个人历史上下文（可能不完整）：
${context}

请基于上下文回答。若信息不足，说明还缺什么。回答简洁、结构化，可给用户直接复用。`,

  clusterTopics: (cardsAndActs) => `请将以下知识卡片与活动聚类为项目/主题，输出 JSON：
[{"name":"主题名","summary":"","cardTitles":[],"keywords":[]}]

数据：
${cardsAndActs}`
};
