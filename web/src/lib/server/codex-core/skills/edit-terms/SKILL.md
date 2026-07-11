---
name: edit-terms
description: 创建、修改、删除小说词条（角色/地点/物品/设定等词条卡，含别名、描述、经历时间线、关系、标签、分类、颜色）。当用户要求新增 NPC、地点、物品、技能等设定，更新人物设定、经历或关系，重命名、归类或删除词条时，先读本技能再调用 create_term / edit_term / delete_term。只是查阅词条内容时不需要本技能，直接读 novel/terms/ 下的投影文件。
---

# 词条的创建、修改与删除

词条是小说的设定卡（角色、地点、物品、设定、技能、天赋、境界及自定义分类）。`novel/terms/<标题>.md` 是只读投影，**不要直接编辑投影文件**，一律走 MCP 工具。

## 通用规则

- 每个词条投影的头部注释里有 `<!-- novel_id: ... -->`、`<!-- term_id: ... -->`、`<!-- category_id: ... -->`，工具调用所需的 id 都从这里取。
- 修改已有词条前**先读它的投影文件**，基于现状改，不要凭记忆覆盖。
- 工具执行成功后投影会自动更新；新建词条的投影文件要到下一轮对话才会出现在 `novel/terms/` 里，但数据已即时生效，不要因此重试。

## 一个完整的词条长什么样

本技能同目录下的 `references/example-term.md` 是一个**所有字段都填满**的示例投影（角色「楚天歌」），需要时打开看一眼。各 section 与工具参数的对应：

| 投影 section | 工具参数 | 说明 |
| --- | --- | --- |
| 备注 | `subtitle` | 一行短语 |
| 分类 | `categoryId` | 投影里显示标签，参数传 id |
| 颜色 | `color` | 可选 |
| 标记 | `tags` | 可选 |
| 别名 | `aliases` | 逗号分隔，正文中会被识别 |
| 描述 | `description` / `descriptionMdPath` | Markdown，相对静态的设定 |
| 经历 | `experiences` / `appendExperiences` | 一行一条，按故事时间序 |
| 关系 | `relationOps` | 与其他词条的关系，参数传对方 `termId` |
| 资料页笔记 / 外部链接 / 追踪状态 | —（无参数） | 只能由作者在 App 里维护，不要尝试写入 |

**大部分词条不需要填满**：`title` + `categoryId` + `description` 是基本盘，角色通常再加 `aliases`；其余字段只在用户提到或确有必要时才填，不要为了齐全而编造内容。

## create_term — 新建词条

用户让你"想一个新 NPC / 新地点 / 新物品"并确认要落库时调用。常用参数：

- `title`（必填）：在本小说的活跃词条里必须唯一。
- `categoryId`：`characters` / `locations` / `items` / `lore` 总是可用；预设分类（`preset_skills` / `preset_talents` / `preset_realms`）和自定义分类只有小说已启用才有效——从同分类已有词条文件的 `category_id` 注释里抄。默认 `characters`。
- `subtitle`：一行备注；`aliases`：逗号分隔的别名/昵称（会在正文中被识别）。
- `description`：Markdown 描述（人物性格、外貌、背景等相对静态的设定）。内容长时先写到 `artifacts/` 下的 `.md` 文件，再用 `descriptionMdPath` 传绝对路径。
- `experiences`：经历时间线，字符串数组，**一条经历一行短句**，按故事时间顺序排列（如「三岁习剑」「十八岁创立白帝楼」）。描述写"是什么样的人"，经历写"发生过什么、有了什么变化"。
- `tags` / `color` 可选。

## edit_term — 修改词条

传 `novelId` + `termId`，再带要改的字段；省略的字段不动，传空字符串/空数组表示清空。`relationOps` 例外：空数组不清空关系，删除关系必须显式使用 `action: "delete"`。

- 经历时间线优先用 `appendExperiences` 追加（故事推进后补记最常见）；只有需要重写或重排时才用 `experiences` 整体替换，替换前必须先从投影里读出现有列表。两者不能同时传。
- 改 `title` 同样要求唯一；改 `categoryId` 规则同 create_term。
- 长描述重写：把现有描述拷到 `artifacts/*.md` 改好，再传 `descriptionMdPath`。
- 修改关系用 `relationOps`。先读当前词条和对方词条的投影文件，分别取得 `termId` 和 `otherTermId`；不要凭标题写关系。
- `relationOps` 一项一条操作：`{ "action": "set", "otherTermId": "...", "direction": "outgoing" | "incoming" | "bidirectional", "label": "师徒" }` 会创建或更新关系；`{ "action": "delete", "otherTermId": "..." }` 会删除关系。
- `direction` 始终以当前 `termId` 为视角：`outgoing` 表示当前词条指向对方，`incoming` 表示对方指向当前词条，`bidirectional` 表示双向。`label` 省略表示保留已有标签，传空字符串表示清空标签。

## delete_term — 删除词条

**不可撤销的破坏性操作，只有当用户明确要求删除该词条时才调用**，不要自作主张。在"无需审核"等级下自动执行；其他等级会弹出确认，作者拒绝则什么都不会删。删除会同时清掉其他词条指向它的关系。若用户只是想"先收起来"，建议在 App 里归档而不是删除。
