---
name: "预设-总结场景"
description: "示例skill，如何在场景操作中调用组装好的提示词"
---


## Purpose
检查通用场景总结拼装的提示词，然后使用run_llm进行生成并核对后写入update_scene_summary，如果提示词缺省参数，修改填写后再去调用LLM
