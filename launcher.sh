#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
WEB_DIR="$ROOT_DIR/web"
BUILD_MARKER="$WEB_DIR/.next/.open-novel-writer-build-commit"
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

require_node
[[ -d "$WEB_DIR" ]] || fail "Missing web directory: $WEB_DIR"
[[ -f "$WEB_DIR/package.json" ]] || fail "Missing package manifest: $WEB_DIR/package.json"

if command -v bun >/dev/null 2>&1 && [[ -f "$WEB_DIR/bun.lock" ]]; then
    PACKAGE_MANAGER='Bun'
    INSTALL_COMMAND=(bun install --frozen-lockfile)
    PRISMA_COMMAND=(bunx prisma)
    BUILD_COMMAND=(bun run build)
    START_COMMAND=(bun run start)
    info "Using Bun $(bun --version) because web/bun.lock is present."
else
    command -v npm >/dev/null 2>&1 || fail 'npm is required when Bun with web/bun.lock is unavailable.'
    [[ -f "$WEB_DIR/package-lock.json" ]] || fail "Missing npm lockfile: $WEB_DIR/package-lock.json"
    PACKAGE_MANAGER='npm'
    INSTALL_COMMAND=(npm ci)
    PRISMA_COMMAND=(npx prisma)
    BUILD_COMMAND=(npm run build)
    START_COMMAND=(npm run start)
    info 'Using npm.'
fi

if command -v codex >/dev/null 2>&1; then
    info "Codex CLI detected: $(codex --version 2>/dev/null || printf 'installed')"
else
    warn 'Codex CLI was not found. The editor can start, but Codex sessions will be unavailable. Install it with: npm install -g @openai/codex'
fi

GIT_REPOSITORY=0
UPDATED=0
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
                    UPDATED=1
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

NEEDS_SETUP=0
if [[ ! -f "$WEB_DIR/.env" ]]; then
    [[ -f "$WEB_DIR/.env.example" ]] || fail "Missing environment template: $WEB_DIR/.env.example"
    cp "$WEB_DIR/.env.example" "$WEB_DIR/.env"
    info 'Created web/.env from web/.env.example.'
    NEEDS_SETUP=1
fi

if [[ ! -d "$WEB_DIR/node_modules" ]] || (( UPDATED )); then
    NEEDS_SETUP=1
fi

if (( NEEDS_SETUP )); then
    info "Installing dependencies with $PACKAGE_MANAGER..."
    run_in_web "${INSTALL_COMMAND[@]}" || fail 'Dependency installation failed.'

    info 'Applying database migrations...'
    run_in_web "${PRISMA_COMMAND[@]}" migrate deploy || fail 'Database migration failed.'

    info 'Generating Prisma client...'
    run_in_web "${PRISMA_COMMAND[@]}" generate || fail 'Prisma client generation failed.'
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
