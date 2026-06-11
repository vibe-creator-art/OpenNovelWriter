---
name: edit-manuscript
description: 修改小说稿件本身：小说名、卷名、章名、场景摘要、场景正文。当用户要求改书名/卷章标题、更新某场景的总结，或对场景正文做润色、修改、续写落稿时，先读本技能再调用 update_novel_title / update_act_title / update_chapter_title / update_scene_summary / edit_scene_content。只是阅读或分析稿件时不需要本技能。
---

# 稿件的修改

`novel/outline.md` 和 `novel/chapters/<chapter_id>.md` 是只读投影，**不要直接编辑投影文件**，一律走 MCP 工具。调用时用投影里 HTML 注释标注的 `novel_id`、`act_number`、`chapter_id`、`scene_id`。

## 标题与摘要

- `update_novel_title` / `update_act_title` / `update_chapter_title`：改小说名、卷名、章名。
- `update_scene_summary`：改场景总结。要把 `run_llm` 的模型回复直接写入时，用 `source: { mdPath, index }` 代替 `summary`，服务端会直接读取，不要重新打字。

## edit_scene_content — 修改场景正文

只用它改场景的「正文 / Content」，不要用它改总结、标题或工作区文件。

- 它接收一组 `edits`，每条是一个 `{ old_text, new_text }` 搜索/替换补丁。`new_text` 为空字符串表示删除该片段；段落之间用空行分隔。
- `old_text` 为空字符串表示在场景**末尾追加** `new_text`——这也是往**空场景起笔**的唯一方式（空场景没有可匹配的锚点）。
- 动手前**先读 `novel/chapters/<chapter_id>.md`**，把 `old_text` 从正文里**逐字照抄**（含标点）。`old_text` 必须在该场景里唯一，不唯一就多带些上下文。
- **每个改动拆成单独一条 hunk**，互不相关的改动不要塞进同一条，方便作者逐条审阅。
- **同一个场景的多处改动放在一次调用里**（`edits` 数组带多条 hunk），不要拆成多次调用。系统会自动把相邻段落的改动合并成一处审阅、把隔开的改动保留为多处。
- 要把 `run_llm` 生成的长段落（如续写）写入正文时，用空 `old_text` 加 `source: { mdPath, index }`，让文字直接来自会话文件而不是重新打字；回复里空行分隔的段落会成为正文里的独立段落。
- 改动会立即写入，但在作者于 App 里接受/拒绝前都处于「待审」状态；你不需要、也无法替作者确认。完成后用一两句话说明改了哪个场景的哪些地方，可配合章/场景跳转链接让作者过去查看。
