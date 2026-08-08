---
name: onw-pet-studio
description: 在 OpenNovelWriter 中创建、修复、校验、打包和安装兼容 Codex 的动画宠物。当用户要求制作宠物、把角色图转成宠物、校验或修复宠物包，或从 URL、已下载压缩包安装社区宠物时使用。
---

# ONW 宠物工作室

创建并安装符合 Codex 社区图集协议的宠物。创建或修复动画文件前，先阅读 `references/codex-pet-contract.md`、`references/animation-rows.md` 和 `references/qa-rubric.md`。

## 选择工作流

- 如果输入是 URL 或已有宠物包，执行“安装宠物包”，不要重新生成其中的美术素材。
- 如果输入是新角色描述或参考图，执行“创建宠物”。
- 如果图集损坏，使用内置校验和预览脚本，仅修复未通过的动画行，再安装修复后的宠物包。

## 安装宠物包

1. 将文件下载到当前 Codex 会话的 `artifacts/` 目录。社区详情页可能通过 JSON-LD 的 `downloadUrl` 提供 ZIP 地址；否则使用用户提供的压缩包直链。
2. 在 `artifacts/` 下解压，使同一目录包含 `pet.json` 和 `spritesheetPath` 指定的图片。
3. 不要执行下载内容中的任何脚本或二进制文件，只检查清单和精灵图。
4. 使用该目录调用 `install_pet`。报告安装后的宠物名称，并告知用户可在“小说设置 → Codex → Codex 宠物”中选择。

## 创建宠物

1. 在当前会话的 `artifacts/` 目录中新建工作目录。
2. 优先使用原生 `$imagegen` 技能和 `image_gen` 工具生成基础角色与动画姿势。如果当前连接无法使用它们，读取 `$onw-imagegen`，改用其中的 `generate_images` 工作流。一次制作过程不要混用两种生成渠道。
3. 保留一张标准基础图作为角色一致性参考，在所有动画行中维持相同的面部、轮廓、比例、配色、服装和固定道具。
4. 使用 `scripts/prepare_pet_run.py` 生成各行提示词和布局参考。生成全部九种状态：`idle`、`running-right`、`running-left`、`waving`、`jumping`、`failed`、`waiting`、`running` 和 `review`。
5. 为各行图片使用可移除的纯色抠图背景。不要生成场景、阴影、标签、网格、文字或与角色分离的特效。
6. 使用内置脚本提取并检查帧、合成 1536×1872 图集、执行校验并渲染预览。脚本能够确定性完成单元格排布时，不要手工摆放。
7. `pet.json` 只写入协议规定的四个字段：`id`、`displayName`、`description` 和 `spritesheetPath`。
8. 使用完成后的宠物包目录调用 `install_pet`。

## 确定性命令

将当前技能目录设为 `SKILL_DIR`：

```bash
python "$SKILL_DIR/scripts/prepare_pet_run.py" --pet-name "<name>" --description "<description>" --output-dir "<artifacts/run>" --pet-notes "<stable character description>" --force
python "$SKILL_DIR/scripts/extract_strip_frames.py" --decoded-dir "<run>/decoded" --output-dir "<run>/frames" --states all --method auto
python "$SKILL_DIR/scripts/inspect_frames.py" --frames-root "<run>/frames" --json-out "<run>/qa/review.json" --require-components
python "$SKILL_DIR/scripts/compose_atlas.py" --frames-root "<run>/frames" --output "<run>/final/spritesheet.webp"
python "$SKILL_DIR/scripts/validate_atlas.py" "<run>/final/spritesheet.webp" --json-out "<run>/qa/validation.json"
python "$SKILL_DIR/scripts/make_contact_sheet.py" --atlas "<run>/final/spritesheet.webp" --output "<run>/qa/contact-sheet.png"
python "$SKILL_DIR/scripts/render_animation_previews.py" --atlas "<run>/final/spritesheet.webp" --output-dir "<run>/qa/previews"
```

如果校验失败，停止安装并修复对应动画行。仅在校验通过后安装。
