---
name: edit-prompts
description: 创建、修改、删除 OpenNovelWriter 提示词和组件，或把酒馆/SillyTavern 等外部预设转换成 OpenNovelWriter 提示词。当用户要求新增提示词、改写提示词、调整输入或宏、重构组件、删除提示词、导入或迁移外部提示词预设时，先读本技能。只是运行已有提示词时不需要本技能。
---

# 提示词的创建、修改与删除

提示词存储在 OpenNovelWriter 中，不要直接修改数据库或内置预设资产。使用专用工具把当前用户的提示词库和三个基础示例导出到 `artifacts/`，在其中编写 change-set，先校验，得到用户确认后再应用。

## 开始前

1. 调用提示词库导出工具。阅读返回的 manifest，并按需打开相关提示词、组件和 `examples/` 下的三个基础预设。
2. 创建或编辑模板前，必须阅读 [references/prompt-macros.md](references/prompt-macros.md)。
3. 转换酒馆/SillyTavern 预设时，还必须阅读 [references/sillytavern-present.md](references/sillytavern-present.md)。原始 JSON 先运行 `scripts/extract-sillytavern-preset.mjs <input.json> --list-profiles`；用户选定 profile 后，再运行 `scripts/extract-sillytavern-preset.mjs <input.json> <output.json> --profile <index>`。
4. 修改已有提示词前，以导出文件中的 `id` 和 `updatedAt` 为准。不要根据名称猜 id。

## 三类基础上下文

先确定目标类别。基础预设只用于确认该类别可用的 ONW 上下文宏、输入机制和拼装方式，不是新提示词的内容底稿。

用户提供酒馆/SillyTavern 等外部预设时，默认执行忠实迁移。只有用户明确要求“提炼外部预设的内容，并将其融合或扩写到某个基础预设中”时，才可以把基础预设作为内容框架。否则，不得以基础预设为骨架去补写、扩写或重组外部预设的局部内容；不得复制、改写、仿写或拼接基础预设中的任何文字片段、规则、标签、默认输入或表达。迁移结果的内容只能来自用户提供的外部预设、用户明确要求新增的内容，以及完成宏和格式转换所必需的 ONW 结构。

用户没有提供外部预设、而是口头描述希望创建提示词时，以“预设-通用续写”作为基线，再按用户要求扩充或修改。

- `scene_continuation`：除非用户明确要求省略，否则默认完整使用当前指令、指令提及词条、前文、故事摘要、卷纲和章纲；资料选择仅在用户明确需要额外资料时添加。
- `scene_action`：使用当前场景正文、小说语言和任务专用输入，例如目标字数或输出格式。
- `ai_chat`：使用当前用户输入、聊天历史涉及的词条、小说大纲和可选额外资料。最后一条 user 消息必须恰好包含一次 `{{ chat.userInput }}`。
- `component`：只承载确实会被复用的片段。不要为了拆分而拆分，不要复制已有组件。

## 创建和编辑

1. 明确用户要解决的任务、目标类别、输出内容以及需要暴露给作者的选项。
2. 优先复用导出库中的组件。只有一段内容会被多个入口或多个选项共同使用时才新建组件。
3. 为真正需要频繁调整的参数创建输入：二元设置用 checkbox；语义互斥、同时只能启用一个的候选项用单选 dropdown；同类型但彼此不冲突、允许叠加生效的候选项用多选 dropdown。必须阅读候选内容和源说明后判断，不能只凭相同图标认定互斥。外部预设迁移时，输入必须对应源预设中的候选项或用户明确提出的参数，不能自行补充。能从源预设当前启用项或原始值推断的默认值必须预填；有足够默认值的输入不得标为必填，只有确实需要作者首次决定且没有合理默认值时才设为必填。
4. 生成 `open-novel-writer/prompt-change-set` JSON。更新和删除必须带 `id` 与 `expectedUpdatedAt`；更新只在 `set` 中放需要修改的字段。
5. 先以 `mode: validate` 调用变更工具。修复所有错误，并把将创建、修改、删除的提示词、组件复用、输入设计和重要取舍告诉用户。
6. 必须取得用户明确同意后，才以 `mode: apply` 应用。用户最初已明确要求某个简单修改时，该要求本身可视为同意；外部预设迁移、批量变更、改名和删除始终先展示计划。

不要写兼容别名、legacy 组件或旧数据清理逻辑。组件改名时，在同一个 change-set 中显式更新所有 include；做不到就不要改名。不要自动迁移 user skill 的 `prompt:` 绑定。

## 删除

删除不可撤销，只在用户明确要求时执行。删除前检查工具的依赖报告：被其他提示词 include、被 user skill 绑定或作为其他运行入口使用时，先处理引用或停止。已有 AI chat 会继续使用保存的提示词快照；工具只报告数量，不自动迁移其 `promptId`。不要通过留下同名空组件来模拟删除。

## Change-set 格式

```json
{
  "schema": "open-novel-writer/prompt-change-set",
  "version": 1,
  "operations": [
    { "action": "create", "prompt": { "name": "...", "category": "scene_continuation", "messages": [], "inputs": [] } },
    { "action": "update", "id": "...", "expectedUpdatedAt": "...", "set": { "messages": [] } },
    { "action": "delete", "id": "...", "expectedUpdatedAt": "..." }
  ]
}
```

新提示词默认不绑定模型、不设为默认。提示词的 `modelGroupIds`、`modelSetIds`、数据库归属和历史记录不属于 change-set；更新会保留现有模型绑定。

## 完成后

简洁说明实际创建、修改或删除了什么，以及哪些模型绑定或默认选择仍需作者在界面中设置。不要向用户回复内部 artifact 的绝对路径。
