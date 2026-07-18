---
name: edit-skills
description: 创建、迁移、修改、克隆或删除 OpenNovelWriter 用户技能（完整 skill folder）。当用户给出工作流/想法希望做成技能、提供外部 skill 仓库链接要求迁移，或要求编辑/删除现有技能时，先读本技能。
---

# OpenNovelWriter 用户技能管理

用户技能是完整目录，不是单个 Markdown 字符串。只能通过 `export_skill_library` 和 `apply_skill_changes` 读取快照、校验并推送到用户技能库；不要直接修改 OpenNovelWriter 数据目录或 CODEX_HOME 下的同步链接。

## ONW 可执行边界

生成或迁移后的技能必须能在 OpenNovelWriter 当前环境中明确执行：

- 数据读写只使用当前可用的 OpenNovelWriter MCP 工具；小说工作区 Markdown 仍是只读投影。
- 可以使用 session `artifacts/` 保存中间文件，并使用已有的 `run_llm`、提示词组装和其他 ONW 工具。
- `scripts/` 仅允许放入完成该技能所必需、无需安装依赖、只依赖当前已有运行时或标准库的脚本。脚本不能绕过 MCP 直接修改 ONW 数据。
- 不支持或不得导入：hooks / trust hook、`.codex/agents` 部署、外部 MCP 依赖、浏览器/CDP/登录自动化、全局软件集成、守护进程、系统配置修改、包管理器安装步骤以及任何要求安装 git/npm/pip/brew/浏览器驱动的功能。
- **绝不自行安装任何依赖或软件。** 外部技能无法在上述边界内重写时，停止并给出兼容性报告；不要假装已经支持。

## 目录格式

每个技能目录至少包含：

```text
skill-name/
├── SKILL.md
└── onw.json
```

可按需加入 `scripts/`、`references/`、`assets/`、`agents/openai.yaml`、`LICENSE`、`NOTICE` 等文件。不要为了显得完整而创建空文件。

`SKILL.md` 使用官方 Codex skill frontmatter，只在编辑区维护 `name` 和 `description`：

```markdown
---
name: example-skill
description: 清楚说明做什么以及何时触发。
---

# Instructions
...
```

ONW 专属信息写在 `onw.json`：

```json
{
  "schema": "open-novel-writer/skill",
  "version": 1,
  "category": "ai_chat",
  "prompt": null
}
```

`category` 只能是 `scene_continuation`、`scene_action`、`ai_chat`。`prompt` 为已有 ONW 提示词的精确名称或 `null`；不确定或无需额外模型时使用 `null`。

`ai_chat` 技能在聊天输入框中的唯一显式调用方式是 `/` 加 `SKILL.md` frontmatter 中的精确 `name`，例如 `/story-deslop`。不要创造别名、`@skill` 调用方式或把触发词写成额外注册机制；`plan`、`compact`、`fast` 是 ONW 保留的内置 slash 命令，不得用作 `ai_chat` 技能名。`scene_action` 和 `scene_continuation` 技能仍由各自的场景工作流直接调用，不要为它们伪造 slash 命令。

## 从想法或工作流创建

1. 调用 `export_skill_library`，检查现有名称、目录格式和相关技能，避免重复。
2. 把用户的目标拆成 ONW 能执行的触发条件、输入、步骤、工具调用、失败边界和输出；不得把模糊愿望写成不可验证的“自动完成”。
3. 在导出目录旁建立新的完整技能目录。指令应简洁，较长规则放入 `references/`，确定性处理放入无需依赖的 `scripts/`。
4. 编写 change-set，先 `mode=validate`。简单且用户已明确要求创建的单个技能可在校验通过后直接 apply；批量创建或包含明显设计取舍时先展示计划。

## 外部技能的保真迁移

用户要求“迁移”“导入”“适配”外部技能时，默认目标是**在 ONW 能力边界内尽可能 1:1 还原源技能**，不是提炼、重写或重新设计。只有用户明确要求精简、翻译、重构、融合或改写时，才可以主动改变原内容。

