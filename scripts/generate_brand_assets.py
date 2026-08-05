"""Generate deterministic Windows and renderer assets from Shree's master logo."""

from __future__ import annotations

from pathlib import Path
from shutil import copyfile

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
BRANDING = ROOT / "src" / "assets" / "branding"
MASTER = BRANDING / "shree-logo-transparent.png"


def _square_mark(image: Image.Image) -> Image.Image:
    """Crop the emblem (without the wordmark) and place it on a square canvas."""
    width, height = image.size
    emblem_bottom = int(height * 0.695)
    upper_logo = image.crop((0, 0, width, emblem_bottom))
    alpha = upper_logo.getchannel("A")
    visible = alpha.point(lambda value: 255 if value >= 18 else 0)
    bounds = visible.getbbox()
    if not bounds:
        raise RuntimeError("The Shree master logo has no visible emblem pixels")

    left, top, right, bottom = bounds
    content_width, content_height = right - left, bottom - top
    padding = max(24, int(max(content_width, content_height) * 0.08))
    left = max(0, left - padding)
    top = max(0, top - padding)
    right = min(width, right + padding)
    bottom = min(emblem_bottom, bottom + padding)
    cropped = upper_logo.crop((left, top, right, bottom))

    side = max(cropped.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.alpha_composite(cropped, ((side - cropped.width) // 2, (side - cropped.height) // 2))
    return canvas


def main() -> None:
    BRANDING.mkdir(parents=True, exist_ok=True)
    (ROOT / "public").mkdir(parents=True, exist_ok=True)
    (ROOT / "build").mkdir(parents=True, exist_ok=True)

    with Image.open(MASTER) as source:
        logo = source.convert("RGBA")
        mark = _square_mark(logo)

    mark_512 = mark.resize((512, 512), Image.Resampling.LANCZOS)
    mark_path = BRANDING / "shree-mark.png"
    mark_512.save(mark_path, optimize=True)
    copyfile(mark_path, ROOT / "public" / "shree-mark.png")

    icon_path = ROOT / "build" / "shree.ico"
    mark_512.save(
        icon_path,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    mark_512.save(ROOT / "build" / "shree-icon.png", optimize=True)

    print(f"Generated {mark_path.relative_to(ROOT)}")
    print(f"Generated {icon_path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
