#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
WEB_DIR="$ROOT_DIR/web"
BUILD_MARKER="$WEB_DIR/.next/.open-novel-writer-build-commit"
DEPENDENCY_MARKER="$WEB_DIR/node_modules/.open-novel-writer-dependency-state"
PORT_VALUE="${PORT:-3000}"

info() {
    printf '\n==> %s\n' "$1"
}

warn() {
    printf '\nWarning: %s\n' "$1" >&2
}

fail() {
    printf '\nError: %s\n' "$1" >&2
    exit 1
}

run_in_web() {
    (
        cd "$WEB_DIR" || exit 1
        "$@"
    )
}

require_node() {
    command -v node >/dev/null 2>&1 || fail 'Node.js 20 or newer is required. Install Node.js, then run this launcher again.'

    local major
    major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
    [[ "$major" =~ ^[0-9]+$ ]] || fail 'Could not determine the installed Node.js version.'
    (( major >= 20 )) || fail "Node.js 20 or newer is required; found Node.js $(node --version)."

    info "Using Node.js $(node --version)"
}

confirm_update() {
    local answer=''
    if [[ ! -t 0 ]]; then
        warn 'No interactive terminal is available, so the update was skipped.'
        return 1
    fi

    read -r -p 'Update now? [y/N] ' answer || true
    case "$answer" in
        y|Y|yes|YES|Yes) return 0 ;;
        *) return 1 ;;
    esac
}

semver_is_older() {
    node - "$1" "$2" <<'NODE'
const [current, latest] = process.argv.slice(2)
const parse = (value) => {
  const match = String(value ?? '').match(/^(\d+)\.(\d+)\.(\d+)/)
  return match ? match.slice(1).map(Number) : null
}
const a = parse(current)
const b = parse(latest)
if (!a || !b) process.exit(2)
for (let i = 0; i < 3; i += 1) {
  if (a[i] < b[i]) process.exit(0)
  if (a[i] > b[i]) process.exit(1)
}
process.exit(1)
NODE
}

detect_codex_npm_prefix() {
    local codex_path="$1"
    node - "$codex_path" <<'NODE'
const fs = require('fs')
const path = require('path')

let commandPath = process.argv[2]
try {
  commandPath = fs.realpathSync(commandPath)
} catch {
  process.exit(0)
}

const marker = `${path.sep}node_modules${path.sep}@openai${path.sep}codex${path.sep}`
const markerIndex = commandPath.indexOf(marker)
if (markerIndex < 0) process.exit(0)

const nodeModulesPath = commandPath.slice(0, markerIndex + `${path.sep}node_modules`.length)
const libNodeModulesSuffix = `${path.sep}lib${path.sep}node_modules`
const nodeModulesSuffix = `${path.sep}node_modules`

if (nodeModulesPath.endsWith(libNodeModulesSuffix)) {
  process.stdout.write(nodeModulesPath.slice(0, -libNodeModulesSuffix.length))
} else if (nodeModulesPath.endsWith(nodeModulesSuffix)) {
  process.stdout.write(nodeModulesPath.slice(0, -nodeModulesSuffix.length))
}
NODE
}

