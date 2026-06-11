# OpenNovelWriter

## 警告 / Warnings

**中文**

本项目仅适用于学习 Codex 与上下文管理。Codex 拥有较大的本地权限，可能会修改、覆盖或删除小说内容；使用本项目即视为您已经了解并接受这些风险。

小说内容会被转换为明文，供 Codex 建立索引和读取上下文。如果您使用别人服务器上部署的本项目，您的小说内容对服务器维护者来说是明文可见的。如果您搭建本项目给别人使用，恶意用户可能通过 prompt injection 窃取您或其他使用者的小说内容、Codex 连接 auth，甚至窃取服务器上的其他内容。

因此，本项目**仅**适用于自己搭建自己使用，或者只提供给自己信任的朋友使用。因商用或大规模公益使用导致的小说内容泄露、服务器被攻击、数据损坏或其他损失，本项目不承担责任。

此外，本项目代码均由 Codex 编写，可能存在 bug。如果您想要稳定的写作体验，推荐使用 [Novelcrafter](https://www.novelcrafter.com/)。

**English**

This project is intended only for learning about Codex and context management. Codex has broad local permissions and may modify, overwrite, or delete novel content. By using this project, you acknowledge and accept these risks.

Novel content is converted into plaintext so Codex can index it and read it as context. If you use an instance hosted on someone else's server, your novel content is visible to that server operator in plaintext. If you host this project for other users, malicious users may use prompt injection to steal your novel content, other users' novel content, Codex connection auth, or even other server-side data.

For that reason, this project is **only** suitable for self-hosting for your own use, or for use by friends you personally trust. This project is not responsible for novel-content leaks, server compromise, data loss, or other damage caused by commercial use or large-scale public use.

The code in this project was written by Codex and may contain bugs. If you want a stable writing experience, use [Novelcrafter](https://www.novelcrafter.com/).

## 项目说明

OpenNovelWriter 是一个基于 Next.js、Prisma 和 SQLite 的小说写作实验项目，用于探索 Codex 驱动的小说上下文管理、章节/场景组织、提示词配置、AI 模型组和 Codex 会话工作流。

本项目使用了 [Cherry Studio](https://github.com/CherryHQ/cherry-studio) 的模型类型判别相关代码，因此采用 Cherry Studio 使用的 AGPL-3.0 License。项目在 UI 和逻辑设计上参考了 Novelcrafter、Codex，以及 [Deng-m1/MaliangAINovalWriter](https://github.com/Deng-m1/MaliangAINovalWriter)。

## 环境要求

- Node.js 20 或更新版本
- npm
- Git

## 安装依赖

```bash
cd web
npm install
```

首次运行前，创建或确认 `web/.env`。可以从示例文件复制：

```bash
cp .env.example .env
```

本地开发最少只需要配置数据库路径；下面是一个更完整的示例：

```bash
DATABASE_URL="file:./dev.db"
# 可选：生产环境建议设置，未设置时会使用代码默认值
JWT_SECRET="change-this-in-production"
# 可选：未设置时会自动生成并写入本地数据目录
AI_CREDENTIALS_SECRET="change-this-too"
```

可选配置：

```bash
NEXT_PUBLIC_ALLOW_REGISTER=true
ALLOW_REGISTER=true
SITE_BASIC_AUTH_ENABLED=false
SITE_BASIC_AUTH_USERNAME=
SITE_BASIC_AUTH_PASSWORD=
OPENNOVELWRITER_DATA_DIR=
```

初始化数据库：

```bash
npx prisma migrate deploy
npx prisma generate
```

开发时如果需要创建或调整迁移，也可以使用：

```bash
npx prisma migrate dev
```

## 启动项目

开发模式：

```bash
cd web
npm run dev
```

默认访问地址：

```text
http://localhost:3000
```

生产构建与启动：

```bash
cd web
npm run build
npm run start
```

## 更新项目

更新代码与依赖：

```bash
git pull
cd web
npm install
npx prisma migrate deploy
npx prisma generate
npm run build
```

如果你使用进程管理工具部署，例如 pm2、systemd、Docker 或其他平台，请在构建成功后重启对应服务。

更新 Cherry Studio 模型判别代码时，先准备 Cherry Studio 源码，然后运行：

```bash
cd web
npm run sync:cherrystudio-model-config
```

默认情况下，同步脚本会从 `../../cherry-studio/src/renderer/src/config/models` 读取 Cherry Studio 源码。也可以显式传入模型配置目录：

```bash
npm run sync:cherrystudio-model-config -- /path/to/cherry-studio/src/renderer/src/config/models
```

同步后建议检查：

```bash
npm run lint
npm run build
```

## License

This project uses the GNU Affero General Public License v3.0, matching the license used by Cherry Studio. See [LICENSE](./LICENSE).

---

## About This Project

OpenNovelWriter is an experimental novel-writing project built with Next.js, Prisma, and SQLite. It explores Codex-driven novel context management, chapter/scene organization, prompt configuration, AI model groups, and Codex session workflows.

This project uses model-type detection code from [Cherry Studio](https://github.com/CherryHQ/cherry-studio), so it uses the same AGPL-3.0 license as Cherry Studio. Its UI and logic also take inspiration from Novelcrafter, Codex, and [Deng-m1/MaliangAINovalWriter](https://github.com/Deng-m1/MaliangAINovalWriter).

## Requirements

- Node.js 20 or newer
- npm
- Git

## Install Dependencies

```bash
cd web
npm install
```

Before the first run, create or check `web/.env`. You can copy the example file:

```bash
cp .env.example .env
```

For local development, the database path is the only required value. A fuller example:

```bash
DATABASE_URL="file:./dev.db"
# Optional: recommended for production, otherwise the code falls back to a default value
JWT_SECRET="change-this-in-production"
# Optional: if omitted, the app auto-generates and stores one in the local data dir
AI_CREDENTIALS_SECRET="change-this-too"
```

Optional settings:

```bash
NEXT_PUBLIC_ALLOW_REGISTER=true
ALLOW_REGISTER=true
SITE_BASIC_AUTH_ENABLED=false
SITE_BASIC_AUTH_USERNAME=
SITE_BASIC_AUTH_PASSWORD=
OPENNOVELWRITER_DATA_DIR=
```

Initialize the database:

```bash
npx prisma migrate deploy
npx prisma generate
```

During development, if you need to create or adjust migrations, use:

```bash
npx prisma migrate dev
```

## Start the Project

Development mode:

```bash
cd web
npm run dev
```

Default URL:

```text
http://localhost:3000
```

Production build and start:

```bash
cd web
npm run build
npm run start
```

## Update the Project

Update code and dependencies:

```bash
git pull
cd web
npm install
npx prisma migrate deploy
npx prisma generate
npm run build
```

If you deploy with pm2, systemd, Docker, or another process manager, restart the corresponding service after the build succeeds.

To update the Cherry Studio model-detection code, prepare a Cherry Studio source checkout and run:

```bash
cd web
npm run sync:cherrystudio-model-config
```

By default, the sync script reads Cherry Studio source from `../../cherry-studio/src/renderer/src/config/models`. You can also pass the model config directory explicitly:

```bash
npm run sync:cherrystudio-model-config -- /path/to/cherry-studio/src/renderer/src/config/models
```

After syncing, check the project:

```bash
npm run lint
npm run build
```
