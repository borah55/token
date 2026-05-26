"""Generate PNG icons for the OTC Signal Generator PWA using only stdlib.
Run: python3 scripts/make_icons.py
"""
import struct
import zlib
import math
import os

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
os.makedirs(OUT_DIR, exist_ok=True)


def write_png(path, pixels, width, height):
    """Write RGBA pixel buffer (bytes) as a PNG file."""
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        raw.extend(pixels[y * stride:(y + 1) * stride])
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig)
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", idat))
        f.write(chunk(b"IEND", b""))


def blend(dst, src):
    sa = src[3] / 255.0
    da = dst[3] / 255.0
    out_a = sa + da * (1 - sa)
    if out_a <= 0:
        return (0, 0, 0, 0)
    out = []
    for i in range(3):
        v = (src[i] * sa + dst[i] * da * (1 - sa)) / out_a
        out.append(max(0, min(255, int(round(v)))))
    out.append(int(round(out_a * 255)))
    return tuple(out)


class Img:
    def __init__(self, w, h, bg=(0, 0, 0, 0)):
        self.w, self.h = w, h
        self.px = bytearray([bg[0], bg[1], bg[2], bg[3]] * (w * h))

    def set(self, x, y, color):
        if x < 0 or y < 0 or x >= self.w or y >= self.h:
            return
        i = (y * self.w + x) * 4
        existing = (self.px[i], self.px[i+1], self.px[i+2], self.px[i+3])
        r, g, b, a = blend(existing, color)
        self.px[i] = r; self.px[i+1] = g; self.px[i+2] = b; self.px[i+3] = a

    def fill_rounded(self, x, y, w, h, r, color):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                in_corner = False
                dx = dy = 0
                if xx < x + r and yy < y + r:
                    dx = xx - (x + r); dy = yy - (y + r); in_corner = True
                elif xx >= x + w - r and yy < y + r:
                    dx = xx - (x + w - r - 1); dy = yy - (y + r); in_corner = True
                elif xx < x + r and yy >= y + h - r:
                    dx = xx - (x + r); dy = yy - (y + h - r - 1); in_corner = True
                elif xx >= x + w - r and yy >= y + h - r:
                    dx = xx - (x + w - r - 1); dy = yy - (y + h - r - 1); in_corner = True
                if in_corner:
                    d = math.hypot(dx, dy)
                    if d > r:
                        continue
                    if d > r - 1:
                        a = max(0, min(1, r - d))
                        c = (color[0], color[1], color[2], int(color[3] * a))
                        self.set(xx, yy, c); continue
                self.set(xx, yy, color)

    def fill_rect(self, x, y, w, h, color):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.set(xx, yy, color)

    def fill_circle(self, cx, cy, r, color):
        for yy in range(int(cy - r - 1), int(cy + r + 2)):
            for xx in range(int(cx - r - 1), int(cx + r + 2)):
                d = math.hypot(xx - cx, yy - cy)
                if d <= r - 1:
                    self.set(xx, yy, color)
                elif d <= r:
                    a = max(0, min(1, r - d))
                    c = (color[0], color[1], color[2], int(color[3] * a))
                    self.set(xx, yy, c)

    def line(self, x1, y1, x2, y2, thickness, color):
        dx, dy = x2 - x1, y2 - y1
        steps = int(math.hypot(dx, dy) * 2) + 1
        for s in range(steps + 1):
            t = s / steps
            x = x1 + dx * t
            y = y1 + dy * t
            self.fill_circle(x, y, thickness / 2, color)

    def gradient_fill(self, x, y, w, h, top, bottom, radius=0):
        for yy in range(y, y + h):
            t = (yy - y) / max(1, h - 1)
            r = int(top[0] * (1 - t) + bottom[0] * t)
            g = int(top[1] * (1 - t) + bottom[1] * t)
            b = int(top[2] * (1 - t) + bottom[2] * t)
            for xx in range(x, x + w):
                if radius > 0:
                    in_corner = False
                    cx = cy = 0
                    if xx < x + radius and yy < y + radius:
                        cx, cy = x + radius, y + radius; in_corner = True
                    elif xx >= x + w - radius and yy < y + radius:
                        cx, cy = x + w - radius - 1, y + radius; in_corner = True
                    elif xx < x + radius and yy >= y + h - radius:
                        cx, cy = x + radius, y + h - radius - 1; in_corner = True
                    elif xx >= x + w - radius and yy >= y + h - radius:
                        cx, cy = x + w - radius - 1, y + h - radius - 1; in_corner = True
                    if in_corner:
                        d = math.hypot(xx - cx, yy - cy)
                        if d > radius: continue
                self.set(xx, yy, (r, g, b, 255))


