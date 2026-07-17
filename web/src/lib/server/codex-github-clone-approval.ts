import path from 'path'

const SAFE_CLONE_TOKENS = ['git', 'clone', '--depth', '1', '--single-branch', '--no-tags'] as const
const SAFE_DESTINATION_PATTERN = /^artifacts\/skill-imports\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/u
const SHELL_META_PATTERN = /[\r\n"'`$\\;&|<>(){}\[\]*?!]/u

export function isSafeGitHubCloneApprovalRequest(input: {
    command: unknown
    cwd: unknown
    sessionWorkspacePath: string
}) {
    if (typeof input.command !== 'string') return false
    const command = unwrapSupportedShellCommand(input.command.trim())
    if (!command || SHELL_META_PATTERN.test(command)) return false

    const tokens = command.split(/\s+/u)
    if (tokens.length !== SAFE_CLONE_TOKENS.length + 2) return false
    if (!SAFE_CLONE_TOKENS.every((token, index) => tokens[index] === token)) return false

    const repositoryUrl = tokens[SAFE_CLONE_TOKENS.length]
    const destination = tokens[SAFE_CLONE_TOKENS.length + 1]
    if (!isPublicGitHubRepositoryUrl(repositoryUrl) || !SAFE_DESTINATION_PATTERN.test(destination)) {
        return false
    }

    const workspacePath = path.resolve(input.sessionWorkspacePath)
    if (typeof input.cwd === 'string' && input.cwd.trim() && path.resolve(input.cwd) !== workspacePath) {
        return false
    }

    const importsRoot = path.join(workspacePath, 'artifacts', 'skill-imports')
    const destinationPath = path.resolve(workspacePath, ...destination.split('/'))
    const relativeDestination = path.relative(importsRoot, destinationPath)
    return Boolean(relativeDestination) && !relativeDestination.startsWith('..') && !path.isAbsolute(relativeDestination)
}

function unwrapSupportedShellCommand(command: string) {
    const match = command.match(/^\/bin\/(?:zsh|bash|sh) -lc '([^'\r\n]*)'$/u)
    return match?.[1] ?? command
}

function isPublicGitHubRepositoryUrl(value: string) {
    let url: URL
    try {
        url = new URL(value)
    } catch {
        return false
    }

    if (
        url.protocol !== 'https:' ||
        url.hostname.toLowerCase() !== 'github.com' ||
        url.port ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
    ) {
        return false
    }

    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.length !== 2) return false
    const owner = segments[0]
    const repository = segments[1].endsWith('.git') ? segments[1].slice(0, -4) : segments[1]
    return (
        GITHUB_OWNER_PATTERN.test(owner) &&
        GITHUB_REPOSITORY_PATTERN.test(repository) &&
        repository !== '.' &&
        repository !== '..'
    )
}
