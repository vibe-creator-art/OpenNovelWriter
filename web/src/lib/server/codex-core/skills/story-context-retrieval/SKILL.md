---
name: story-context-retrieval
description: 从当前 OpenNovelWriter 小说中只读检索与自然语言问题相关的正文场景，并可选检索 Story State 知识图谱。用户要求回忆前文、查找人物或物品、核对事件经过、分析伏笔与连续性，或按故事时刻查询实体、Fact 与 Episode 时，先读本技能再调用 retrieve_story_context。支持 BM25、可选 Embedding、图谱一跳扩展与可选 Reranker。
---

# 故事上下文检索

使用 `retrieve_story_context` 从当前小说的正文场景中召回相关上下文。该工具只读，不修改稿件。

## 检索步骤

1. 从 `novel/outline.md` 确认 `novel_id`。若已经有可靠的 `novel_id`，不要重复查找。
2. 把用户的问题改写成一条简洁、可独立理解的检索语句，保留人物名、地名、物品名和关键动作。不要只提交“这个”“后来怎样”等脱离上下文的指代。
3. 调用 `retrieve_story_context`，传入 `novelId` 和 `query`。通常省略 `topK`，使用作者在“记忆召回”中配置的数量；只有用户明确要求数量时才覆盖。默认只查正文；需要结构化实体、事实或来源时设置 `includeKnowledgeGraph: true`。
4. 根据返回的 `chapterId`、`sceneId`、摘要片段和分数组合判断相关性。分数只用于同一次查询内排序，不要跨查询比较。
5. 每个结果只包含 Scene 中最多 1200 字符的内容，不是 Scene 全文。
6. 片段以“…”结尾，关键的句子被截断、或者关键信息不完整，仅凭片段无法确认答案时，才要按返回的 `chapterId` 直接打开 `novel/chapters/<chapterId>.md` 查看原文，不要遍历整个章节目录，也不要推测被省略的内容。如果返回的内容可以判断，则不需要
7. 引用具体场景时使用 `[章名·场景](scene:chapterId:sceneId)`。只使用工具返回或投影中真实存在的 id。

## 知识图谱选项

- 设置 `includeKnowledgeGraph: true` 后，正文结果仍在 `results`，图谱结果在 `storyStateResults`。
- 查询某一故事时刻成立的 Fact 时传 `targetMomentId`；只查询某个 Moment 之后开始的 Fact 或 Episode 时传 `afterMomentId`。
- 默认只返回当前可采信 Fact 与有效 Episode。追溯旧摘要、失效状态或证据历史时才设置 `includeHistory: true`。
- Entity、Fact、Episode 先经过 BM25 与可用向量召回，再加入一跳邻域并融合、重排；最终 Fact 仍由 Moment 有效区间和 Evidence 判断，检索分数不能覆盖结构化状态。

## 查询策略

- 一个问题包含多个独立事件时，拆成多次聚焦查询，再综合结果。
- 精确名称、原句和专有名词交给 BM25；含义相近但措辞不同的描述由已启用的 Embedding 补充。
- 没有结果时，换用更具体的实体或动作重试一次。仍无结果就明确说明未检索到，不要编造。
- Embedding 未缓存或已过期时，检索仍会使用 BM25；不要因为缺少向量而拒绝检索。
- 本技能只读检索正文与可选知识图谱，不修改 Story State 或稿件。需要写入时改用 `story-state` 技能。
