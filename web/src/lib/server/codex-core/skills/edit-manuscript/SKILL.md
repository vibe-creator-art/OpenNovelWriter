---
name: edit-manuscript
description: 修改小说稿件本身：小说名、卷名、章名、场景正文，以及增删卷/章/场景这类结构调整。当用户要求改书名/卷章标题，对场景正文做润色、修改、续写落稿，或新建/删除某一卷、某一章、某个场景时，先读本技能再调用 update_novel_title / update_act_title / update_chapter_title / edit_scene_content / create_act / create_chapter / create_scene / delete_act / delete_chapter / delete_scene。改场景或卷的摘要请读 edit-summary 技能；只是阅读或分析稿件时不需要本技能。
---

# 稿件的修改

`novel/outline.md` 和 `novel/chapters/<chapter_id>.md` 是只读投影，**不要直接编辑投影文件**，一律走 MCP 工具。调用时用投影里 HTML 注释标注的 `novel_id`、`act_number`、`chapter_id`、`scene_id`。卷没有独立 id，一律用 `act_number`（从 1 起的卷号）定位；章、场景用各自的 `chapter_id` / `scene_id`。

## 标题

- `update_novel_title` / `update_act_title` / `update_chapter_title`：改小说名、卷名、章名。
- 改场景摘要或卷摘要不在本技能，走 `edit-summary` 技能（`update_scene_summary` / `update_act_summary`）。

## edit_scene_content — 修改场景正文

只用它改场景的「正文 / Content」，不要用它改总结、标题或工作区文件。

- 它接收一组 `edits`，每条是一个 `{ old_text, new_text }` 搜索/替换补丁。`new_text` 为空字符串表示删除该片段；段落之间用空行分隔。
- `old_text` 为空字符串表示在场景**末尾追加** `new_text`——这也是往**空场景起笔**的唯一方式（空场景没有可匹配的锚点）。
- 动手前**先读 `novel/chapters/<chapter_id>.md`**，把 `old_text` 从正文里**逐字照抄**（含标点）。`old_text` 必须在该场景里唯一，不唯一就多带些上下文。
- **每个改动拆成单独一条 hunk**，互不相关的改动不要塞进同一条，方便作者逐条审阅。
- **同一个场景的多处改动放在一次调用里**（`edits` 数组带多条 hunk），不要拆成多次调用。系统会自动把相邻段落的改动合并成一处审阅、把隔开的改动保留为多处。
- 要把 `run_llm` 生成的长段落（如续写）写入正文时，用空 `old_text` 加 `source: { mdPath, index }`，让文字直接来自会话文件而不是重新打字；回复里空行分隔的段落会成为正文里的独立段落。
- 改动会立即写入，但在作者于 App 里接受/拒绝前都处于「待审」状态；你不需要、也无法替作者确认。完成后用一两句话说明改了哪个场景的哪些地方，可配合章/场景跳转链接让作者过去查看。

## 增删卷 / 章 / 场景（结构调整）

这组工具只动稿件**骨架**（新建空壳、删除空壳），不写正文——新建后再用 `edit_scene_content` 起笔、用 `update_*_title` 命名。每个新建工具都会返回新建对象的标识。

### 新建

- `create_act` — 新建一卷。传 `afterActNumber` 插到该卷**之后**（其后所有卷号自动 +1）；**省略 `afterActNumber`** 则插到最前（新卷成为第 1 卷，原有各卷整体后移），全书还没有卷时同样省略（直接成为第 1 卷）。可顺手带 `title` / `summary`。返回新卷的 `actNumber`。
- `create_chapter` — 在某卷里新建一章。传 `actNumber`（目标卷，须**已存在**，必要时先 `create_act`）+ `afterChapterId` 插到该章**之后**；**省略 `afterChapterId`** 则插到该卷最前（空卷亦然）。新章自带一个空场景。可顺手带 `title`，省略则按全书章序自动取默认标题「章 N」（与手动建章一致，并顺带把被它挤后的「章 N」占位标题重编号）。返回新章的 `chapterId`（及默认 `sceneId`）。
- `create_scene` — 在某章里新建一个空场景。传 `chapterId` + `afterSceneId` 插到该场景**之后**；**省略 `afterSceneId`** 则插到该章最前。返回新场景的 `sceneId`。

### 删除（破坏性 + 非空拒删）

只删**空壳**，非空会直接报错——这是有意的护栏，不要为了删除而去清空正文。

- `delete_act` — 传 `actNumber`。该卷**还有任何章节就删不掉**；删成功后会移除卷元数据与其卷纲，并把后续卷号顺次下移保持连续。
- `delete_chapter` — 传 `chapterId`。该章**任一场景有正文，或还挂着内联续写面板，就删不掉**；删成功会连同其场景和章纲一起移除。
- `delete_scene` — 传 `sceneId`。该场景**有正文，或挂着续写面板，就删不掉**；也**不能删该章最后一个场景**（每章至少留一个，要清空整章请改用 `delete_chapter`）。

删除是不可撤销的破坏性操作：在「无需审核」等级下自动执行；其他等级会弹确认，作者拒绝则什么都不删。只有当作者明确要求删除时才调用，不要自作主张。
