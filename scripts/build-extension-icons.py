from pathlib import Path

from PIL import Image, ImageDraw


CANVAS = 1024
SIZES = (16, 32, 48, 128, 1024)

BG = "#20BF8F"
INK = "#22313F"
SOFT = "#F4FFFB"


def scale(points):
    return [(x * CANVAS, y * CANVAS) for x, y in points]


def cursor_polygon():
    return scale(
        [
            (0.24, 0.19),
            (0.24, 0.73),
            (0.39, 0.60),
            (0.47, 0.85),
            (0.58, 0.80),
            (0.50, 0.54),
            (0.72, 0.54),
        ]
    )


def draw_base_icon():
    image = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    inset = 88
    draw.rounded_rectangle(
        (inset, inset, CANVAS - inset, CANVAS - inset),
        radius=260,
        fill=BG,
    )

    draw.ellipse((530, 206, 870, 546), outline=SOFT, width=68)
    draw.ellipse((646, 322, 754, 430), fill=SOFT)

    points = cursor_polygon()
    draw.polygon(points, fill=SOFT)
    draw.line(points + [points[0]], fill=SOFT, width=34, joint="curve")

    inner = [(x + 18, y + 14) for x, y in points]
    draw.polygon(inner, fill=INK)

    return image


def main():
    root = Path(__file__).resolve().parent.parent
    out_dir = root / "packages" / "browser-extension" / "assets" / "icons"
    out_dir.mkdir(parents=True, exist_ok=True)

    base = draw_base_icon()

    for size in SIZES:
        target = out_dir / f"agent-picker-icon-{size}.png"
        if size == CANVAS:
            base.save(target)
            continue
        resized = base.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(target)
        resized.close()


if __name__ == "__main__":
    main()
