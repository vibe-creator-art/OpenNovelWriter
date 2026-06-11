from __future__ import annotations

# 当前用于高级下拉选项区域的配色：
# palettable.colorbrewer.qualitative.Paired_12

import argparse
import importlib
import json
import os
from pathlib import Path
import sys
import tempfile


def prepare_cache_dirs() -> None:
    cache_root = Path(tempfile.gettempdir()) / 'opennovelwriter-palettes'
    matplotlib_dir = cache_root / 'matplotlib'
    xdg_dir = cache_root / 'xdg-cache'
    matplotlib_dir.mkdir(parents=True, exist_ok=True)
    xdg_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault('MPLCONFIGDIR', str(matplotlib_dir))
    os.environ.setdefault('XDG_CACHE_HOME', str(xdg_dir))


def parse_palette_ref(module: str, palette: str | None) -> tuple[str, str]:
    if palette:
        return module, palette
    if '.' not in module:
        raise ValueError('Provide either <module> <palette> or a dotted path ending in the palette name.')
    module_path, _, palette_name = module.rpartition('.')
    if not module_path or not palette_name:
        raise ValueError('Invalid palette reference.')
    return module_path, palette_name


def load_hex_colors(module_path: str, palette_name: str) -> list[str]:
    prepare_cache_dirs()
    module = importlib.import_module(module_path)
    palette = getattr(module, palette_name, None)
    if palette is None:
        raise AttributeError(f'{palette_name!r} was not found in {module_path!r}.')
    hex_colors = getattr(palette, 'hex_colors', None)
    if not isinstance(hex_colors, list) or not hex_colors:
        raise TypeError(f'{module_path}.{palette_name} does not expose a non-empty hex_colors list.')
    return [str(color).upper() for color in hex_colors]


def build_ts_const(const_name: str, colors: list[str]) -> str:
    joined = ',\n'.join(f"    '{color}'" for color in colors)
    return f'export const {const_name} = [\n{joined}\n] as const\n'


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('module', help='Module path or dotted palette path, e.g. palettable.colorbrewer.qualitative.Paired_12')
    parser.add_argument('palette', nargs='?', help='Palette name when module and palette are passed separately')
    parser.add_argument('--format', choices=('json', 'ts'), default='json')
    parser.add_argument('--const-name', default='PALETTE_COLORS')
    args = parser.parse_args()

    module_path, palette_name = parse_palette_ref(args.module, args.palette)
    colors = load_hex_colors(module_path, palette_name)

    if args.format == 'ts':
        sys.stdout.write(build_ts_const(args.const_name, colors))
        return 0

    json.dump(colors, sys.stdout, ensure_ascii=False)
    sys.stdout.write('\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
