#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate app icons (180/192) with a pure-Python PNG writer (no PIL needed).
Draws a white camera glyph on a slate background."""
import os, struct, zlib, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."

BG = (0x7A, 0x84, 0x8D)
FG = (0xFF, 0xFF, 0xFF)


def write_png(path, w, h, get):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            r, g, b = get(x, y)
            raw += bytes((r, g, b))

    def chunk(t, d):
        return (struct.pack(">I", len(d)) + t + d +
                struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF))

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    data = (sig + chunk(b"IHDR", ihdr) +
            chunk(b"IDAT", zlib.compress(bytes(raw), 9)) +
            chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(data)


def in_rrect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    dx = x - cx
    dy = y - cy
    return dx * dx + dy * dy <= r * r


def in_circle(x, y, cx, cy, r):
    dx = x - cx
    dy = y - cy
    return dx * dx + dy * dy <= r * r


def make(size, path):
    W = H = float(size)

    def get(x, y):
        fx = x + 0.5
        fy = y + 0.5
        # camera body
        if in_rrect(fx, fy, 0.16 * W, 0.34 * H, 0.84 * W, 0.80 * H, 0.10 * W):
            # lens cut-out
            if in_circle(fx, fy, 0.50 * W, 0.57 * H, 0.175 * W):
                if in_circle(fx, fy, 0.50 * W, 0.57 * H, 0.105 * W):
                    return FG
                return BG
            # small indicator dot
            if in_circle(fx, fy, 0.735 * W, 0.425 * H, 0.032 * W):
                return BG
            return FG
        # viewfinder bump
        if in_rrect(fx, fy, 0.36 * W, 0.235 * H, 0.64 * W, 0.38 * H, 0.05 * W):
            return FG
        return BG

    write_png(path, size, size, get)
    print("wrote", path)


os.makedirs(os.path.join(ROOT, "assets"), exist_ok=True)
make(180, os.path.join(ROOT, "assets", "icon-180.png"))
make(192, os.path.join(ROOT, "assets", "icon-192.png"))
print("ICONS OK")
