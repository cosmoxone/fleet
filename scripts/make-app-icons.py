#!/usr/bin/env python3
"""Generate the full desktop icon set from a single square-ish source PNG.

Outputs (default to app/src/images/, matching forge.config.ts references):
  icon.icns                     macOS   (16-1024, all modern icns entries)
  icon.ico                      Windows (16-256 multi-size)
  icon.png                      1024    (deb/rpm)
  icon@2x.png                   2048
  icon-512.png                  512     (flatpak 512x512)
  icon-light.png                512     light grayscale variant (dark docks)
  icon-light.icns               light grayscale variant, full icns build
  icon.svg                      PNG-embedded SVG (flatpak scalable)
  glyph.svg                     fully transparent 600x600 (empty; use
                                --glyph-silhouette for a #101010 cutout)
  iconTemplate.png / @2x        22/44   colored knockout mark (macOS/Linux/Win tray)
  iconTemplateUpdate.png / @2x  same + amber badge dot (update available)
  loading-goose/1..7.svg        7-frame bob/tilt animation, 45x39 like upstream

The background of the source art is knocked out via border flood-fill over
light, low-saturation pixels; everything except the opaque square app icons
uses that transparent cutout. Requires only Pillow (no ImageMagick/iconutil).
"""

from __future__ import annotations

import argparse
import base64
import io
import math
import struct
import sys
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

REPO_ROOT = Path(__file__).resolve().parents[1]

# (pixel size, icns chunk type); PNG payload for every entry, ordered like
# iconutil output (upstream goose icns), minus legacy ic04/ic05/info blocks
ICNS_ENTRIES = [
    (64, "ic12"),
    (128, "ic07"),
    (256, "ic13"),  # 128@2x
    (256, "ic08"),
    (512, "ic14"),  # 256@2x
    (512, "ic09"),
    (1024, "ic10"),  # 512@2x
    (32, "ic11"),  # 16@2x
]

# (size, encoding): 256px as PNG (Vista+ convention), smaller as BMP like upstream
ICO_SIZES = [(256, "PNG"), (128, "BMP"), (64, "BMP"), (48, "BMP"), (32, "BMP"), (16, "BMP")]

LOADING_FRAMES = 7
LOADING_CANVAS = (45, 39)
LOADING_MARK = 36

# light-variant grayscale remap, fitted to upstream goose icon-light (mid-gray
# artwork on a light tile, no chroma): L_out = 140..235
LIGHT_LO, LIGHT_HI = 140, 235


