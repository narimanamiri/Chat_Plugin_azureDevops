"""Generate the extension's PNG icons without any third-party dependency.

Marketplace and the hub navigation both want real PNG files, and pulling in
Pillow just to draw a speech bubble is not worth it. This writes the PNG byte
stream directly: signature, IHDR, one zlib-compressed IDAT, IEND.

Run:  python scripts/make_icons.py
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "static"

ACCENT = (0x1F, 0x27, 0x33, 255)   # dark slate, matches manifest branding
GLYPH = (0xFF, 0xFF, 0xFF, 255)
TRANSPARENT = (0, 0, 0, 0)


def write_png(path: Path, pixels: list[list[tuple[int, int, int, int]]]) -> None:
    height = len(pixels)
    width = len(pixels[0])

    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filter type 0 (None) for every scanline
        for r, g, b, a in row:
            raw += bytes((r, g, b, a))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)
    print(f"{path.name}: {width}x{height}, {len(png)} bytes")


def blank(size: int, colour=TRANSPARENT) -> list[list[tuple[int, int, int, int]]]:
    return [[colour for _ in range(size)] for _ in range(size)]


def rounded_rect(px, x0, y0, x1, y1, radius, colour):
    for y in range(int(y0), int(y1)):
        for x in range(int(x0), int(x1)):
            dx = min(x - x0, x1 - 1 - x)
            dy = min(y - y0, y1 - 1 - y)
            if dx < radius and dy < radius:
                if math.hypot(radius - dx, radius - dy) > radius:
                    continue
            px[y][x] = colour


def triangle(px, points, colour):
    (ax, ay), (bx, by), (cx, cy) = points

    def sign(x1, y1, x2, y2, x3, y3):
        return (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3)

    xs = [ax, bx, cx]
    ys = [ay, by, cy]
    for y in range(int(min(ys)), int(max(ys)) + 1):
        for x in range(int(min(xs)), int(max(xs)) + 1):
            d1 = sign(x, y, ax, ay, bx, by)
            d2 = sign(x, y, bx, by, cx, cy)
            d3 = sign(x, y, cx, cy, ax, ay)
            has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
            has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
            if not (has_neg and has_pos):
                px[y][x] = colour


def ring(px, cx, cy, outer, inner, colour, only_top=False):
    for y in range(int(cy - outer), int(cy + outer) + 1):
        for x in range(int(cx - outer), int(cx + outer) + 1):
            if only_top and y > cy:
                continue
            d = math.hypot(x - cx, y - cy)
            if inner <= d <= outer:
                px[y][x] = colour


def speech_bubble_with_lock(size: int):
    """A chat bubble with a padlock cut into it."""
    s = size / 128.0
    px = blank(size)

    # bubble body
    rounded_rect(px, 10 * s, 14 * s, 118 * s, 96 * s, 18 * s, ACCENT)
    # tail
    triangle(px, [(34 * s, 94 * s), (34 * s, 120 * s), (64 * s, 94 * s)], ACCENT)

    # padlock shackle
    ring(px, 64 * s, 52 * s, 18 * s, 12 * s, GLYPH, only_top=True)
    # padlock body
    rounded_rect(px, 44 * s, 50 * s, 84 * s, 82 * s, 6 * s, GLYPH)
    # keyhole
    ring(px, 64 * s, 62 * s, 6 * s, 0, ACCENT)
    rounded_rect(px, 62 * s, 62 * s, 66 * s, 74 * s, 1 * s, ACCENT)

    return px


def bell(size: int):
    """A bell for the dashboard widget catalogue entry."""
    s = size / 128.0
    px = blank(size)
    rounded_rect(px, 8 * s, 8 * s, 120 * s, 120 * s, 20 * s, ACCENT)
    # bell dome
    ring(px, 64 * s, 74 * s, 34 * s, 0, GLYPH, only_top=True)
    rounded_rect(px, 30 * s, 70 * s, 98 * s, 82 * s, 4 * s, GLYPH)
    # clapper
    ring(px, 64 * s, 88 * s, 8 * s, 0, GLYPH)
    # handle
    rounded_rect(px, 60 * s, 30 * s, 68 * s, 42 * s, 3 * s, GLYPH)
    return px


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    write_png(OUT / "logo.png", speech_bubble_with_lock(128))
    write_png(OUT / "nav-icon.png", speech_bubble_with_lock(32))
    write_png(OUT / "widget-icon.png", bell(64))


if __name__ == "__main__":
    main()
