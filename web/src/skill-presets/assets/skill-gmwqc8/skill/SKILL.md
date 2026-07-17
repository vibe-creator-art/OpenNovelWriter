---
name: "预设-使用提示词进行场景续写"
description: "使用定义好的提示词进行场景续写，当用户想要更新一整章或者续写大量正文时使用"
---
## Purpose
进行大量正文描写或者更新一整章的时候使用，使用提示词的文风指导以及context拼装会比直接让codex写提示词效率和效果都要好

## When to use
- 用户想要写一整章的时候或者续写大量正文时使用，询问用户是否使用该技能，并确认“预设-通用续写”提示词有绑定模型，如果用户同意则进行

## Instructions
1. 使用describe_prompt了解提示词
2. 使用compose_scene_continuation拼装提示词
3. 使用run_llm调用外部模型进行生成
4. 使用edit_scene_content写入正文
