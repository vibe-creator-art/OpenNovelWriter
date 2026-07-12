# OpenNovelWriter 提示词宏

本参考以运行时模板渲染器为准。模板使用 Nunjucks，关闭自动转义。创建或编辑提示词时只使用这里列出的上下文，不要假设酒馆宏或其他模板变量存在。

## 基础语法

```nunjucks
{{ value }}
{% if value %}...{% endif %}
{% set terms = instruction.terms | union(inputs["额外信息"].term) %}
{% include "组件名" %}
{# 注释不会进入渲染结果 #}
```

`{{ ... }}` 输出表达式，`{% ... %}` 是控制语句，`{# ... #}` 是注释。`{%-`、`-%}` 可裁掉标签相邻的空白。include 按组件名称匹配，不区分大小写，最大嵌套深度为 5；缺失、循环或超深都会产生警告。`union` 只合并词条集合并去重，不是通用字符串或数组函数。

同一提示词的消息按顺序作为一次 Nunjucks 渲染处理，原生 `{% set %}` 定义的变量可在后续 system、user、assistant 消息中读取；每次执行都会创建新的变量作用域，不会写入小说或数据库。

```nunjucks
{% set wordsCloud = "不少于1000" %}
{{ wordsCloud }}
{{ ["a", "b", "c"] | random }}
{{ value | trim }}
{{ roll("1d6") }}
```

`random` 与 `trim` 是 Nunjucks 原生 filter。`roll("NdM")` 是 ONW 为迁移酒馆骰子宏提供的唯一额外模板函数，输出 `N` 个 `1..M` 随机点数之和；格式非法会输出空字符串。

单独占行的变量声明会留下换行。变量本身不需要输出文本时，使用两侧空白控制，避免预览和最终提示词出现成片空行：

```nunjucks
{%- set harukiCoreStatement = "" -%}
{%- set cotBegin = "我们来看看用户的任务" -%}
```

不要为保留 Tavern 的空变量而输出一个空白字符；空值用 `""`。只有源值本身的首尾空白有语义时才保留它，并避免使用会改变该值的 `trim` filter。

## 小说上下文

| 宏 | 内容 |
| --- | --- |
| `{{ novel.language }}` | 当前小说语言 |
| `{{ novel.outline }}` | 当前执行点之前的故事摘要，等同于 `storysofar` |
| `{{ novel.outline.storysofar }}` | 当前执行点之前的故事摘要 |
| `{{ novel.outline.full }}` | 全书所有非空卷摘要和场景摘要 |

## 场景与指令

| 宏 | 内容 |
| --- | --- |
| `{{ scene.text }}` | 当前场景完整正文，主要用于 `scene_action` |
| `{{ scene.previousText }}` | 续写位置之前的正文 |
| `{{ scene.followText }}` | 续写位置之后的正文 |
| `scene.hasPreviousText` / `scene.hasFollowText` | 对应正文是否非空 |
| `{{ scene.chapterOutline }}` | 当前章的章纲 |
| `{{ scene.actOutline }}` | 当前卷的卷纲 |
| `scene.hasChapterOutline` / `scene.hasActOutline` | 对应细纲是否非空 |
| `{{ instruction.text }}` | 场景续写时作者给出的当前指令 |
| `instruction.terms` | 当前指令提及和始终包含的词条集合 |

词条集合提供 `.count`、`.text`、`.value`：`.text` 是词条名称/简要表示，`.value` 是完整词条块。通常注入知识时使用 `.value`。

```nunjucks
{% set terms = instruction.terms | union(inputs["额外信息"].term) | union(inputs["额外信息"].termTag) %}
{% if terms.count %}
<TermKnowledge>
{{ terms.value }}
</TermKnowledge>
{% endif %}
```

## AI 聊天

| 宏 | 内容 |
| --- | --- |
| `{{ chat.userInput }}` | 当前一轮用户输入 |
| `chat.userInput.terms` | 当前输入提及和始终包含的词条集合 |
| `{{ chat.history }}` | 当前会话历史合并文本 |
| `chat.history.terms` | 历史消息提及和始终包含的词条集合 |

AI 聊天入口的最后一条消息必须是 user，并且整份提示词中只能在该消息里出现一次裸 `{{ chat.userInput }}`。需要知识时可合并 `chat.userInput.terms`、`chat.history.terms` 和内容选择词条。

## 输入

所有输入都通过 `inputs["输入名"]` 读取。引用的输入名必须在提示词的 `inputs` 数组中定义。

### Custom 和 checkbox

`{{ inputs["名称"].value }}` 与 `.text` 都是最终字符串：dropdown 选项优先使用选项 `content`，为空时使用 `label`；多选和自由文本以空行连接。checkbox 开启时值为 `displayName`（为空则为输入名），关闭时为空字符串。条件判断直接使用该值：

```nunjucks
{% if inputs["启用planning"].value %}...{% endif %}
```

### 内容选择

每个子集合都有 `.count`、`.text`、`.value`：

| 子集合 | 内容 |
| --- | --- |
| `term` | 作者选择的词条 |
| `termTag` | 由所选标签展开的词条 |
| `snippet` | 作者片段 |
| `fullNovel` | 全书选择 |
| `act` | 卷选择 |
| `chapter` | 章选择 |
| `scene` | 场景选择 |
| `actOutline` | 卷纲选择 |
| `chapterOutline` | 章纲选择 |

`.text` 通常是标题或简短表示，`.value` 是按输入配置的全文或摘要。直接读取 `inputs["额外信息"].value` 会把所有所选内容合并；精细拼装时读取子集合。

## 类别边界

- `scene_continuation`：优先使用 `instruction.*`、`scene.previousText/followText`、细纲和 outline。
- `scene_action`：优先使用 `scene.text`、语言和任务输入。
- `ai_chat`：使用 `chat.*`，不要用 `instruction.text` 代替当前聊天输入。
- `component`：自身没有独立运行入口，只在被 include 的入口上下文中渲染。

未提供的上下文会渲染为空字符串，而不是报错。不要因此跨类别滥用宏。
