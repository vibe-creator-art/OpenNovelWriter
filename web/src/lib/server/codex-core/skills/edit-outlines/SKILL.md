---
name: edit-outlines
description: 创建、修改、删除章节或卷的细纲（DetailedOutline，对某一章/某一卷剧情规划与走向的详细大纲）。当用户要求为某章/某卷撰写、改写或删除细纲时，先读本技能再调用 create_outline / edit_outline / delete_outline。只是查阅细纲内容时不需要本技能，直接读 novel/DetailedOutline/ 下的投影文件。
---

# 细纲的创建、修改与删除

细纲（DetailedOutline）是对某一**章**或某一**卷**剧情规划与走向的详细大纲，区别于 `novel/outline.md`（那是整体剧情总结）。每条细纲**绑定一个已存在的章或卷**，没有独立身份：

- 章纲：投影在 `novel/DetailedOutline/chapters/<chapterId>.md`，用 `chapterId` 定位。
- 卷纲：投影在 `novel/DetailedOutline/acts/<actNumber>.md`，用 `actNumber`（从 1 起的卷号）定位。

投影是只读的，**不要直接编辑投影文件**。`chapterId` 取自 `outline.md` / 章节文件里的 `<!-- chapter_id: ... -->`；`actNumber` 是 `outline.md` 里的卷号。三个工具都用 `chapterId` 或 `actNumber` 定位（二选一），细纲自身没有 id。

## create_outline — 为还没有细纲的章/卷新建细纲

传 `novelId` + `chapterId`（章纲）或 `actNumber`（卷纲，二选一）+ 正文：

- 短内容：直接把 Markdown 传 `content`。
- 长内容：先写到 `artifacts/` 下的某个 `.md`，再把该文件的绝对路径传 `mdPath`。
- `content` 与 `mdPath` 不能同时传。内容经 Markdown→HTML 转换后存储。
- 若该章/卷**已有**细纲会报错，改用 `edit_outline`。

## edit_outline — 改写已有细纲

传 `novelId` + `chapterId` 或 `actNumber` 定位，正文同样用 `content`（短改动）或 `mdPath`（长改写：把投影内容拷到 `artifacts/` 改好再传整篇）。该章/卷**还没有**细纲时会报错，先用 `create_outline`。整篇 `content`/`mdPath` 会**替换**原细纲。

## delete_outline — 删除细纲

传 `novelId` + `chapterId` 或 `actNumber`。**不可撤销的破坏性操作，只有当用户明确要求删除该章/卷的细纲时才调用**，不要自作主张。在"无需审核"等级下自动执行；其他等级会弹出确认，作者拒绝则什么都不会删。
