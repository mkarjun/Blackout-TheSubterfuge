#!/usr/bin/env python3
"""Generate the PWA icon set.

A one-off asset generator, kept in the repo so the icons can be regenerated rather
than being binaries nobody can edit. Requires Pillow:

    pip install pillow
    python scripts/make-icons.py

The mark is the suspicion web the whole game is about - five nodes on a ring, every
line aimed at the diamond in the middle - drawn at 4x and downsampled, which is
cheaper than antialiasing each primitive and gives cleaner edges at 192px.

`icon-maskable-512.png` keeps its content inside the centre 60% because Android
crops a maskable icon to whatever shape the launcher uses; the others are full-bleed.
"""

import math
import os

from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')

INK = (5, 7, 12)
GLOW = (12, 34, 44)
EDGE = (28, 37, 52)
NEON = (56, 242, 196)
CAUTION = (255, 193, 77)
ALARM = (255, 77, 94)

SS = 4  # supersampling factor


def blend(fg, bg, alpha):
    """Pre-blend two opaque colours.

    ImageDraw writes pixels rather than compositing them, so a fill given an alpha
    channel punches a translucent hole in the icon instead of tinting it. Everything
    here is therefore drawn opaque, with the translucency baked into the colour.
    """
    return tuple(round(f * alpha + b * (1 - alpha)) for f, b in zip(fg, bg))


def draw_mark(size, content_scale=1.0, background=True):
    """Render the web mark at `size` px. `content_scale` shrinks it for maskable."""
    s = size * SS
    img = Image.new('RGB', (s, s), INK)
    d = ImageDraw.Draw(img)
    c = s / 2

    # A soft pool behind the mark, faked with concentric discs because PIL has no
    # gradient primitive and 40 rings are imperceptible from a real gradient.
    steps = 40
    for i in range(steps, 0, -1):
        r = (s * 0.44) * (i / steps)
        d.ellipse([c - r, c - r, c + r, c + r], fill=blend(GLOW, INK, 0.05))

    ring = s * 0.30 * content_scale
    node_r = s * 0.052 * content_scale

    d.ellipse([c - ring, c - ring, c + ring, c + ring], outline=EDGE, width=max(1, int(s * 0.008)))

    # Five nodes, the top one hottest - a theory in the middle of forming.
    heat = [ALARM, NEON, NEON, CAUTION, NEON]
    points = []
    for i in range(5):
        a = -math.pi / 2 + (i / 5) * math.tau
        points.append((c + math.cos(a) * ring, c + math.sin(a) * ring, heat[i]))

    for x, y, colour in points:
        d.line([x, y, c, c], fill=blend(colour, INK, 0.55), width=max(1, int(s * 0.012)))

    for x, y, colour in points:
        d.ellipse([x - node_r, y - node_r, x + node_r, y + node_r], fill=INK)
        d.ellipse([x - node_r, y - node_r, x + node_r, y + node_r], outline=colour,
                  width=max(1, int(s * 0.016)))

    # The diamond in the middle is you.
    half = s * 0.085 * content_scale
    d.polygon([(c, c - half), (c + half, c), (c, c + half), (c - half, c)], fill=NEON)

    return img.convert('RGBA').resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    targets = [
        ('icon-192.png', 192, 1.0),
        ('icon-512.png', 512, 1.0),
        ('icon-maskable-512.png', 512, 0.62),
        ('apple-touch-icon.png', 180, 0.86),
        ('favicon-32.png', 32, 1.0),
    ]
    for name, size, scale in targets:
        path = os.path.join(OUT, name)
        draw_mark(size, scale).save(path, optimize=True)
        print(f'wrote {path} ({size}px)')


if __name__ == '__main__':
    main()
