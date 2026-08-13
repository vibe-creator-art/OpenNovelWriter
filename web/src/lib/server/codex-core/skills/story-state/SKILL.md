---
name: story-state
description: 维护并查询 OpenNovelWriter 小说的时序剧情状态。完成场景或章节总结后需要记录 Story Moment、Entity、Alias、Fact 与 Episode 来源，作者明确确认一项世界设定，需要核对当前事实、历史状态、人物关系或来源证据时，先读本技能再使用 story-state 工具。不要把普通聊天、未确认脑洞或每个 Scene 自动写成 Moment。
---

# 剧情状态

把 Story State 当作 Codex 维护的剧情账本：Moment 表示故事世界时间，Episode 保存来源快照，Entity 与 Alias 负责实体消歧，Fact 保存带有效区间的命题，Evidence 连接 Fact 与来源。

## 查询现状

1. 从 `novel/outline.md` 取得 `novel_id`。
2. 调用 `query_story_state` 时尽量带过滤：已知实体 id 传 `entityId`，按名称/别名传 `query`，查一类命题传 `predicateKey`，按故事时刻传 `targetMomentId`。只传 `novelId` 会返回当前全图，仅在真正需要总览时使用。`query` 只过滤实体列表；Fact 靠 `entityId` / `predicateKey` 收窄。返回里的 `outdatedEpisodes` 是摘要已变或被清空、但尚未重新同步的有效 Scene 来源。
3. 需要自然语言召回时，调用 `retrieve_story_context` 并设置 `includeKnowledgeGraph: true`。按某一时刻判断状态时传 `targetMomentId`；只查某个时刻之后发生的状态时传 `afterMomentId`。
4. 默认不设置 `includeHistory`。只有追溯旧状态、摘要修订或证据来源时才启用。
5. `novel/story-state/outdated.md` 列出待修复来源。陈旧来源仍 active，其 Fact 默认仍可采信；只有全部 active SUPPORTS 都来自漂移来源时，Fact 才会带 `staleCredible`。不要把 outdated 当成 inactive。

## 对给定内容同步

1. 调用 `query_story_state`，复用已有实体、别名、Moment 与重复 Fact。不要仅因措辞变化创建新实体或新 Fact。
2. 只在摘要包含明确时间锚点、状态转折或需要表达先后时创建 Moment。一章可以创建零个、一个或多个 Moment。
3. 创建 Moment 时只传自然语言 `label` 与可选 `afterMomentId`。省略 `afterMomentId` 表示插到最前；不要计算或提交整数顺序，也不要寻找“下一 Moment”。`sourceSceneId` 只记录来源，不把 Moment 与 Scene 绑成一对一。
4. 用 `upsert_story_entity` 创建或更新实体。先按主名和别名查询；同名结果歧义时传明确的 `entityId`。重复实体用 `merge_story_entities` 合并到 survivor（保留 survivor 的 `termId`）。空壳且未绑 Term 才允许 `delete_story_entity`。
5. 用 `add_story_entity_alias` 保存称谓、旧名、简称与缩写。正文出现的抽取别名使用 `EXTRACTED`；作者确认的别名使用 `MANUAL`；来自正式词条的别名使用 `TERM`。错别名用 `delete_story_entity_alias`，不要随来源陈旧删除别名。
6. 调用 `sync_scene_story_episode`。工具直接读取已保存的 Scene summary：摘要 hash 未变会跳过；摘要变更会原子创建新 Episode revision 并停用旧版本。作者改摘要不会自动调用本工具，只会让来源变为 outdated。空摘要无法同步。小改只传原有 `factId` 续挂；大改（章节重写、摘要重做）按新摘要抽取，不要把旧 `factId` 原样 copy-forward。旧 Episode 失活后，仅由该来源支撑的 Fact 会失去当前证据，不必再单独 INVALIDATES；其他场景仍支持的 Fact 继续可采信。
7. 没有被 Episode 或 Fact 引用的 Moment 可用 `delete_story_moment` 删除。有引用则拒绝。

## 记录 Fact

- `predicateKey` 使用稳定的大写键，例如 `OWNS`、`LOCATED_AT`、`STATUS`、`KNOWS`、`BELIEVES`、`CLAIMS`、`PREDICTS`。
- 每条新 Fact 只提供 `objectEntityId` 或 `objectValue` 之一。实体宾语优先使用 id；简单状态值使用字符串。
- `factText` 写成可独立理解的完整自然语言事实，不把推测写成确定事实。
- 有效区间采用 `[validFromMomentId, validToMomentId)`。自然语言纪年只放在 Moment label；前后比较由 Moment 的内部整数顺序完成。
- 已存在且含义相同的 Fact 只传 `factId`，让新 Episode 增加 SUPPORTS Evidence。
- 故事世界中状态真实变化时，用 `closeFacts` 在新 Moment 关闭旧 Fact，并创建从该 Moment 生效的新 Fact。
- 来源本身被纠正时使用 `invalidateFactIds`，不要伪造 `validToMomentId`。Scene summary revision 通常已经通过旧 Episode 失活完成来源修正。

## 作者确认的手工知识

只有作者明确表示某项设定成立时，才调用 `assert_story_facts` 创建 MANUAL Episode。把确认内容压缩成清晰的 `content`，并按相同规则提交 Fact、关闭或否定关系。普通讨论、备选方案、问题和未确认脑洞不进入 Story State。

作者撤回一条手工来源时，先查询证据并确认目标 Episode，再调用 `retract_story_episode`。不要删除历史来源。
