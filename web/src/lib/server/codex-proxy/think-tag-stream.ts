type TextPart = { kind: 'reasoning' | 'text'; text: string }

export class ThinkTagStream {
    private mode: 'prefix' | 'reasoning' | 'text' = 'prefix'
    private buffer = ''

    push(text: string): TextPart[] {
        this.buffer += text
        const parts: TextPart[] = []
        if (this.mode === 'prefix') {
            const prefix = this.buffer.trimStart().toLowerCase()
            if (prefix.length < 7 && '<think>'.startsWith(prefix)) return parts
            if (prefix.startsWith('<think>')) {
                this.buffer = this.buffer.trimStart().slice(7)
                this.mode = 'reasoning'
            } else {
                this.mode = 'text'
            }
        }
        if (this.mode === 'reasoning') {
            const close = this.buffer.toLowerCase().indexOf('</think>')
            if (close >= 0) {
                if (close > 0) parts.push({ kind: 'reasoning', text: this.buffer.slice(0, close) })
                this.buffer = this.buffer.slice(close + 8)
                this.mode = 'text'
            } else {
                let pending = 0
                for (let size = 1; size < 8 && size <= this.buffer.length; size += 1) {
                    if ('</think>'.startsWith(this.buffer.slice(-size).toLowerCase())) pending = size
                }
                const ready = this.buffer.slice(0, this.buffer.length - pending)
                this.buffer = this.buffer.slice(this.buffer.length - pending)
                if (ready) parts.push({ kind: 'reasoning', text: ready })
                return parts
            }
        }
        if (this.buffer) parts.push({ kind: 'text', text: this.buffer })
        this.buffer = ''
        return parts
    }

    finish(): TextPart[] {
        const text = this.buffer
        this.buffer = ''
        return text ? [{ kind: this.mode === 'reasoning' ? 'reasoning' : 'text', text }] : []
    }
}
