@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT_DIR=%~dp0"
pushd "%ROOT_DIR%" >nul 2>&1
if errorlevel 1 (
    echo.
    echo Error: Could not open the project directory.
    pause
    exit /b 1
)
set "ROOT_DIR=%CD%"
set "WEB_DIR=%ROOT_DIR%\web"
set "BUILD_MARKER=%WEB_DIR%\.next\.open-novel-writer-build-commit"
if not defined PORT set "PORT=3000"

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo Error: Node.js 20 or newer is required. Install Node.js, then run this launcher again.
    goto :fail
)
for /f "tokens=1 delims=." %%A in ('node -p "process.versions.node" 2^>nul') do set "NODE_MAJOR=%%A"
if not defined NODE_MAJOR (
    echo.
    echo Error: Could not determine the installed Node.js version.
    goto :fail
)
if !NODE_MAJOR! LSS 20 (
    echo.
    echo Error: Node.js 20 or newer is required.
    node --version
    goto :fail
)
echo.
echo ==^> Using Node.js
echo    Version: 
node --version

if not exist "%WEB_DIR%\package.json" (
    echo.
    echo Error: Missing package manifest: %WEB_DIR%\package.json
    goto :fail
)

set "PACKAGE_MANAGER=npm"
set "INSTALL_COMMAND=npm ci"
set "PRISMA_COMMAND=npx prisma"
set "BUILD_COMMAND=npm run build"
set "START_COMMAND=npm run start"

set "USE_BUN=0"
where bun >nul 2>nul
if not errorlevel 1 if exist "%WEB_DIR%\bun.lock" set "USE_BUN=1"

if "!USE_BUN!"=="1" (
    set "PACKAGE_MANAGER=Bun"
    set "INSTALL_COMMAND=bun install --frozen-lockfile"
    set "PRISMA_COMMAND=bunx prisma"
    set "BUILD_COMMAND=bun run build"
    set "START_COMMAND=bun run start"
    echo.
    echo ==^> Using Bun because web\bun.lock is present.
    bun --version
) else (
    where npm >nul 2>nul
    if errorlevel 1 (
        echo.
        echo Error: npm is required when Bun with web\bun.lock is unavailable.
        goto :fail
    )
    if not exist "%WEB_DIR%\package-lock.json" (
        echo.
        echo Error: Missing npm lockfile: %WEB_DIR%\package-lock.json
        goto :fail
    )
    echo.
    echo ==^> Using npm.
)

call :check_codex_cli

set "GIT_REPOSITORY=0"
set "UPDATED=0"
set "WORKTREE_DIRTY=0"
set "CURRENT_COMMIT="
where git >nul 2>nul
if not errorlevel 1 (
    git -C "%ROOT_DIR%" rev-parse --is-inside-work-tree >nul 2>nul
    if not errorlevel 1 set "GIT_REPOSITORY=1"
)

if "!GIT_REPOSITORY!"=="1" (
    for /f "delims=" %%A in ('git -C "%ROOT_DIR%" rev-parse HEAD 2^>nul') do set "CURRENT_COMMIT=%%A"
    for /f "delims=" %%A in ('git -C "%ROOT_DIR%" status --porcelain --untracked-files^=no') do set "WORKTREE_DIRTY=1"
    for /f "delims=" %%A in ('git -C "%ROOT_DIR%" rev-parse --abbrev-ref --symbolic-full-name "@{upstream}" 2^>nul') do set "UPSTREAM=%%A"
    if not defined UPSTREAM (
        echo.
        echo Warning: This Git branch has no upstream remote; skipping the update check.
    ) else (
        git -C "%ROOT_DIR%" fetch --quiet
        if errorlevel 1 (
            echo.
            echo Warning: Could not check for updates. The local version will be started.
        ) else (
            if "!WORKTREE_DIRTY!"=="1" (
                echo.
                echo Warning: Tracked local code changes were found; skipping automatic update to avoid conflicts.
            ) else (
                set "BEHIND=0"
                set "AHEAD=0"
                for /f "delims=" %%A in ('git -C "%ROOT_DIR%" rev-list --count HEAD..!UPSTREAM!') do set "BEHIND=%%A"
                for /f "delims=" %%A in ('git -C "%ROOT_DIR%" rev-list --count !UPSTREAM!..HEAD') do set "AHEAD=%%A"
                if !BEHIND! GTR 0 (
                    set "LATEST_SUBJECT="
                    for /f "delims=" %%A in ('git -C "%ROOT_DIR%" log -1 --format^=%%s !UPSTREAM!') do set "LATEST_SUBJECT=%%A"
                    echo.
                    echo ==^> Detected !BEHIND! update^(s^). Latest commit: !LATEST_SUBJECT!
                    if !AHEAD! GTR 0 (
                        echo Warning: Local commits and remote commits have diverged; skipping automatic update.
                    ) else (
                        set "ANSWER="
                        set /p "ANSWER=Update now? [y/N] "
                        if /I "!ANSWER!"=="Y" goto :update
                        if /I "!ANSWER!"=="YES" goto :update
                        echo Update skipped.
                    )
                )
            )
        )
    )
) else (
    where git >nul 2>nul
    if errorlevel 1 (
        echo.
        echo Warning: Git was not found; skipping the update check.
    ) else (
        echo.
        echo Warning: This folder is not a Git checkout; skipping the update check.
    )
)
goto :after_update