def make_icon(size, maskable=False):
    img = Img(size, size, (0, 0, 0, 0))
    s = size

    if maskable:
        img.gradient_fill(0, 0, s, s, (10, 25, 41), (4, 16, 28))
        scale = 0.78
        offset = int(s * (1 - scale) / 2)
        inner_w = int(s * scale)
    else:
        radius = int(s * 0.22)
        img.gradient_fill(0, 0, s, s, (10, 25, 41), (4, 16, 28), radius=radius)
        offset = 0
        inner_w = s

    def t(x, y):
        sx = int(offset + x / 512 * inner_w)
        sy = int(offset + y / 512 * inner_w)
        return sx, sy

    # Grid lines
    grid = (14, 42, 68, 80)
    for gx in (128, 256, 384):
        x1, y1 = t(gx, 40); x2, y2 = t(gx, 472)
        img.line(x1, y1, x2, y2, max(1, s // 256), grid)
    for gy in (128, 256, 384):
        x1, y1 = t(40, gy); x2, y2 = t(472, gy)
        img.line(x1, y1, x2, y2, max(1, s // 256), grid)

    # Candles
    candles = [
        (110, 320, 60, (0, 230, 118)),
        (170, 280, 100, (0, 230, 118)),
        (230, 300, 80, (255, 59, 92)),
        (290, 260, 120, (0, 230, 118)),
        (350, 290, 90, (0, 230, 118)),
    ]
    for cx, cy, ch, color in candles:
        x1, y1 = t(cx, cy); x2, y2 = t(cx + 22, cy + ch)
        img.fill_rounded(x1, y1, x2 - x1, y2 - y1, max(2, s // 100), color + (255,))

    # Trend line
    cyan = (28, 245, 224, 255)
    pts = [(96, 360), (208, 248), (272, 312), (416, 168)]
    pts_t = [t(*p) for p in pts]
    thickness = max(6, s // 24)
    for i in range(len(pts_t) - 1):
        img.line(pts_t[i][0], pts_t[i][1], pts_t[i + 1][0], pts_t[i + 1][1], thickness, cyan)
    end_cx, end_cy = pts_t[-1]
    img.fill_circle(end_cx, end_cy, max(8, s // 32), cyan)
    img.fill_circle(end_cx, end_cy, max(14, s // 20), (28, 245, 224, 60))

    # OTC text (5x7 bitmap font)
    glyphs = {
        'O': ["01110","10001","10001","10001","10001","10001","01110"],
        'T': ["11111","00100","00100","00100","00100","00100","00100"],
        'C': ["01110","10001","10000","10000","10000","10001","01110"],
    }
    text = "OTC"
    glyph_w, glyph_h, spacing = 5, 7, 1
    total_units_w = len(text) * glyph_w + spacing * (len(text) - 1)
    char_size = 70
    pixel_size = char_size / glyph_h
    total_px_w = total_units_w * pixel_size
    start_x_units = 256 - total_px_w / 2
    y_units = 60

    for i, ch in enumerate(text):
        glyph = glyphs[ch]
        gx = start_x_units + i * (glyph_w + spacing) * pixel_size
        for row, bits in enumerate(glyph):
            for col, bit in enumerate(bits):
                if bit == '1':
                    px = gx + col * pixel_size
                    py = y_units + row * pixel_size
                    x1, y1 = t(px, py)
                    x2, y2 = t(px + pixel_size, py + pixel_size)
                    img.fill_rect(x1, y1, max(1, x2 - x1), max(1, y2 - y1), cyan)

    return img


def save(img, path):
    write_png(path, bytes(img.px), img.w, img.h)
    print(f"wrote {path} ({os.path.getsize(path)} bytes)")


if __name__ == "__main__":
    save(make_icon(192, maskable=False), os.path.join(OUT_DIR, "icon-192.png"))
    save(make_icon(512, maskable=False), os.path.join(OUT_DIR, "icon-512.png"))
    save(make_icon(512, maskable=True), os.path.join(OUT_DIR, "icon-maskable-512.png"))
