---
name: edit-summary
description: 修改小说的摘要：场景摘要、卷（act）摘要。当用户要求更新某场景的总结，或为某一卷写/改卷摘要（卷总结）时，先读本技能再调用 update_scene_summary / update_act_summary。只是阅读摘要时不需要本技能，直接读 novel/outline.md。
---

# 摘要的修改

`novel/outline.md`（卷摘要 + 场景摘要的索引）和 `novel/chapters/<chapter_id>.md`（场景摘要 + 正文）是只读投影，**不要直接编辑投影文件**，一律走 MCP 工具。调用所需的 `novel_id`、`act_number`、`scene_id` 都从投影里 HTML 注释取。

摘要不是正文：要改场景的「正文 / Content」用 `edit-manuscript` 技能的 `edit_scene_content`，不要用本技能的工具。

## update_scene_summary — 改场景摘要

传 `novelId` + `sceneId`，再给摘要内容。`sceneId` 取自 `outline.md` 或 `novel/chapters/<chapter_id>.md` 里的 `<!-- scene_id: ... -->`。

- 字面内容用 `summary`（传空字符串表示清空）。
- 要把 `run_llm` 的模型回复直接写入时，用 `source: { mdPath, index }` 代替 `summary`，服务端会直接读取，不要重新打字。
- `summary` 和 `source` 二选一，必须给一个。

## update_act_summary — 改卷（act）摘要

卷摘要是整卷的总结，在记忆召回（memory recall）里可代替整卷展开，常由 `run_llm` 跑「卷总结」生成。传 `novelId` + `actNumber`（`outline.md` 里 `<!-- act_number: ... -->` 注释中的卷号），再给摘要内容。

- 字面内容用 `summary`（传空字符串表示清空）。
- 要把 `run_llm` 生成的卷总结直接写入时，用 `source: { mdPath, index }` 代替 `summary`，不要重新打字。
- `summary` 和 `source` 二选一，必须给一个。
- 注意：卷**标题**（卷名）不归本技能，改卷名走 `edit-manuscript` 的 `update_act_title`。

两个工具执行成功后，对应投影会自动更新；用一两句话说明改了哪一卷/哪个场景的摘要即可，可配合卷/场景跳转链接让作者过去查看。