check_codex_cli() {
    if ! command -v codex >/dev/null 2>&1; then
        warn 'Codex CLI was not found. The editor can start, but Codex sessions will be unavailable. Install it with: npm install -g @openai/codex'
        return
    fi

    local current_output current_version latest_version codex_path codex_prefix
    current_output="$(codex --version 2>/dev/null || true)"
    info "Codex CLI detected: ${current_output:-installed}"

    command -v npm >/dev/null 2>&1 || {
        warn 'npm was not found, so the Codex CLI update check was skipped.'
        return
    }

    current_version="$(printf '%s\n' "$current_output" | sed -nE 's/.*([0-9]+\.[0-9]+\.[0-9]+).*/\1/p' | head -n 1)"
    if [[ -z "$current_version" ]]; then
        warn 'Could not determine the installed Codex CLI version; skipping the Codex CLI update check.'
        return
    fi

    latest_version="$(npm view @openai/codex version --silent 2>/dev/null || true)"
    if [[ -z "$latest_version" ]]; then
        warn 'Could not check the latest Codex CLI version. The installed version will be used.'
        return
    fi

    if semver_is_older "$current_version" "$latest_version"; then
        info "Detected Codex CLI update: $current_version -> $latest_version"
        codex_path="$(command -v codex)"
        codex_prefix="$(detect_codex_npm_prefix "$codex_path")"
        if [[ -n "$codex_prefix" ]]; then
            info "Updating Codex CLI with npm prefix: $codex_prefix"
            if ! npm install -g --prefix "$codex_prefix" @openai/codex@latest; then
                warn 'Codex CLI update failed. The installed version will be used.'
                return
            fi
        else
            info 'Updating Codex CLI with npm...'
            if ! npm install -g @openai/codex@latest; then
                warn 'Codex CLI update failed. The installed version will be used.'
                return
            fi
        fi
        hash -r 2>/dev/null || true
        info "Codex CLI updated: $(codex --version 2>/dev/null || printf 'installed')"
    fi
}

require_node
[[ -d "$WEB_DIR" ]] || fail "Missing web directory: $WEB_DIR"
[[ -f "$WEB_DIR/package.json" ]] || fail "Missing package manifest: $WEB_DIR/package.json"

if command -v bun >/dev/null 2>&1 && [[ -f "$WEB_DIR/bun.lock" ]]; then
    PACKAGE_MANAGER='Bun'
    LOCK_FILE="$WEB_DIR/bun.lock"
    INSTALL_COMMAND=(bun install --frozen-lockfile)
    PRISMA_COMMAND=(bunx prisma)
    BUILD_COMMAND=(bun run build)
    START_COMMAND=(bun run start)
    info "Using Bun $(bun --version) because web/bun.lock is present."
else
    command -v npm >/dev/null 2>&1 || fail 'npm is required when Bun with web/bun.lock is unavailable.'
    [[ -f "$WEB_DIR/package-lock.json" ]] || fail "Missing npm lockfile: $WEB_DIR/package-lock.json"
    PACKAGE_MANAGER='npm'
    LOCK_FILE="$WEB_DIR/package-lock.json"
    INSTALL_COMMAND=(npm ci)
    PRISMA_COMMAND=(npx prisma)
    BUILD_COMMAND=(npm run build)
    START_COMMAND=(npm run start)
    info 'Using npm.'
fi

check_codex_cli

GIT_REPOSITORY=0
WORKTREE_DIRTY=0
CURRENT_COMMIT=''
if command -v git >/dev/null 2>&1 && git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    GIT_REPOSITORY=1
    CURRENT_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
    if [[ -n "$(git -C "$ROOT_DIR" status --porcelain --untracked-files=no)" ]]; then
        WORKTREE_DIRTY=1
    fi
    UPSTREAM="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"

    if [[ -z "$UPSTREAM" ]]; then
        warn 'This Git branch has no upstream remote; skipping the update check.'
    elif ! git -C "$ROOT_DIR" fetch --quiet; then
        warn 'Could not check for updates. The local version will be started.'
    elif (( WORKTREE_DIRTY )); then
        warn 'Tracked local code changes were found; skipping automatic update to avoid conflicts.'
    else
        BEHIND="$(git -C "$ROOT_DIR" rev-list --count "HEAD..$UPSTREAM")"
        AHEAD="$(git -C "$ROOT_DIR" rev-list --count "$UPSTREAM..HEAD")"
        if [[ "$BEHIND" =~ ^[0-9]+$ ]] && (( BEHIND > 0 )); then
            LATEST_SUBJECT="$(git -C "$ROOT_DIR" log -1 --format=%s "$UPSTREAM")"
            info "Detected $BEHIND update(s). Latest commit: $LATEST_SUBJECT"
            if [[ "$AHEAD" =~ ^[0-9]+$ ]] && (( AHEAD > 0 )); then
                warn 'Local commits and remote commits have diverged; skipping automatic update.'
            elif confirm_update; then
                info 'Updating project code...'
                if ! git -C "$ROOT_DIR" pull --ff-only; then
                    warn 'Update failed. The local version will be started without changing files.'
                else
                    CURRENT_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
                fi
            else
                info 'Update skipped.'
            fi
        fi
    fi
