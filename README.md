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
- [OpenAI Codex CLI](https://github.com/openai/codex)（Codex 会话功能依赖本机的 `codex` 命令，需安装）

```bash
npm install -g @openai/codex
```

## Windows 注意事项

OpenNovelWriter 会为 Codex 会话创建符号链接（symlink），用于把 `AGENTS.md` 和小说上下文等托管文件投影到 Codex 工作区。在 Windows 上，普通进程默认没有创建符号链接的权限，保存 Codex 连接时可能失败并一直停留在「保存中…」，控制台报错类似：

```text
EPERM: operation not permitted, symlink
```

按以下任意一种方式赋予创建符号链接的权限后，重启 VS Code / 终端 / 开发服务器再试：

- **开启开发者模式（推荐）**：设置 → 隐私和安全性 → 开发者选项 → 打开「开发人员模式」。
- **以管理员身份运行**：用「以管理员身份运行」打开 VS Code、PowerShell 或终端，再启动本项目。

## 一键启动（推荐）

首次安装 Node.js 20 或更新版本后，可以直接使用根目录 launcher；它会检查运行环境、首次安装依赖和数据库、检查 Git 更新，并在检测到更新时显示最新提交名、询问是否更新。已有可用构建时会直接启动，代码更新或没有构建时才会重新构建。

- **Windows**：双击 `launcher.bat`。
- **macOS / Linux**：在项目根目录运行：

```bash
./launcher.sh
```

如果没有安装 Codex CLI，launcher 会提示，但仍会启动编辑器；只有 Codex 会话功能不可用。若 Git 不存在、网络不可用、当前分支没有上游，或存在未提交的本地代码修改，launcher 会跳过自动更新并启动当前本地版本。

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
- [OpenAI Codex CLI](https://github.com/openai/codex) (Codex session features invoke the local `codex` command)

```bash
npm install -g @openai/codex
```

## Windows Notes

OpenNovelWriter creates symlinks to project managed files such as `AGENTS.md` and novel context into the Codex session workspace. On Windows a non-elevated process has no permission to create symlinks by default, so saving a Codex connection can fail and stay stuck on "Saving…", with a console error like:

```text
EPERM: operation not permitted, symlink
```

Grant the permission to create symlinks in either of the following ways, then restart VS Code / your terminal / the dev server and try again:

- **Enable Developer Mode (recommended)**: Settings → Privacy & security → For developers → turn on "Developer Mode".
- **Run as Administrator**: open VS Code, PowerShell, or the terminal via "Run as administrator", then start the project.

## One-Click Launcher (Recommended)

After installing Node.js 20 or newer, use the launcher in the repository root. It checks the runtime, installs dependencies and prepares the database on first run, checks for Git updates, and shows the newest commit message before asking whether to update. It starts an existing current build directly and rebuilds only when the code changed or no build exists.

- **Windows**: double-click `launcher.bat`.
- **macOS / Linux**: from the repository root, run:

```bash
./launcher.sh
```

If the Codex CLI is not installed, the launcher warns but still starts the editor; only Codex session features are unavailable. If Git is missing, the network is unavailable, the current branch has no upstream, or tracked local code changes exist, the launcher skips automatic updates and starts the local version.

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
