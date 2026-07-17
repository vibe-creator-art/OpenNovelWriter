---
name: "预设-场景续写"
description: "示例skill，如何在场景续写中调用组装好的提示词"
---


## Instructions
通过run_llm调用prompt绑定的模型，然后把模型的回复写入draft。后续用户可能会需要你继续去修改这个draft，如果用户明确说了他没动，你就直接改，不然最好还是check一下draft现在的状态
