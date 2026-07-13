# 酒馆 / SillyTavern 预设迁移

目标是把用户选定的 SillyTavern prompt profile 尽可能逐项还原为 ONW 提示词，不是根据预设主题重新写一套 ONW 风格提示词。用户只要提供了外部预设，且没有明确要求“提炼预设内容并融合/扩写到基础预设中”，就必须按忠实迁移模式处理：原文保真优先于通用化、补全或美化。

基础预设只是 ONW 能力参考，不是迁移底稿或文案素材。在忠实迁移模式下，严禁先复制一份基础预设，再用外部预设的局部内容去替换、补写或扩写；严禁复制、改写、仿写或拼接基础预设中的任何片段。“优化”、“完善”、“做成 ONW 格式”或“参考基础预设”都不等于获得了融合内容的授权。

## 范围与提取

原始 JSON 先列 profile：

```sh
node scripts/extract-sillytavern-preset.mjs <preset.json> --list-profiles
```

有多个 profile 时，说明每套的总数、启用数和 `characterId`，请用户选定一套。选定后才导出：

```sh
node scripts/extract-sillytavern-preset.mjs <preset.json> <artifact.json> --profile <index>
```

导出文件只在 `selectedProfile.items` 中保存该 profile 的有序条目和完整正文，包含关闭项；候选组只引用这些条目的 identifier。`prompts` 数组中没有被任何 `prompt_order` 引用的定义没有插入顺序或开关状态，不是这次迁移素材：不要读它们来补充文风、功能或输入。预设很长时先查看 profile 摘要和条目名称，再按区段读取 `selectedProfile.items`，不要一次输出整份 JSON。

忽略采样参数：temperature、top-p、top-k、min-p、penalty、上下文长度和输出 token 上限。

## 不可违反的保真规则

1. 按 `selectedProfile.items` 的顺序处理每一项。逐项建立迁移台账，记录名称、原始顺序、role、启用状态、去向和理由。
2. 只改写 Tavern 宏和 ONW 无法承载的 marker；其余源文字、称呼（例如 `Haruki`）、中文标签、特殊 token、伪造对话、role 和默认开关必须保留。不要翻译、概括或补写。
3. 不得从三个基础示例、其他用户提示词或自身惯例借入 prose、XML 标签、默认值、输入或规则；也不得将其中任何片段做同义改写后混入结果。基础示例仅用于确认可用的 ONW 上下文宏、输入类型和运行时接口。
4. 不得凭空添加 `<Role>`、`<CoreRules>`、额外信息、字数档位、成人内容开关、文风或任何未出现在源 profile 的内容。默认迁移所需的 `<Planning>` / `<Content>` 输出分离按本参考的“标签、格式与 regex”规则处理。
5. 源 profile 中关闭的项也必须在结果中存在。可独立开关的项保留为 checkbox；语义互斥、只能同时启用一个的候选组使用单选 dropdown；同类型但允许同时生效的候选组使用多选 dropdown。相同图标只是候选组信号，不代表一定互斥，必须阅读名称、正文和“选一/互斥”等源说明后判断。默认值保持源 profile 的启用状态，候选项 `content` 必须保持原文。源 profile 已给出当前启用项或原始值时，必须将其填入输入默认值；有此默认值的输入不设为必填。模板对单选和多选都优先直接输出 `{{ inputs["输入名"].value }}`，不要为每个选项生成条件分支。
6. 每个不能迁移的条目必须在生成 change-set 前逐项列出原因。不要静默删除。用户确认后才可舍弃。

## 迁移计划与结果检查

生成 change-set 前先展示：目标类别、逐项台账、所有输入及默认值、marker 的精确替换、宏转换和所有舍弃项。得到明确同意后再上传。

生成 JSON 后自检：选定 profile 的每一项都有去向；原有启用/关闭默认状态一致；有内容的非 marker 项保留原文（仅允许宏/marker 的明确替换）；除默认迁移的 `<Planning>` / `<Content>` 外，结果不存在未在源 profile 或用户要求中出现的新 prose、标签、输入或选项；结果不包含任何复制、改写、仿写或拼接自基础预设的片段。

## 原生 Nunjucks 与 Tavern 宏

ONW 模板用 Nunjucks：`{{ ... }}` 输出，`{% ... %}` 为控制语句，`{# ... #}` 为注释。详情见 [prompt-macros.md](prompt-macros.md)。

| Tavern 内容 | ONW 转换 |
| --- | --- |
| `{{setvar::name::value}}` | `{%- set name = "value" -%}`，保持值原意且不留下变量声明的空行；同一提示词的后续消息可读取。 |
| `{{getvar::name}}` | `{{ name }}`。 |
| `{{random::a,b,c}}` | `{{ ["a", "b", "c"] \| random }}`。 |
| `{{roll 1d999999}}` | `{{ roll("1d999999") }}`。 |
| Tavern 注释 | `{# ... #}`，不发送给模型。 |
| `{{trim}}` | 不向模型输出文本；依实际空白需求使用 Nunjucks 的 `-{%` / `-%}` 或值过滤器 `\| trim`。 |

不要把 `setvar/getvar` 变成未来源于预设的自定义输入，也不要把变量声明拆成一批组件。空变量使用 `""` 而不是输出空白字符，并使用 `{%- ... -%}` 避免预览产生空行。模型专用 token、伪造 user/assistant 消息和原有角色默认原样保留；只在 ONW 传输层确实不能表达时报告限制。

## Marker 与小说上下文

marker 不是可自由重写的内容。对于 `scene_continuation`，除非用户明确要求省略，默认在相应的原始位置完整注入：世界书/角色信息用 `instruction.terms.value`，前文用 `scene.previousText`，剧情记忆用 `novel.outline`，卷章规划用 `scene.actOutline` 与 `scene.chapterOutline`。有后文 marker 或续写锚点后仍有正文时，再使用 `scene.followText`。不要因为原预设的一个 marker 未单独列出，就遗漏上述其余小说上下文；保留每一段原有插入位置，不额外创建“资料”输入。

对于 `scene_continuation`，固定玩家身份、`Persona Description`、`USER设定` 这类专为角色扮演用户而设的条目通常不适用；说明 ONW 用词条与作者指令承载人物和设定后，逐项标为舍弃。集中 AI 角色、防抢话和小总结也必须说明为何不适用于小说续写，不能悄悄删除。用户要求 AI 聊天/RP 时，不应按续写规则舍弃这些项。

## 标签、格式与 regex

默认迁移模式必须使用 ONW 的两个输出标签：正文放入 `<Content>`，计划、推理、检查、状态计算及其他非正文内容放入 `<Planning>`。迁移源预设的标签时，保留其指令含义，但将原本依靠酒馆 regex 隐藏的非正文输出改为 Planning，以免显示在小说正文中。

源预设若要求在正文末尾输出状态栏、变量更新，或每隔一段正文插入思考/自检，这些内容不能同时既保持原位又被 ONW 的 Content/Planning 正确分离。默认舍弃这些条目，并在迁移计划中逐项说明原因。用户明确坚持完整保留原格式时，才改用原预设标签和顺序、不额外加入 `<Planning>` / `<Content>`；同时明确告知用户前端会把这些非正文内容混入输出，显示和写入正文都会较杂乱。

SillyTavern regex 是独立的发送前/回复后管线，ONW 没有等价执行器。只在计划中逐条报告 regex；不要新增 regex 兼容运行时，也不要把它们擅自改写成新提示词文本。
