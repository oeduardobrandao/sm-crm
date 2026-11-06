"""Compose the nurture e-mail screenshots (public/email/nurture-*.jpg).

Input: the phone captures from e2e/screenshots/nurture-emails.spec.ts
(e2e/.shots/nurture-emails/, 390x844 CSS at 2x). Output: 560px-wide JPEGs,
shown at 280px in the e-mail, so they stay sharp on retina phones.

E-mail clients ignore CSS radius/shadow on images unevenly (Outlook desktop
drops it), so the frame is baked in: rounded corners filled with the card
white (#ffffff, EMAIL.card), a 1px #e5e7eb border (EMAIL.border). JPEG, not
webp: Outlook and older Android clients do not render webp.

Run: python3 -I scripts/build-nurture-email-images.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "e2e" / ".shots" / "nurture-emails"
OUT = ROOT / "public" / "email"
SCALE = 2  # capture deviceScaleFactor
WIDTH = 560
RADIUS = 28
CARD = (255, 255, 255)
BORDER = (229, 231, 235)

# name -> (source, list of CSS-pixel vertical bands to keep, stacked top to bottom)
SHOTS = {
    "nurture-clientes": ("01-crm-clientes.png", [(0, 560)]),
    "nurture-hub": ("02-hub-home.png", [(0, 600)]),
    "nurture-aprovacoes": ("03-hub-aprovacoes.png", [(0, 720)]),
    # Post detail: artwork + title, then the Corrigir/Aprovar bar; the empty
    # caption area between them is dropped.
    "nurture-aprovar": ("04-hub-post.png", [(0, 640), (772, 844)]),
    "nurture-relatorios": ("05-hub-relatorios.png", [(0, 640)]),
}


def compose(src: Path, bands: list[tuple[int, int]]) -> Image.Image:
    im = Image.open(src).convert("RGB")
    parts = [im.crop((0, a * SCALE, im.width, b * SCALE)) for a, b in bands]
    h = sum(p.height for p in parts)
    stacked = Image.new("RGB", (im.width, h), CARD)
    y = 0
    for p in parts:
        stacked.paste(p, (0, y))
        y += p.height
    out_h = round(h * WIDTH / im.width)
    shot = stacked.resize((WIDTH, out_h), Image.LANCZOS)

    # Rounded frame, drawn at 4x and downsampled for smooth corners.
    s = 4
    mask = Image.new("L", (WIDTH * s, out_h * s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, WIDTH * s - 1, out_h * s - 1), RADIUS * s, fill=255)
    mask = mask.resize((WIDTH, out_h), Image.LANCZOS)
    framed = Image.new("RGB", (WIDTH, out_h), CARD)
    framed.paste(shot, (0, 0), mask)

    border = Image.new("RGBA", (WIDTH * s, out_h * s), (0, 0, 0, 0))
    ImageDraw.Draw(border).rounded_rectangle(
        (0, 0, WIDTH * s - 1, out_h * s - 1), RADIUS * s, outline=BORDER + (255,), width=2 * s
    )
    border = border.resize((WIDTH, out_h), Image.LANCZOS)
    framed.paste(border, (0, 0), border)
    return framed


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (file, bands) in SHOTS.items():
        img = compose(SRC / file, bands)
        dest = OUT / f"{name}.jpg"
        img.save(dest, "JPEG", quality=82, optimize=True, progressive=True)
        print(f"{dest.relative_to(ROOT)} {img.width}x{img.height} {dest.stat().st_size // 1024}KB")


if __name__ == "__main__":
    main()
