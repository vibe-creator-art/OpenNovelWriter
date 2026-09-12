'use client'

export function ImageBrushSize({ value, min, max, label, disabled, onChange }: {
    value: number; min: number; max: number; label: string; disabled: boolean; onChange: (value: number) => void
}) {
    return <div className="onw-image-brush-control relative flex h-44 w-12 items-center justify-center rounded-full border bg-background py-4 shadow-sm" title={`${label}: ${value}`}>
        <div className="onw-image-brush-track pointer-events-none absolute inset-y-4 bg-muted-foreground/35" />
        <input type="range" aria-label={label} min={min} max={max} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} className="onw-image-brush relative h-full w-8 cursor-pointer appearance-none bg-transparent" style={{ writingMode: 'vertical-lr', direction: 'rtl' }} />
        <style>{`
            .onw-image-brush-track{width:2px;clip-path:polygon(0 0,100% 0,100% 100%,0 100%);transition:width 150ms ease,clip-path 150ms ease}
            .onw-image-brush-control:is(:active,:has(input:focus-visible)) .onw-image-brush-track{width:32px;clip-path:polygon(0 0,100% 0,50% 100%,50% 100%)}
            @media(hover:hover){.onw-image-brush-control:hover .onw-image-brush-track{width:32px;clip-path:polygon(0 0,100% 0,50% 100%,50% 100%)}}
            .onw-image-brush::-webkit-slider-runnable-track{background:transparent}
            .onw-image-brush::-webkit-slider-thumb{appearance:none;width:20px;height:20px;border-radius:50%;background:white;border:1px solid #ccc;box-shadow:0 2px 4px #0002}
            .onw-image-brush::-moz-range-track{background:transparent}
            .onw-image-brush::-moz-range-thumb{width:20px;height:20px;border-radius:50%;background:white;border:1px solid #ccc;box-shadow:0 2px 4px #0002}
        `}</style>
    </div>
}
