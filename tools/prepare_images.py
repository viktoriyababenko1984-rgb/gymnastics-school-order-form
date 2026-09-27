#!/usr/bin/env python3
"""Готовит картинки для сайта из папки, скачанной с Google Drive (ТЗ, раздел 6.6, шаг 8).

Исходные файлы называются «{N} {Название}.png» (например, «1 Лонгслив детский черный “Сказка”.png»),
логотип — «logo.png». Скрипт сохраняет:
  images/{N}.jpg  — 800×800, JPEG ~80%, цель ≤ 150 КБ (NFR-03)
  images/logo.png — до 192×192 px, с прозрачностью

Запуск:
  pip install Pillow
  python3 tools/prepare_images.py "путь/к/скачанной/папке"
"""
import re
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    sys.exit("Нужна библиотека Pillow: pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "images"
SIZE = 800
MAX_BYTES = 150 * 1024
PRODUCT_RE = re.compile(r"^\s*(\d{1,2})\s+.+\.(png|jpe?g|webp)$", re.IGNORECASE)


def to_square_jpeg(src: Path, dst: Path) -> int:
    img = ImageOps.exif_transpose(Image.open(src))
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    else:
        img = img.convert("RGB")
    img = ImageOps.fit(img, (SIZE, SIZE), Image.LANCZOS)  # почти квадратные фото — обрезка по центру
    for quality in (82, 76, 70, 64, 58):
        img.save(dst, "JPEG", quality=quality, optimize=True, progressive=True)
        if dst.stat().st_size <= MAX_BYTES:
            break
    return dst.stat().st_size


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src_dir = Path(sys.argv[1])
    if not src_dir.is_dir():
        sys.exit(f"Папка не найдена: {src_dir}")
    OUT.mkdir(exist_ok=True)

    found = set()
    for f in sorted(src_dir.iterdir()):
        m = PRODUCT_RE.match(f.name)
        if m:
            n = int(m.group(1))
            size = to_square_jpeg(f, OUT / f"{n}.jpg")
            found.add(n)
            print(f"{f.name}  →  images/{n}.jpg  ({size // 1024} КБ)")
        elif f.name.lower() == "logo.png":
            logo = Image.open(f)
            logo.thumbnail((192, 192))
            logo.save(OUT / "logo.png", optimize=True)
            print(f"{f.name}  →  images/logo.png  ({(OUT / 'logo.png').stat().st_size // 1024} КБ)")

    missing = sorted(set(range(1, 14)) - found)
    if missing:
        print("Не найдены картинки для товаров:", ", ".join(map(str, missing)))


if __name__ == "__main__":
    main()
