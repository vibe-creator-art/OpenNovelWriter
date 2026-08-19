export const MANUSCRIPT_FLUSH_REQUESTED_EVENT = 'onw:manuscript-flush-requested'

export type ManuscriptFlushRequestedDetail = {
    register: (task: Promise<void>) => void
}

export function requestManuscriptFlush() {
    if (typeof window === 'undefined') return Promise.resolve()

    const tasks: Promise<void>[] = []
    window.dispatchEvent(new CustomEvent<ManuscriptFlushRequestedDetail>(MANUSCRIPT_FLUSH_REQUESTED_EVENT, {
        detail: {
            register: (task) => {
                tasks.push(task)
            },
        },
    }))
    return Promise.all(tasks).then(() => undefined)
}