elif ! command -v git >/dev/null 2>&1; then
    warn 'Git was not found; skipping the update check.'
else
    warn 'This folder is not a Git checkout; skipping the update check.'
fi

DEPENDENCY_STATE="$(node - "$PACKAGE_MANAGER" "$WEB_DIR/package.json" "$LOCK_FILE" <<'NODE'
const crypto = require('crypto')
const fs = require('fs')

const [packageManager, ...files] = process.argv.slice(2)
const hash = crypto.createHash('sha256').update(packageManager)
for (const file of files) {
  hash.update('\0').update(fs.readFileSync(file))
}
process.stdout.write(hash.digest('hex'))
NODE
)" || fail 'Could not determine the dependency state.'

INSTALLED_DEPENDENCY_STATE=''
if [[ -f "$DEPENDENCY_MARKER" ]]; then
    INSTALLED_DEPENDENCY_STATE="$(<"$DEPENDENCY_MARKER")"
fi

NEEDS_SETUP=0
if [[ ! -f "$WEB_DIR/.env" ]]; then
    [[ -f "$WEB_DIR/.env.example" ]] || fail "Missing environment template: $WEB_DIR/.env.example"
    cp "$WEB_DIR/.env.example" "$WEB_DIR/.env"
    info 'Created web/.env from web/.env.example.'
    NEEDS_SETUP=1
fi

if [[ ! -d "$WEB_DIR/node_modules" ]] || [[ "$INSTALLED_DEPENDENCY_STATE" != "$DEPENDENCY_STATE" ]]; then
    NEEDS_SETUP=1
fi

if (( NEEDS_SETUP )); then
    info "Installing dependencies with $PACKAGE_MANAGER..."
    run_in_web "${INSTALL_COMMAND[@]}" || fail 'Dependency installation failed.'

    info 'Applying database migrations...'
    run_in_web "${PRISMA_COMMAND[@]}" migrate deploy || fail 'Database migration failed.'

    info 'Generating Prisma client...'
    run_in_web "${PRISMA_COMMAND[@]}" generate || fail 'Prisma client generation failed.'

    printf '%s\n' "$DEPENDENCY_STATE" > "$DEPENDENCY_MARKER" || fail 'Could not record the installed dependency state.'
fi

NEEDS_BUILD=0
if (( NEEDS_SETUP || WORKTREE_DIRTY )) || [[ ! -f "$WEB_DIR/.next/BUILD_ID" ]]; then
    NEEDS_BUILD=1
elif (( GIT_REPOSITORY )); then
    BUILT_COMMIT=''
    if [[ -f "$BUILD_MARKER" ]]; then
        BUILT_COMMIT="$(<"$BUILD_MARKER")"
    fi
    if [[ "$BUILT_COMMIT" != "$CURRENT_COMMIT" ]]; then
        NEEDS_BUILD=1
    fi
fi

if (( NEEDS_BUILD )); then
    info "Building OpenNovelWriter with $PACKAGE_MANAGER..."
    run_in_web "${BUILD_COMMAND[@]}" || fail 'Build failed.'

    if (( GIT_REPOSITORY )); then
        mkdir -p "$WEB_DIR/.next"
        printf '%s\n' "$CURRENT_COMMIT" > "$BUILD_MARKER"
    fi
fi

info "Starting OpenNovelWriter at http://localhost:$PORT_VALUE"
info 'Press Ctrl+C to stop the server.'
cd "$WEB_DIR" || exit 1
exec "${START_COMMAND[@]}"
