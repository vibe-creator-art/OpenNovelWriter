---
name: "预设-修复过期来源"
description: "修复摘要已变但尚未同步的剧情来源。用户主动要求修复过期来源时使用；其他任务中若发现过期来源不少于 5 条，应主动询问是否修复。"
---
## Purpose
把已经过期的场景摘要来源重新同步进 Story State。只修账本，不改摘要、不改正文、不更新词条。

## When to use
- 用户主动提到修复过期来源、同步 outdated、摘要改了但剧情状态没跟上，或用 `/预设-修复过期来源` 调用本技能。
- 其他任务中读到 `novel/story-state/outdated.md`，或 `query_story_state` 返回的 `outdatedEpisodes` **不少于 5 条**时：先停下来询问是否现在修复，得到同意后再按本技能执行。少于 5 条且用户没提，不要打断当前任务。

## Instructions
先读内置 `story-state` 技能，再从 `novel/outline.md` 取 `novel_id`，读 `novel/story-state/outdated.md`。

**询问规则**
- 用户已经明确要求修复，或已经调用本技能：直接开始，不要再问一遍。可先报条数和所在章节。
- 这是在别的任务里发现 ≥5 条：只问一次，列出条数和章节，等用户同意。不要擅自开修。

**不要做**
- 不要只传 `novelId` 做全图查询，也不要通读返回里的全部 Moment / Entity / Fact。
- 不要把 outdated 当成 inactive；过期来源仍有效，Evidence 仍算数。
- 不要对 `SCENE_SUMMARY` 调用 `retract_story_episode`。
- 不要为了“来源写错了”去写 `validToMomentId` 或随手 `invalidateFactIds`。旧 Episode 被同步替换后会自己失活。
- 不要为修同步去读整章正文；判断小改/大改以旧 Episode 正文和当前场景摘要对比为准。
- 不要更新词条经历/关系，也不要新建词条。

**分类**
- `source_empty`：当前摘要是空的，`sync_scene_story_episode` 会失败。跳过，汇总告诉用户。空摘要不是删场景，通常是还在重写；等用户写出新摘要后再修。
- `outdated`：摘要有内容但和来源对不上。必须同步。

**小改（绝大部分情况）**
措辞、错字、同义替换、补一句但不改事实。
1. 在 `novel/story-state/facts-active.md` 里按该 `episode_id` 收集已挂上的 `factId`。
2. 调用 `sync_scene_story_episode`：只传这些 `factId`，沿用原来的 `referenceMomentId`。
3. 不要新建 Moment、Entity、Fact，不要 `closeFacts`。

**大改（小部分情况）**
章节重写、摘要重做、人物/结果/关系变了。
1. 按**新摘要**抽取。不要把旧 `factId` 原样 copy-forward。
2. 需要实体时，用带 `query` / `entityId` 的 `query_story_state` 复用已有实体；只看和本场相关的部分。
3. 只在摘要里有明确时间锚点或状态转折时才建 Moment。
4. 故事世界里状态真的变了才用 `closeFacts`。不要把“来源被改过”写成世界时间结束。
5. 一次 `sync_scene_story_episode` 就会换新来源并停用旧 Episode。只被这场支撑的旧 Fact 会失去当前证据，不必再 INVALIDATES；其他场还在支撑的 Fact 继续有效。

修完后重新读 `outdated.md`。剩下的应只有用户尚未补摘要的 `source_empty`。条数很多时按章节推进，不要一次把全图读进上下文。

## Output
用几句话汇报：处理了几条小改、几条大改、跳过几条空摘要；若还有未修项，说明原因和下一步。不要默认列出全部 Fact。
