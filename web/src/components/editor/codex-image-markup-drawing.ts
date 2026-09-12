export type MarkupPoint = { x: number; y: number }
export type MarkupShape = 'line' | 'arrow' | 'rectangle' | 'ellipse' | 'triangle' | 'diamond' | 'star' | 'heart'
export type MarkupItem = {
    id: string
    kind: 'pen' | 'eraser' | 'text' | MarkupShape
    x: number; y: number; width: number; height: number
    color: string; weight: number
    points?: MarkupPoint[]
    text?: string
    fontSize?: number
    reverseX?: boolean
    reverseY?: boolean
}

export function markupBounds(start: MarkupPoint, end: MarkupPoint) {
    return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.max(1, Math.abs(end.x - start.x)), height: Math.max(1, Math.abs(end.y - start.y)) }
}

export function drawMarkup(context: CanvasRenderingContext2D, items: MarkupItem[]) {
    for (const item of items) {
        context.save()
        context.strokeStyle = context.fillStyle = item.color
        context.lineWidth = item.weight
        context.lineCap = context.lineJoin = 'round'
        const { x, y, width: w, height: h } = item
        context.beginPath()
        if (item.kind === 'pen' || item.kind === 'eraser') {
            if (item.kind === 'eraser') context.globalCompositeOperation = 'destination-out'
            const points = item.points ?? []
            points.forEach((point, index) => {
                if (index === 0) context.moveTo(x + point.x * w, y + point.y * h)
                else context.lineTo(x + point.x * w, y + point.y * h)
            })
            if (points.length === 1) {
                context.arc(x + points[0].x * w, y + points[0].y * h, item.weight / 2, 0, Math.PI * 2)
                context.fill()
            } else context.stroke()
        } else if (item.kind === 'text') {
            const fontSize = item.fontSize ?? 32
            context.font = `${fontSize}px sans-serif`
            context.textBaseline = 'top'
            let lineIndex = 0
            for (const paragraph of (item.text ?? '').split('\n')) {
                let line = ''
                for (const character of paragraph) {
                    if (line && context.measureText(line + character).width > w) {
                        context.fillText(line, x, y + lineIndex++ * fontSize * 1.2)
                        line = ''
                    }
                    line += character
                }
                context.fillText(line, x, y + lineIndex++ * fontSize * 1.2)
            }
        } else if (item.kind === 'line' || item.kind === 'arrow') {
            const start = { x: x + (item.reverseX ? w : 0), y: y + (item.reverseY ? h : 0) }
            const end = { x: x + (item.reverseX ? 0 : w), y: y + (item.reverseY ? 0 : h) }
            context.moveTo(start.x, start.y); context.lineTo(end.x, end.y)
            if (item.kind === 'arrow') {
                const angle = Math.atan2(end.y - start.y, end.x - start.x)
                const size = Math.max(item.weight * 4, Math.min(24, Math.hypot(w, h) / 3))
                for (const offset of [-Math.PI / 6, Math.PI / 6]) {
                    context.moveTo(end.x - size * Math.cos(angle + offset), end.y - size * Math.sin(angle + offset))
                    context.lineTo(end.x, end.y)
                }
            }
            context.stroke()
        } else {
            if (item.kind === 'rectangle') context.rect(x, y, w, h)
            if (item.kind === 'ellipse') context.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
            const vertices = item.kind === 'triangle' ? [[.5, 0], [1, 1], [0, 1]]
                : item.kind === 'diamond' ? [[.5, 0], [1, .5], [.5, 1], [0, .5]]
                    : item.kind === 'star' ? Array.from({ length: 10 }, (_, index) => {
                        const angle = -Math.PI / 2 + index * Math.PI / 5
                        const radius = index % 2 ? .2 : .5
                        return [.5 + Math.cos(angle) * radius, .5 + Math.sin(angle) * radius]
                    }) : []
            vertices.forEach(([vx, vy], index) => index ? context.lineTo(x + vx * w, y + vy * h) : context.moveTo(x + vx * w, y + vy * h))
            if (item.kind === 'heart') {
                context.moveTo(x + w / 2, y + h)
                context.bezierCurveTo(x - w * .3, y + h * .45, x, y - h * .3, x + w / 2, y + h * .2)
                context.bezierCurveTo(x + w, y - h * .3, x + w * 1.3, y + h * .45, x + w / 2, y + h)
            }
            context.closePath(); context.stroke()
        }
        context.restore()
    }
}