:update
echo.
echo ==^> Updating project code...
git -C "%ROOT_DIR%" pull --ff-only
if errorlevel 1 (
    echo Warning: Update failed. The local version will be started without changing files.
) else (
    set "UPDATED=1"
    for /f "delims=" %%A in ('git -C "%ROOT_DIR%" rev-parse HEAD 2^>nul') do set "CURRENT_COMMIT=%%A"
)

:after_update
set "NEEDS_SETUP=0"
if not exist "%WEB_DIR%\.env" (
    if not exist "%WEB_DIR%\.env.example" (
        echo.
        echo Error: Missing environment template: %WEB_DIR%\.env.example
        goto :fail
    )
    copy /Y "%WEB_DIR%\.env.example" "%WEB_DIR%\.env" >nul
    if errorlevel 1 (
        echo.
        echo Error: Could not create web\.env.
        goto :fail
    )
    echo.
    echo ==^> Created web\.env from web\.env.example.
    set "NEEDS_SETUP=1"
)
if not exist "%WEB_DIR%\node_modules" set "NEEDS_SETUP=1"
if "!UPDATED!"=="1" set "NEEDS_SETUP=1"

cd /d "%WEB_DIR%" || goto :fail
if "!NEEDS_SETUP!"=="1" (
    echo.
    echo ==^> Installing dependencies with !PACKAGE_MANAGER!...
    call !INSTALL_COMMAND!
    if errorlevel 1 (
        echo Error: Dependency installation failed.
        goto :fail
    )

    echo.
    echo ==^> Applying database migrations...
    call !PRISMA_COMMAND! migrate deploy
    if errorlevel 1 (
        echo Error: Database migration failed.
        goto :fail
    )

    echo.
    echo ==^> Generating Prisma client...
    call !PRISMA_COMMAND! generate
    if errorlevel 1 (
        echo Error: Prisma client generation failed.
        goto :fail
    )
)

set "NEEDS_BUILD=0"
if "!NEEDS_SETUP!"=="1" set "NEEDS_BUILD=1"
if "!WORKTREE_DIRTY!"=="1" set "NEEDS_BUILD=1"
if not exist "%WEB_DIR%\.next\BUILD_ID" set "NEEDS_BUILD=1"
if "!GIT_REPOSITORY!"=="1" (
    set "BUILT_COMMIT="
    if exist "%BUILD_MARKER%" set /p "BUILT_COMMIT="<"%BUILD_MARKER%"
    if not "!BUILT_COMMIT!"=="!CURRENT_COMMIT!" set "NEEDS_BUILD=1"
)

if "!NEEDS_BUILD!"=="1" (
    echo.
    echo ==^> Building OpenNovelWriter with !PACKAGE_MANAGER!...
    call !BUILD_COMMAND!
    if errorlevel 1 (
        echo Error: Build failed.
        goto :fail
    )

    if "!GIT_REPOSITORY!"=="1" (
        if not exist "%WEB_DIR%\.next" mkdir "%WEB_DIR%\.next"
        >"%BUILD_MARKER%" echo !CURRENT_COMMIT!
    )
)

