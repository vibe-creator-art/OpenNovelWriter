import type { CSSProperties } from 'react'

export type OptionColorPaletteItem = {
    id: string
    label: string
    hex: string
    textHex: string
}

export const OPTION_COLOR_PALETTE: readonly OptionColorPaletteItem[] = [
    { id: 'paired_01', label: 'Paired 01', hex: '#A6CEE3', textHex: '#1F78B4' },
    { id: 'paired_02', label: 'Paired 02', hex: '#1F78B4', textHex: '#1F78B4' },
    { id: 'paired_03', label: 'Paired 03', hex: '#B2DF8A', textHex: '#33A02C' },
    { id: 'paired_04', label: 'Paired 04', hex: '#33A02C', textHex: '#33A02C' },
    { id: 'paired_05', label: 'Paired 05', hex: '#FB9A99', textHex: '#E31A1C' },
    { id: 'paired_06', label: 'Paired 06', hex: '#E31A1C', textHex: '#E31A1C' },
    { id: 'paired_07', label: 'Paired 07', hex: '#FDBF6F', textHex: '#FF7F00' },
    { id: 'paired_08', label: 'Paired 08', hex: '#FF7F00', textHex: '#FF7F00' },
    { id: 'paired_09', label: 'Paired 09', hex: '#CAB2D6', textHex: '#6A3D9A' },
    { id: 'paired_10', label: 'Paired 10', hex: '#6A3D9A', textHex: '#6A3D9A' },
    { id: 'paired_11', label: 'Paired 11', hex: '#FFFF99', textHex: '#B15928' },
    { id: 'paired_12', label: 'Paired 12', hex: '#B15928', textHex: '#B15928' },
] as const

const optionColorPaletteById = new Map<string, OptionColorPaletteItem>()

for (const item of OPTION_COLOR_PALETTE) {
    optionColorPaletteById.set(item.id, item)
}

export function getOptionColorPaletteItem(colorId: string | null | undefined) {
    if (!colorId) return null
    return optionColorPaletteById.get(colorId) ?? null
}

function clampAlpha(alpha: number) {
    if (Number.isNaN(alpha)) return 1
    return Math.max(0, Math.min(1, alpha))
}

function hexToRgb(hex: string) {
    const normalized = hex.trim().replace(/^#/, '')
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null
    const value = Number.parseInt(normalized, 16)
    return {
        r: (value >> 16) & 255,
        g: (value >> 8) & 255,
        b: value & 255,
    }
}

function toRgba(hex: string, alpha: number) {
    const rgb = hexToRgb(hex)
    if (!rgb) return hex
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clampAlpha(alpha)})`
}

export function getOptionColorDotStyle(colorId: string | null | undefined): CSSProperties | undefined {
    const item = getOptionColorPaletteItem(colorId)
    if (!item) return undefined
    return {
        backgroundColor: item.hex,
        borderColor: toRgba(item.textHex, 0.24),
    }
}

export function getOptionColorChipStyle(colorId: string | null | undefined): CSSProperties | undefined {
    const item = getOptionColorPaletteItem(colorId)
    if (!item) return undefined
    return {
        color: item.textHex,
        backgroundColor: toRgba(item.hex, 0.24),
        borderColor: toRgba(item.textHex, 0.34),
    }
}

export function getOptionColorCardStyle(
    colorId: string | null | undefined,
    options?: { selected?: boolean }
): CSSProperties | undefined {
    const item = getOptionColorPaletteItem(colorId)
    if (!item) return undefined
    const selected = options?.selected ?? false
    return {
        backgroundColor: toRgba(item.hex, selected ? 0.22 : 0.12),
        borderColor: toRgba(item.textHex, selected ? 0.5 : 0.28),
    }
}
