#!/usr/bin/env python3

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import json

ROOT = Path("/Users/soohongkim/Documents/workspace/personal/kuma-picker")
MANIFEST = json.loads((ROOT / "packages/browser-extension/manifest.json").read_text())
VERSION = MANIFEST.get("version", "0.0.0")
OUT = ROOT / "artifacts" / "chrome-web-store" / f"v{VERSION}" / "assets"
OUT.mkdir(parents=True, exist_ok=True)
for stale_asset in OUT.glob("*.png"):
    stale_asset.unlink()

BG = "#0f151c"
PANEL_DARK = (12, 18, 25, 186)
PANEL_LIGHT = "#f8fbff"
TEXT = "#f7fbff"
TEXT_DARK = "#162332"
SUBTLE = "#c4d2df"
SUBTLE_DARK = "#6b7d8f"
MINT = "#8ae7c5"
MINT_SOFT = "#dff8ee"
STROKE = "#d9e3eb"
LAVENDER = "#eef0ff"
LAVENDER_DEEP = "#5a67bc"
WARM = "#fff3e6"
WARM_DEEP = "#9b6831"


def load_font(size: int, bold: bool = False, mono: bool = False):
    candidates = []
    if mono:
        candidates.extend(
            [
                "/System/Library/Fonts/Menlo.ttc",
                "/System/Library/Fonts/SFNSMono.ttf",
            ]
        )
    elif bold:
        candidates.extend(
            [
                "/System/Library/Fonts/Supplemental/Helvetica Neue Bold.ttf",
                "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                "/System/Library/Fonts/Supplemental/Helvetica Bold.ttf",
            ]
        )
    else:
        candidates.extend(
            [
                "/System/Library/Fonts/Supplemental/Helvetica Neue.ttf",
                "/System/Library/Fonts/Supplemental/Arial.ttf",
                "/System/Library/Fonts/Supplemental/Helvetica.ttf",
            ]
        )

    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size=size)
        except Exception:
            continue
    return ImageFont.load_default()


FONT_HERO = load_font(56, bold=True)
FONT_TITLE = load_font(36, bold=True)
FONT_BODY = load_font(24)
FONT_SMALL = load_font(18)
FONT_TAG = load_font(18, bold=True)
FONT_PROMO_TITLE = load_font(32, bold=True)
FONT_PROMO_BODY = load_font(16)
FONT_CODE = load_font(22, mono=True)


def blank_canvas():
    return Image.new("RGBA", (1280, 800), BG)


def rounded_rect(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def add_shadow(base, box, radius=32, opacity=52):
    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(shadow)
    draw.rounded_rectangle(box, radius=radius, fill=(0, 0, 0, opacity))
    shadow = shadow.filter(ImageFilter.GaussianBlur(20))
    base.alpha_composite(shadow)


def cover_crop(source, size, focus=(0.5, 0.5)):
    image = source.copy().convert("RGBA")
    source_ratio = image.width / image.height
    target_ratio = size[0] / size[1]

    if source_ratio > target_ratio:
        new_height = image.height
        new_width = int(new_height * target_ratio)
        left = int((image.width - new_width) * focus[0])
        left = max(0, min(left, image.width - new_width))
        image = image.crop((left, 0, left + new_width, image.height))
    else:
        new_width = image.width
        new_height = int(new_width / target_ratio)
        top = int((image.height - new_height) * focus[1])
        top = max(0, min(top, image.height - new_height))
        image = image.crop((0, top, image.width, top + new_height))

    return image.resize(size, Image.Resampling.LANCZOS)


def fit_image(source, size):
    image = source.copy().convert("RGBA")
    image.thumbnail(size, Image.Resampling.LANCZOS)
    return image


def add_wrapped_text(draw, text, font, box, fill, line_gap=10):
    words = text.split()
    lines = []
    current = ""
    max_width = box[2] - box[0]

    for word in words:
        candidate = word if not current else f"{current} {word}"
        width = draw.textbbox((0, 0), candidate, font=font)[2]
        if width <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)

    y = box[1]
    for line in lines:
        draw.text((box[0], y), line, font=font, fill=fill)
        line_box = draw.textbbox((box[0], y), line, font=font)
        y = line_box[3] + line_gap
    return y