- 先完整复制用户指定的源 skill folder，再在副本上做最小适配；禁止从空白模板重新概括生成。
- 对决定保留的 `SKILL.md` 正文、`references/`、`scripts/`、`assets/`、许可证及其他资源，保留原文件名、目录结构、引用关系、标题顺序、规则、阈值、示例、措辞和细节。除非用户另有要求，不得摘要、提炼、翻译、润色、合并、拆分、去重、改写或以“更适合 ONW”为由补充源文件没有的规则。
- 源 `SKILL.md` 的 `name` / `description` frontmatter 可以按官方 Codex 格式和用户指定名称调整，并新增 `onw.json`。正文只局部修改确实与 ONW 冲突的工具名、路径、数据读写方式和执行步骤；不得借适配 frontmatter 或工具调用之名重写整篇正文。
- 被源 `SKILL.md` 引用且在 ONW 中仍可使用的文件，默认都是必要文件；不得因为文件很长、内容重复、上下文成本高或主观认为“不核心”而省略或缩写。无需改动的文件应逐字节复制。
- 支持的脚本默认原样保留。只有依赖、路径、工具调用或数据写入与 ONW 冲突时才做局部修改；不得为了“简洁”重写算法或删减检查项。无法在 ONW 边界内运行且无法局部适配的脚本才删除，并在兼容性报告中逐文件说明。
- 必须删除或改写的内容仅限 ONW 明确不支持的 hooks / trust hook、外部 agent 或 MCP、浏览器自动化、依赖安装、系统集成，以及对 ONW 数据的非法直接写入。删除不支持能力时，只动与该能力直接相关的段落和文件，保留其余独立可用内容。
- 通用的 skill-creator 精简原则只适用于从想法新建技能，不构成压缩外部技能的理由。外部迁移的保真要求优先。

应用前做逐文件差异审计：原样保留的文件必须与源文件一致；适配文件的每一个差异块都必须归入“ONW 必需适配”“用户明确要求”或“frontmatter / onw.json 格式转换”。发现无法说明的删减、改写或新增时，恢复源内容。向用户展示的迁移计划必须列出原样保留、局部适配、删除和新增的文件；不能只给概括性总结。

## 从外部链接迁移

1. 先调用 `export_skill_library`。
2. 如果当前环境已经有 `git`，可用 `git --version` 确认。对于公开 GitHub 仓库，只使用以下规范命令克隆到本 session：

   ```text
   git clone --depth 1 --single-branch --no-tags https://github.com/OWNER/REPOSITORY.git artifacts/skill-imports/UNIQUE_NAME
   ```

   直接执行这条命令；如果沙箱拦截网络，为完全相同的命令请求一次性提升权限，让 OpenNovelWriter 按当前会话的审核模式处理，不要因第一次网络失败就提前停止。`OWNER` 只能包含字母、数字或连字符，`REPOSITORY` 和 `UNIQUE_NAME` 只能包含字母、数字、点、下划线或连字符；目标必须是 `artifacts/skill-imports/` 下的单层新目录。不要添加其他 git 参数，不要使用 SSH、子模块、shell 拼接、重定向或环境变量。没有 git、审批被拒绝、规范命令获批后仍网络失败、仓库不是公开 GitHub 仓库或仓库不可访问时停止并报告；不要安装 git，不要改用安装脚本。
3. 定位用户指定的源 skill folder，完整阅读其 `SKILL.md`、所有直接或间接引用文件、脚本、许可证和安装说明。先逐文件列出：原样保留、局部适配、必须删除、新增 ONW 文件；不要只列能力摘要。
4. 把源 skill folder 完整复制为迁移副本，不复制仓库级 `.git`、CI、issue 模板、市场发布配置和与目标技能无关的文件。目标 skill folder 内的文件按“外部技能的保真迁移”规则处理，不能凭主观重要性筛选。
5. 只对确定冲突处做 ONW MCP + `artifacts/` 的局部适配。删除 hooks、浏览器、外部 agent/MCP、依赖安装等不支持内容时，保留同一文件中其余可执行规则；若删除后核心目标无法成立，停止并说明，不要创建残缺技能。
6. 对源目录和迁移副本做逐文件 diff，逐项解释所有差异并恢复无依据的变化。外部迁移始终先 validate，向用户展示保真差异清单、兼容性取舍和完整文件计划，得到明确同意后再 apply。

## 编辑与删除

- 修改已有技能必须从导出副本开始，使用 manifest 中的 `id` 和 `updatedAt`，不要按名称猜 id。
- 官方预设克隆是只读的；需要修改时让用户先克隆为普通技能，或在 change-set 中创建一个新的普通副本。
- 删除不可撤销，只在用户明确要求时执行，并保留 delete 操作的 `expectedUpdatedAt`。
- 不要留下 legacy 副本、兼容别名或同名空技能。

## Change-set

change-set JSON 中的 `directory` 相对于该 JSON 所在目录，目录会被完整复制：

```json
{
  "schema": "open-novel-writer/skill-change-set",
  "version": 1,
  "operations": [
    { "action": "create", "directory": "changes/new-skill", "enabled": true },
    { "action": "update", "id": "skill-id", "expectedUpdatedAt": "...", "directory": "changes/updated-skill" },
    { "action": "delete", "id": "skill-id", "expectedUpdatedAt": "..." }
  ]
}
```

先调用 `apply_skill_changes` 的 `mode=validate`，修复全部错误并核对返回计划；再按上面的授权规则调用 `mode=apply`。完成后简洁说明实际创建、修改或删除了哪些技能，以及被明确排除的外部能力。不要向用户回复内部 artifact 的绝对路径。
