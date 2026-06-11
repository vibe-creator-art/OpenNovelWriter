---
name: edit-snippets
description: 创建、修改、删除小说片段（snippet，作者的笔记/设定碎片/分析存档）。当用户同意把分析结果存为片段，或要求改写、置顶、删除某个片段时，先读本技能再调用 create_snippet / edit_snippet / delete_snippet。只是查阅片段内容时不需要本技能，直接读 novel/snippets/ 下的投影文件。
---

# 片段的创建、修改与删除

片段是作者的笔记、设定碎片和分析存档。`novel/snippet.md` 是索引，`novel/snippets/<id>.md` 是只读投影，**不要直接编辑投影文件**。

## create_snippet — 新建片段

详细分析应先在对话里完整回答；**只有用户明确同意保存**时才落库：先把内容写成 `artifacts/` 下的一个 Markdown 文件（标题和内容用用户提问的语言），再调用 `create_snippet` 传该文件的绝对路径 `mdPath`（可选 `pinned` 置顶）。

## edit_snippet — 修改片段

传 `snippetId`（即 `novel/snippets/<id>.md` 里的 `<id>`），可改标题、置顶状态、内容，至少给一项：

- 短改动：直接把新 Markdown 传 `content`。
- 长改写：把投影内容拷到 `artifacts/` 下的某个 `.md`、在那里改好，再把该文件的绝对路径传 `mdPath`（整篇内容会成为新内容）。
- `content` 和 `mdPath` 不能同时传。内容会经 Markdown→HTML 转换后存储。

## delete_snippet — 删除片段

传 `snippetId`。**不可撤销的破坏性操作，只有当用户明确要求删除该片段时才调用**，不要自作主张。在"无需审核"等级下自动执行；其他等级会弹出确认，作者拒绝则什么都不会删。
