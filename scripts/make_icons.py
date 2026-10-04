#!/usr/bin/env python3
"""Generate the PNG app icons with Pillow (supersampled for smooth edges).

    python3 scripts/make_icons.py

Design: warp streaks converging on a ringed planet, on a black tile. The
maskable icon is full-bleed with the art inside the central safe zone; the
"any" icons have rounded corners. icons/icon.svg is the hand-written vector
equivalent.
"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")
SS = 4  # supersampling factor


def render(size, maskable=False, rounded=True):
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    art = Image.new("RGBA", (S, S), (3, 4, 12, 255))
    d = ImageDraw.Draw(art)
    scale = 0.8 if maskable else 1.0
    cx = cy = S / 2

    # Warp streaks radiating from the centre.
    rnd = random.Random(7)
    for _ in range(44):
        a = rnd.uniform(0, math.tau)
        r0 = rnd.uniform(0.12, 0.3) * S
        r1 = r0 + rnd.uniform(0.08, 0.35) * S
        c = rnd.choice([(170, 200, 255), (255, 255, 255), (130, 160, 255)])
        alpha = rnd.randint(60, 170)
        d.line([(cx + math.cos(a) * r0, cy + math.sin(a) * r0), (cx + math.cos(a) * r1, cy + math.sin(a) * r1)],
               fill=c + (alpha,), width=max(1, int(S * 0.006)))

    # Planet with a shaded body and a tilted ring.
    pr = 0.2 * S * scale
    px, py = cx + 0.04 * S * scale, cy + 0.03 * S * scale
    ring = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    for k in range(10):
        rr = pr * (1.45 + k * 0.07)
        rd.ellipse([px - rr, py - rr * 0.28, px + rr, py + rr * 0.28],
                   outline=(255, 214, 160, 200 - k * 12), width=max(1, int(S * 0.008)))
    ring = ring.rotate(-18, center=(px, py), resample=Image.BICUBIC)
    back = ring.copy()
    back.paste((0, 0, 0, 0), (0, int(py), S, S))  # far half only
    art.alpha_composite(back)

    body = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    steps = 60
    for i in range(steps):
        t = i / steps
        r = pr * (1 - t)
        ox, oy = -pr * 0.35 * t, -pr * 0.35 * t
        col = (int(60 + 190 * t), int(90 + 120 * t), int(200 + 40 * t), 255)
        bd.ellipse([px + ox - r, py + oy - r, px + ox + r, py + oy + r], fill=col)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).ellipse([px - pr, py - pr, px + pr, py + pr], fill=255)
    clipped = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    clipped.paste(body, (0, 0), mask)
    art.alpha_composite(clipped)

    front = ring.copy()
    front.paste((0, 0, 0, 0), (0, 0, S, int(py)))
    art.alpha_composite(front)

    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([px - pr * 1.15, py - pr * 1.15, px + pr * 1.15, py + pr * 1.15], outline=(120, 170, 255, 90), width=int(S * 0.02))
    art.alpha_composite(glow.filter(ImageFilter.GaussianBlur(S * 0.01)))

    if rounded and not maskable:
        m = Image.new("L", (S, S), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
        img.paste(art, (0, 0), m)
    else:
        img = art
    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    render(192).save(os.path.join(OUT, "icon-192.png"))
    render(512).save(os.path.join(OUT, "icon-512.png"))
    render(512, maskable=True).save(os.path.join(OUT, "icon-maskable-512.png"))
    render(180, rounded=False).convert("RGB").save(os.path.join(OUT, "apple-touch-icon.png"))


if __name__ == "__main__":
    main()