echo.
echo ==^> Starting OpenNovelWriter at http://localhost:!PORT!
echo Press Ctrl+C to stop the server.
call !START_COMMAND!
set "EXIT_CODE=!ERRORLEVEL!"
if not "!EXIT_CODE!"=="0" (
    echo.
    echo Error: Server exited with code !EXIT_CODE!.
    goto :fail
)
popd >nul 2>&1
endlocal & exit /b %EXIT_CODE%

:check_codex_cli
where codex >nul 2>nul
if errorlevel 1 (
    echo.
    echo Warning: Codex CLI was not found. The editor can start, but Codex sessions will be unavailable.
    echo Install it with: npm install -g @openai/codex
    exit /b 0
)

set "CODEX_CURRENT_OUTPUT="
for /f "delims=" %%A in ('codex --version 2^>nul') do if not defined CODEX_CURRENT_OUTPUT set "CODEX_CURRENT_OUTPUT=%%A"
if not defined CODEX_CURRENT_OUTPUT set "CODEX_CURRENT_OUTPUT=installed"
echo.
echo ==^> Codex CLI detected: !CODEX_CURRENT_OUTPUT!

where npm >nul 2>nul
if errorlevel 1 (
    echo Warning: npm was not found, so the Codex CLI update check was skipped.
    exit /b 0
)

set "CODEX_CURRENT_VERSION="
for /f "delims=" %%A in ('node -e "const s=process.argv.slice(1).join(' '); const m=s.match(/\d+\.\d+\.\d+/); if (m) console.log(m[0])" "!CODEX_CURRENT_OUTPUT!"') do set "CODEX_CURRENT_VERSION=%%A"
if not defined CODEX_CURRENT_VERSION (
    echo Warning: Could not determine the installed Codex CLI version; skipping the Codex CLI update check.
    exit /b 0
)

set "CODEX_LATEST_VERSION="
for /f "delims=" %%A in ('npm view @openai/codex version --silent 2^>nul') do if not defined CODEX_LATEST_VERSION set "CODEX_LATEST_VERSION=%%A"
if not defined CODEX_LATEST_VERSION (
    echo Warning: Could not check the latest Codex CLI version. The installed version will be used.
    exit /b 0
)

set "CODEX_UPDATE_NEEDED=0"
for /f "delims=" %%A in ('node -e "const c=process.argv[1], l=process.argv[2]; function p(v){const m=String(v).match(/^(\d+)\.(\d+)\.(\d+)/); return m ? [+m[1], +m[2], +m[3]] : null} const a=p(c), b=p(l); let older=0; if (a && b) { for (let i=0; i<3; i+=1) { if (a[i]<b[i]) { older=1; break } if (a[i]>b[i]) break } } console.log(older)" "!CODEX_CURRENT_VERSION!" "!CODEX_LATEST_VERSION!"') do set "CODEX_UPDATE_NEEDED=%%A"

if "!CODEX_UPDATE_NEEDED!"=="1" (
    echo.
    echo ==^> Detected Codex CLI update: !CODEX_CURRENT_VERSION! -^> !CODEX_LATEST_VERSION!
    echo ==^> Updating Codex CLI with npm...
    call npm install -g @openai/codex@latest
    if errorlevel 1 (
        echo Warning: Codex CLI update failed. The installed version will be used.
        exit /b 0
    )

    set "CODEX_UPDATED_OUTPUT="
    for /f "delims=" %%A in ('codex --version 2^>nul') do if not defined CODEX_UPDATED_OUTPUT set "CODEX_UPDATED_OUTPUT=%%A"
    if not defined CODEX_UPDATED_OUTPUT set "CODEX_UPDATED_OUTPUT=installed"
    echo ==^> Codex CLI updated: !CODEX_UPDATED_OUTPUT!
) else (
    echo ==^> Codex CLI is up to date: !CODEX_CURRENT_VERSION!
)
exit /b 0

:fail
echo.
echo Launcher stopped.
popd >nul 2>&1
pause
endlocal & exit /b 1
