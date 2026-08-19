const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g

export function sanitizeFilename(name: string, fallback = 'export') {
    const cleaned = name
        .replace(ILLEGAL_FILENAME_CHARS, '_')
        .replace(/[. ]+$/g, '')
        .trim()
    const sliced = cleaned.slice(0, 120)
    return sliced || fallback
}

export function buildExportFilename(title: string, format: 'txt' | 'docx') {
    return `${sanitizeFilename(title)}.${format}`
}

export function buildContentDisposition(filename: string) {
    const ascii = filename.replace(/[^\x20-\x7E]/g, '_')
    return `attachment; filename="${ascii.replace(/"/g, '\\"')}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export function parseContentDispositionFilename(header: string | null | undefined) {
    if (!header) return null

    const star = header.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i)
    if (star?.[1]) {
        try {
            return decodeURIComponent(star[1].trim().replace(/^"+|"+$/g, ''))
        } catch {
            // fall through
        }
    }

    const quoted = header.match(/filename\s*=\s*"((?:\\.|[^"])*)"/i)
    if (quoted?.[1]) return quoted[1].replace(/\\"/g, '"')

    const bare = header.match(/filename\s*=\s*([^;]+)/i)
    return bare?.[1]?.trim() ?? null
}