def framed_screenshot(base, source, box, focus=(0.5, 0.5), radius=34):
    add_shadow(base, box, radius=radius)
    shot = cover_crop(source, (box[2] - box[0], box[3] - box[1]), focus=focus)
    mask = Image.new("L", (box[2] - box[0], box[3] - box[1]), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle((0, 0, mask.width, mask.height), radius=radius, fill=255)
    base.paste(shot, (box[0], box[1]), mask)


def draw_scrim(base, box, alpha=182):
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rounded_rectangle(box, radius=30, fill=(8, 13, 20, alpha))
    base.alpha_composite(overlay)


def draw_tag(draw, x, y, text, fill=MINT_SOFT, ink="#165644"):
    bbox = draw.textbbox((0, 0), text, font=FONT_TAG)
    width = bbox[2] - bbox[0] + 30
    height = bbox[3] - bbox[1] + 16
    rounded_rect(draw, (x, y, x + width, y + height), 999, fill)
    draw.text((x + 15, y + 8), text, font=FONT_TAG, fill=ink)


def draw_popup_card(base, popup_source, box):
    add_shadow(base, box, radius=28, opacity=36)
    panel = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(panel)
    rounded_rect(draw, box, 28, PANEL_LIGHT, outline=STROKE, width=2)
    base.alpha_composite(panel)
    popup = fit_image(popup_source, (box[2] - box[0] - 28, box[3] - box[1] - 28))
    x = box[0] + ((box[2] - box[0]) - popup.width) // 2
    y = box[1] + ((box[3] - box[1]) - popup.height) // 2
    base.alpha_composite(popup, (x, y))


def draw_selection_outline(draw, box, color, width=4, fill=None):
    rounded_rect(draw, box, 20, fill, outline=color, width=width)


def draw_job_card(base, box, message):
    add_shadow(base, box, radius=24, opacity=34)
    panel = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(panel)
    rounded_rect(draw, box, 24, "#fffdf8", outline="#ecdccc", width=2)
    rounded_rect(draw, (box[0] + 16, box[1] + 16, box[0] + 110, box[1] + 46), 999, WARM)
    draw.text((box[0] + 34, box[1] + 23), "Working", font=FONT_TAG, fill=WARM_DEEP)
    draw.text((box[0] + 18, box[1] + 74), "Progress", font=FONT_SMALL, fill="#816d58")
    add_wrapped_text(draw, message, FONT_BODY, (box[0] + 18, box[1] + 104, box[2] - 18, box[3] - 72), TEXT_DARK, line_gap=6)
    draw.text((box[0] + 18, box[3] - 42), "Updated by Agent", font=FONT_SMALL, fill="#97a0a9")
    base.alpha_composite(panel)


def draw_code_panel(base, box, lines):
    add_shadow(base, box, radius=30, opacity=42)
    panel = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(panel)
    rounded_rect(draw, box, 30, "#0f1a27", outline="#243549", width=2)
    rounded_rect(draw, (box[0] + 22, box[1] + 20, box[0] + 144, box[1] + 52), 999, "#11253a")
    draw.text((box[0] + 38, box[1] + 28), "run script", font=FONT_SMALL, fill="#8fb9da")
    y = box[1] + 88
    for line in lines:
        draw.text((box[0] + 28, y), line, font=FONT_CODE, fill="#e1ebf7")
        y += 42
    base.alpha_composite(panel)


def draw_paw(base, paw_source, x, y, size):
    paw = fit_image(paw_source, (size, size))
    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(shadow)
    draw.ellipse((x - 14, y - 10, x + paw.width + 14, y + paw.height + 18), fill=(0, 0, 0, 46))
    shadow = shadow.filter(ImageFilter.GaussianBlur(12))
    base.alpha_composite(shadow)
    base.alpha_composite(paw, (x, y))


REPO = Image.open(ROOT / "tmp/repo-tab-live.png")
POPUP = Image.open(ROOT / "output/playwright/popup-pick-space-after.png")
STUDIO = Image.open(ROOT / "output/playwright/capture-studio-store-english.png")
PAW = Image.open(ROOT / "packages/browser-extension/assets/gestures/kuma-paw-tap.png").convert("RGBA")


def screenshot_1():
    image = blank_canvas()
    draw = ImageDraw.Draw(image)
    framed_screenshot(image, REPO, (28, 28, 1252, 772), focus=(0.5, 0.5))
    draw_scrim(image, (56, 54, 488, 292))
    draw.text((82, 80), "Kuma Picker", font=FONT_SMALL, fill="#9fd9c4")
    add_wrapped_text(draw, "Share Your Real Browser", FONT_HERO, (82, 114, 452, 236), TEXT, line_gap=8)
    add_wrapped_text(draw, "Real tabs, real session state, and visible picks.", FONT_BODY, (82, 252, 444, 330), SUBTLE, line_gap=6)
    draw_popup_card(image, POPUP, (932, 172, 1208, 720))
    draw_tag(draw, 82, 348, "Not a hidden test window")
    image.save(OUT / "screenshot-01-real-browser.png")


def screenshot_2():
    image = blank_canvas()
    draw = ImageDraw.Draw(image)
    framed_screenshot(image, REPO, (28, 28, 1252, 772), focus=(0.5, 0.5))
    draw_scrim(image, (56, 56, 472, 250))
    draw.text((82, 82), "Kuma Picker", font=FONT_SMALL, fill="#9fd9c4")
    add_wrapped_text(draw, "Pick The Exact UI", FONT_HERO, (82, 116, 430, 232), TEXT, line_gap=8)
    add_wrapped_text(draw, "Buttons, cards, fields, or whole regions.", FONT_BODY, (82, 244, 430, 312), SUBTLE, line_gap=6)
    draw_selection_outline(draw, (112, 270, 594, 706), MINT, width=5)
    draw_popup_card(image, POPUP, (900, 158, 1210, 726))
    draw.line((594, 488, 900, 488), fill=MINT, width=4)
    draw_tag(draw, 82, 330, "Whole page with Space", fill=LAVENDER, ink=LAVENDER_DEEP)
    image.save(OUT / "screenshot-02-pick-flow.png")


def screenshot_3():
    image = blank_canvas()
    draw = ImageDraw.Draw(image)
    framed_screenshot(image, REPO, (28, 28, 1252, 772), focus=(0.5, 0.5))
    draw_scrim(image, (56, 56, 474, 250))
    draw.text((82, 82), "Kuma Picker", font=FONT_SMALL, fill="#9fd9c4")
    add_wrapped_text(draw, "Leave Work On The Page", FONT_TITLE, (82, 116, 452, 208), TEXT, line_gap=6)
    add_wrapped_text(draw, "Visible job cards keep people and agents in the same browser context.", FONT_BODY, (82, 220, 452, 318), SUBTLE, line_gap=6)
    draw_job_card(image, (780, 392, 1108, 624), "Check whether the About copy still describes the old product shape.")
    draw_tag(draw, 82, 336, "Shared handoff")
    image.save(OUT / "screenshot-03-job-cards.png")


def screenshot_4():
    image = blank_canvas()
    draw = ImageDraw.Draw(image)
    framed_screenshot(image, REPO, (28, 28, 1252, 772), focus=(0.5, 0.5))
    draw_code_panel(
        image,
        (72, 112, 672, 692),
        [
            "await page.goto(url);",
            "await page.getByLabel(\"Composer\").fill(\"hello\");",
            "await page.getByRole(\"button\", { name: \"Send\" }).click();",
            "await page.getByText(\"hello\").waitFor();",
        ],
    )
    draw_scrim(image, (720, 82, 1186, 250), alpha=168)
    draw.text((748, 108), "Kuma Picker", font=FONT_SMALL, fill="#9fd9c4")
    add_wrapped_text(draw, "Familiar Page API", FONT_TITLE, (748, 140, 1148, 218), TEXT, line_gap=6)
    add_wrapped_text(draw, "Playwright-shaped commands in your live browser session.", FONT_BODY, (748, 222, 1144, 298), SUBTLE, line_gap=6)
    draw_tag(draw, 748, 314, "run + page")
    image.save(OUT / "screenshot-04-page-api.png")


def screenshot_5():
    image = blank_canvas()
    draw = ImageDraw.Draw(image)
    framed_screenshot(image, STUDIO, (28, 28, 1252, 772), focus=(0.5, 0.48))
    draw_scrim(image, (58, 58, 460, 248), alpha=168)
    draw.text((84, 84), "Kuma Picker", font=FONT_SMALL, fill="#9fd9c4")
    add_wrapped_text(draw, "Frame And Record", FONT_TITLE, (84, 116, 420, 194), TEXT, line_gap=6)
    add_wrapped_text(draw, "Capture the real browser with a dedicated framing studio.", FONT_BODY, (84, 198, 420, 276), SUBTLE, line_gap=6)
    draw_selection_outline(draw, (160, 164, 414, 548), "#f5fbff", width=4)
    draw_selection_outline(draw, (486, 226, 720, 534), MINT, width=4, fill=(124, 230, 192, 38))
    draw_paw(image, PAW, 1060, 124, 118)
    image.save(OUT / "screenshot-05-live-capture.png")


def promo_tile():
    image = Image.new("RGBA", (440, 280), BG)
    draw = ImageDraw.Draw(image)
    rounded_rect(draw, (14, 14, 426, 266), 34, "#121a22", outline="#26313d", width=2)
    rounded_rect(draw, (32, 36, 292, 184), 28, "#182430", outline="#2f3d4c", width=2)
    rounded_rect(draw, (54, 64, 188, 94), 999, MINT)
    rounded_rect(draw, (54, 112, 244, 146), 16, "#eef4fa")
    rounded_rect(draw, (54, 160, 214, 186), 14, "#f2f1ff")
    draw_paw(image, PAW, 276, 74, 116)
    draw.text((32, 206), "Kuma Picker", font=FONT_PROMO_TITLE, fill=TEXT)
    add_wrapped_text(draw, "Visible picks and paw feedback.", FONT_PROMO_BODY, (32, 244, 244, 266), "#bfd0e1", line_gap=3)
    image.save(OUT / "small-promo-tile-440x280.png")


screenshot_1()
screenshot_2()
screenshot_3()
screenshot_4()
screenshot_5()
promo_tile()

print(str(OUT))
