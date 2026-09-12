---
name: onw-imagegen
description: 使用 OpenNovelWriter 配置的 GPT 图片服务生成或编辑位图，支持文生图、参考图生成、局部修改、蒙版、风格或构图迁移以及多图批量任务。仅当原生 imagegen skill 或 image_gen 工具在当前连接中不可用时，才使用本技能作为回退。
---

# ONW 图片生成

使用 OpenNovelWriter 的 `generate_images` MCP 工具。它调用「设置 → 其他连接」中配置的 GPT 图片模型，把结果保存到当前会话的 `artifacts/`，并返回前端可展示、可再次引用的 `image:` 引用。

## 工作流程

1. 优先使用原生 `imagegen` skill 和 `image_gen` 工具；只有原生能力在当前连接中不可用时，才继续本流程。
2. 判断用户要一张图片还是多张图片，并区分新生成与编辑现有图片。
3. 标明每张输入图的用途，例如编辑目标、身份参考、风格参考、构图参考、合成来源或蒙版。
4. 整理明确的提示词，覆盖主体、构图、风格、光照、限制条件和必须保留的细节。不要擅自增加用户未要求的角色、道具、标志或剧情设定。
5. 本地参考图、编辑目标和蒙版须位于当前会话的 `artifacts/` 中；若图片位于其他位置，复制到 `artifacts/image-inputs/`，不要修改原文件。URL 和当前图片服务的 File ID 可直接作为输入。
6. 确保父目录 `artifacts/images/` 存在，在其下选择一个新的小写输出目录路径。不要提前创建最终输出目录，也不要复用已有目录。
7. 按下方的单图或批量流程调用 `generate_images`。
8. 检查生成文件是否符合请求；工具或上游返回错误时不要声称成功。
9. 最终回复中让工具返回的 `suggestedLink` 单独占一行，不要向用户展示 artifact 的绝对路径。

## 单张输出

用户只要求一张图片时，直接调用 `generate_images`，不要创建批量 JSON。

参数：

- `directoryPath`：`artifacts/images/` 下尚不存在的新目录绝对路径。
- `prompt`：最终提示词。
- `id` 与 `label`：稳定的小写文件 id 和人类可读名称。
- `images`：可选的图片输入数组。每项可为本地 artifact 路径字符串，或指定 `path`、`imageUrl`、`fileId` 三者之一的对象；对象可加 `role` 说明用途，例如 `{ "imageUrl": "https://example.com/reference.png", "role": "风格参考" }`。支持混合输入；`imageUrl` 也支持 PNG/JPEG/WebP 的 base64 data URL。
- `mask`：可选的局部编辑蒙版路径，或指定 `path`、`imageUrl`、`fileId` 三者之一的对象；第一张输入图视为编辑目标。
- 用户需要时再传 `size`、`quality`、`background`、`outputFormat`、`outputCompression`、`moderation` 和编辑参数 `inputFidelity`。

固定使用 `n: 1`。用户要求多个版本时改用批量流程。

## 多张输出

只有用户明确要求多张图片或多个版本时，才在 `artifacts/image-jobs/` 下写批量任务 JSON，再以 `jobPath` 和新的 `directoryPath` 调用 `generate_images`，不要同时传 `prompt`。

JSON 结构：

```json
{
  "title": "NPC 头像",
  "size": "1024x1024",
  "quality": "auto",
  "outputFormat": "png",
  "items": [
    {
      "id": "npc-alo",
      "label": "阿洛",
      "prompt": "阿洛的方形角色头像……",
      "images": [
        { "path": "image-inputs/style.png", "role": "风格参考" }
      ]
    },
    {
      "id": "npc-lin",
      "label": "林月",
      "prompt": "林月的方形角色头像……"
    }
  ]
}
```

顶层选项是所有任务项的默认值。每个任务项可以覆盖 `size`、`quality`、`n`、`background`、`outputFormat`、`outputCompression`、`moderation` 或 `inputFidelity`，也可以提供自己的 `images` 和 `mask`。任务项 id 必须唯一，只使用小写字母、数字、点、下划线和连字符。

仅在同一任务项确实需要多个版本时设置该项的 `n`。整个批次最多生成 64 张图片。

## API 规则

- 纯文本请求自动使用 generation 端点；只要提供输入图或蒙版，就自动使用 edits 端点。
- 单次最多传 16 张输入图，本地文件每张不超过 50 MB。URL 和 File ID 直接交给配置的图片服务读取；与它们混用的本地文件会转为 data URL。每个 data URL 长度不能超过 20971520 个字符。
- 未指定构图尺寸时使用 `size: "auto"`。自定义宽高都必须是 16 的倍数，最长边不超过 3840，长宽比不超过 3:1，总像素数在 655360 到 8294400 之间。
- `quality` 默认使用 `"auto"`；GPT Image 2.5 支持 `"low"`、`"medium"`、`"high"`、`"xhigh"` 和 `"max"`，按用户要求选择。
- `background` 支持 `"auto"`、`"opaque"` 和 `"transparent"`；透明背景须使用 PNG 或 WebP，输出格式默认 PNG。
- `inputFidelity` 可设为 `"high"` 或 `"low"`，仅用于编辑请求；未指定时不发送，让图片服务采用默认值。
- `moderation` 未指定时采用服务默认值 `"auto"`。`outputCompression` 仅用于 JPEG/WebP，未指定时采用服务默认值 100。
- 蒙版必须与第一张输入图格式和尺寸一致，并包含 alpha 通道。
- 直接报告上游错误，不要静默改用其他模型、端点或纯文本生成。

## Artifact 引用

工具返回一个画廊引用，例如 `image:images/npc-portraits/manifest.json`，以及每张图片的单项引用，例如 `image:images/npc-portraits/manifest.json#npc-alo`。

后续用户消息带有 `image:` 引用时，读取对应 manifest；若带 fragment，则选择指定 id 的任务项，再把该项的图片文件作为编辑目标或参考图传回 `generate_images`。
