"""
Cuts the app's logo (art/logo.png, a full-bleed square) into the files each
platform wants. The logo itself was generated as an image (the vault's runbook
"Gerar imagens com o Codex"), so it is committed, and this only resizes it.

Usage, from apps/desktop: npm run icon   (needs Python with Pillow)
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

DESKTOP = Path(__file__).resolve().parent.parent
MOBILE = DESKTOP.parent / 'mobile'
SIZE = 1024

logo = Image.open(DESKTOP / 'art' / 'logo.png').convert('RGB')
side = min(logo.size)
left, top = (logo.width - side) // 2, (logo.height - side) // 2
logo = logo.crop((left, top, left + side, top + side)).resize((SIZE, SIZE), Image.LANCZOS)


def rounded(image: Image.Image, radius: float) -> Image.Image:
    """The image with transparent rounded corners, antialiased."""
    width = image.width
    mask = Image.new('L', (width * 4, width * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, width * 4, width * 4), radius * width * 4, fill=255)
    result = image.convert('RGBA')
    result.putalpha(mask.resize((width, width), Image.LANCZOS))
    return result


# Desktop: a rounded square with a little air around it, as Windows and macOS
# draw their icons. `tauri icon` makes every size from this one.
inner = round(SIZE * 0.9)
desktop = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
tile = rounded(logo.resize((inner, inner), Image.LANCZOS), 0.225)
desktop.paste(tile, ((SIZE - inner) // 2, (SIZE - inner) // 2), tile)
desktop.save(DESKTOP / 'icon.png')

# The mark inside the app (sidebar): the cards alone, without the dark margin.
crop = round(SIZE * 0.14)
mark = logo.crop((crop, crop, SIZE - crop, SIZE - crop)).resize((96, 96), Image.LANCZOS)
rounded(mark, 0.24).save(DESKTOP / 'src' / 'ui' / 'brand.png')

# Android, legacy icon and stores: the full square.
logo.save(MOBILE / 'assets' / 'icon.png')

# Android adaptive icon: the launcher shows only the middle two thirds, so the
# logo shrinks onto a larger canvas of its own edge colour, with a soft seam.
edge = logo.getpixel((4, 4))
scale = round(SIZE * 0.78)
canvas = Image.new('RGB', (SIZE, SIZE), edge)
feather = Image.new('L', (scale, scale), 0)
margin = round(scale * 0.09)
ImageDraw.Draw(feather).rectangle((margin, margin, scale - margin, scale - margin), fill=255)
feather = feather.filter(ImageFilter.GaussianBlur(margin / 2.2))
canvas.paste(logo.resize((scale, scale), Image.LANCZOS), ((SIZE - scale) // 2,) * 2, feather)
canvas.save(MOBILE / 'assets' / 'adaptive-icon.png')

print('edge colour: #%02x%02x%02x' % edge)