def to_square(im: Image.Image, fit: str) -> Image.Image:
    w, h = im.size
    if w == h:
        return im
    if fit == "cover":
        s = min(w, h)
        left, top = (w - s) // 2, (h - s) // 2
        return im.crop((left, top, left + s, top + s))
    s = max(w, h)
    canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    canvas.paste(im, ((s - w) // 2, (s - h) // 2))
    return canvas


def knockout_background(im: Image.Image) -> Image.Image:
    """Flood-fill light low-saturation pixels connected to the border -> alpha 0."""
    w, h = im.size
    r, g, b = (c.tobytes() for c in im.split()[:3])
    n = w * h

    border = []
    for x in range(0, w, max(1, w // 512)):
        border += [x, (h - 1) * w + x]
    for y in range(0, h, max(1, h // 512)):
        border += [y * w, y * w + w - 1]
    border_lumas = sorted((299 * r[i] + 587 * g[i] + 114 * b[i]) // 1000 for i in border)
    # 5th percentile keeps gradient corners (darkest bg) inside the tolerance
    luma_min = border_lumas[len(border_lumas) // 20] - 20

    bg = bytearray(n)
    for i in range(n):
        ri, gi, bi = r[i], g[i], b[i]
        if (299 * ri + 587 * gi + 114 * bi) // 1000 >= luma_min and (
            max(ri, gi, bi) - min(ri, gi, bi)
        ) <= 30:
            bg[i] = 1

    seen = bytearray(n)
    queue = deque(i for i in border if bg[i])
    while queue:
        i = queue.popleft()
        if seen[i]:
            continue
        seen[i] = 1
        x, y = i % w, i // w
        for j in (
            (i - 1 if x else -1),
            (i + 1 if x < w - 1 else -1),
            (i - w if y else -1),
            (i + w if y < h - 1 else -1),
        ):
            if j >= 0 and not seen[j] and bg[j]:
                queue.append(j)

    removed = sum(seen) / n
    if not 0.05 < removed < 0.95:
        raise SystemExit(
            f"knockout removed {removed:.0%} of pixels; background detection failed, aborting"
        )

    alpha = Image.frombytes("L", (w, h), bytes(0 if s else 255 for s in seen))
    alpha = alpha.filter(ImageFilter.GaussianBlur(1))
    out = im.copy()
    out.putalpha(alpha)
    print(f"knockout: {removed:.0%} of pixels made transparent")
    return out


def png_bytes(im: Image.Image) -> bytes:
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def build_icns(pngs: dict[int, bytes]) -> bytes:
    # iconutil-style lowercase magic: tools recognize 'icns', not 'ICNS'
    chunks = b"".join(
        struct.pack(">4sI", kind.encode(), 8 + len(pngs[size])) + pngs[size]
        for size, kind in ICNS_ENTRIES
    )
    return b"icns" + struct.pack(">I", 8 + len(chunks)) + chunks


def bmp_ico_entry(im: Image.Image) -> bytes:
    """32bpp bottom-up BGRA DIB with empty AND mask, as used in classic .ico."""
    w, h = im.size
    px = im.load()
    rows = b"".join(
        b"".join(
            bytes((px[x, y][2], px[x, y][1], px[x, y][0], px[x, y][3])) for x in range(w)
        )
        for y in range(h - 1, -1, -1)
    )
    header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, len(rows), 0, 0, 0, 0)
    mask_stride = ((w + 31) // 32) * 4
    return header + rows + b"\x00" * (mask_stride * h)


def build_ico(rendered: dict[int, Image.Image]) -> bytes:
    payloads = []
    for size, encoding in ICO_SIZES:
        im = rendered[size]
        if encoding == "PNG":
            # legacy tools/file(1) expect the first entry under 64KB: quantize
            q = im.quantize(256, method=Image.Quantize.FASTOCTREE)
            payload = png_bytes(q)
            if len(payload) >= 65536:
                raise SystemExit(f"256px ICO entry is {len(payload)}B, still >= 64KB")
        else:
            payload = bmp_ico_entry(im)
        payloads.append(payload)
    count = len(payloads)
    offset = 6 + 16 * count
    entries = b""
    for (size, _), payload in zip(ICO_SIZES, payloads):
        entries += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32,
                               len(payload), offset)
        offset += len(payload)
    return struct.pack("<HHH", 0, 1, count) + entries + b"".join(payloads)


def embedded_png_svg(size: int, png: bytes, body: str) -> bytes:
    b64 = base64.b64encode(png).decode("ascii")
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
        f'viewBox="0 0 {size} {size}" fill="none">{body.format(b64=b64)}</svg>\n'
    )
    return svg.encode("ascii")


def build_glyph_svg(silhouette_png: bytes | None) -> bytes:
    if silhouette_png is None:
        return (
            b'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" '
            b'viewBox="0 0 600 600" fill="none"/>\n'
        )
    b64 = base64.b64encode(silhouette_png).decode("ascii")
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" '
        'viewBox="0 0 600 600" fill="none">'
        f'<image width="600" height="600" href="data:image/png;base64,{b64}"/></svg>\n'
    )
    return svg.encode("ascii")


def light_variant(im: Image.Image) -> Image.Image:
    """Low-contrast light grayscale rendering for dark-mode docks."""
    gray = im.convert("L").point(lambda l: LIGHT_LO + l * (LIGHT_HI - LIGHT_LO) // 255)
    return gray.convert("RGBA")


def build_tray_icon(mark: Image.Image, update_badge: bool) -> Image.Image:
    """Colored knockout mark; the app's Tray renders the file as-is on every OS."""
    icon = mark.copy()
    if update_badge:
        draw = ImageDraw.Draw(icon)
        s = icon.size[0]
        r = s // 9
        cx, cy = s - int(r * 1.6), int(r * 1.6)
        ring = r + max(2, r // 5)
        draw.ellipse((cx - ring, cy - ring, cx + ring, cy + ring), fill=(255, 255, 255, 255))
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 159, 10, 255))
    return icon


def build_loading_frame(mark_png: bytes, index: int) -> bytes:
    w, h = LOADING_CANVAS
    cx, cy = w / 2, h / 2
    phase = 2 * math.pi * index / LOADING_FRAMES
    ty = round(1.5 * math.sin(2 * phase), 2)
    rot = round(5 * math.sin(phase), 2)
    x, y = round(cx - LOADING_MARK / 2, 2), round(cy - LOADING_MARK / 2, 2)
    svg = (
        f'<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" fill="none" '
        f'xmlns="http://www.w3.org/2000/svg">'
        f'<image x="{x}" y="{y}" width="{LOADING_MARK}" height="{LOADING_MARK}" '
        f'transform="translate(0 {ty}) rotate({rot} {cx} {cy})" '
        f'href="data:image/png;base64,{base64.b64encode(mark_png).decode("ascii")}"/></svg>\n'
    )
    return svg.encode("ascii")


def write(path: Path, data: bytes) -> None:
    path.write_bytes(data)
    shown = path.relative_to(REPO_ROOT) if path.is_relative_to(REPO_ROOT) else path
    print(f"  {shown}  {len(data):>9,} bytes")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--source", type=Path, default=REPO_ROOT / "app/public/fleet.png")
    ap.add_argument("--out-dir", type=Path, default=REPO_ROOT / "app/src/images")
    ap.add_argument("--fit", choices=["cover", "contain"], default="cover",
                    help="square-ize strategy: cover=center-crop, contain=pad (default: cover)")
    ap.add_argument("--glyph-silhouette", action="store_true",
                    help="glyph.svg gets a #101010 knockout silhouette instead of empty")
    args = ap.parse_args()

    src = Image.open(args.source).convert("RGBA")
    if src.width != src.height and args.fit == "cover":
        print(f"note: source is {src.width}x{src.height}; center-cropping to square")
    square = to_square(src, args.fit)
    if square.width < 1024:
        print(f"warning: source {square.width}px < 1024px; icons will be upscaled", file=sys.stderr)

    shown_src = args.source.relative_to(REPO_ROOT) if args.source.is_relative_to(REPO_ROOT) else args.source
    print(f"master: {shown_src} -> {square.width}x{square.height} ({args.fit})")

    sizes = sorted({s for s, _ in ICNS_ENTRIES} | {s for s, _ in ICO_SIZES} | {512, 1024, 2048})
    rendered: dict[int, Image.Image] = {
        s: square.resize((s, s), Image.LANCZOS) for s in sizes
    }
    pngs: dict[int, bytes] = {s: png_bytes(im) for s, im in rendered.items()}

    mark_1024 = knockout_background(square).resize((1024, 1024), Image.LANCZOS)

    args.out_dir.mkdir(parents=True, exist_ok=True)

    print("writing:")
    light_pngs = {s: png_bytes(light_variant(rendered[s])) for s, _ in ICNS_ENTRIES}
    write(args.out_dir / "icon.icns", build_icns(pngs))
    write(args.out_dir / "icon-light.icns", build_icns(light_pngs))
    write(args.out_dir / "icon.ico", build_ico(rendered))
    write(args.out_dir / "icon.png", pngs[1024])
    write(args.out_dir / "icon@2x.png", pngs[2048])
    write(args.out_dir / "icon-512.png", pngs[512])
    write(args.out_dir / "icon-light.png", light_pngs[512])
    write(args.out_dir / "icon.svg",
          embedded_png_svg(512, pngs[512],
                           '<image width="512" height="512" href="data:image/png;base64,{b64}"/>'))
    glyph_png = None
    if args.glyph_silhouette:
        silhouette = Image.new("RGBA", mark_1024.size, (16, 16, 16, 0))
        silhouette.paste(Image.new("RGBA", mark_1024.size, (16, 16, 16, 255)),
                         (0, 0), mark_1024.getchannel("A"))
        glyph_png = png_bytes(silhouette.resize((600, 600), Image.LANCZOS))
    write(args.out_dir / "glyph.svg", build_glyph_svg(glyph_png))

    base_icon = build_tray_icon(mark_1024, update_badge=False)
    upd_icon = build_tray_icon(mark_1024, update_badge=True)
    for icon, name in ((base_icon, "iconTemplate"), (upd_icon, "iconTemplateUpdate")):
        for px, suffix in ((22, ""), (44, "@2x")):
            write(args.out_dir / f"{name}{suffix}.png",
                  png_bytes(icon.resize((px, px), Image.LANCZOS)))

    loading_dir = args.out_dir / "loading-goose"
    loading_dir.mkdir(exist_ok=True)
    mark_png_144 = png_bytes(mark_1024.resize((144, 144), Image.LANCZOS))
    for i in range(1, LOADING_FRAMES + 1):
        write(loading_dir / f"{i}.svg", build_loading_frame(mark_png_144, i - 1))

    print("done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
