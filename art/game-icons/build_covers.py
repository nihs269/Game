"""Chuyển ảnh bìa game (art/game-icons/<mã game>.png) thành static/covers/<mã game>.webp cho sảnh.

Chạy lại mỗi khi thêm / sửa ảnh:  python art/game-icons/build_covers.py
Game nào có ảnh thì thẻ ở sảnh hiện ảnh bìa (thay emoji và đoạn tóm tắt); chưa có thì giữ như cũ.
Cần thư viện Pillow (pip install pillow) — chỉ để chạy script này, máy chủ không cần.
"""
import glob
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DEST = os.path.join(HERE, "..", "..", "static", "covers")
WIDTH = 768          # thẻ game rộng ~260–400px; x2 cho màn hình nét

os.makedirs(DEST, exist_ok=True)
for src in sorted(glob.glob(os.path.join(HERE, "*.png"))):
    gid = os.path.splitext(os.path.basename(src))[0]
    im = Image.open(src).convert("RGB")
    h = round(im.height * WIDTH / im.width)
    out = os.path.join(DEST, gid + ".webp")
    im.resize((WIDTH, h), Image.LANCZOS).save(out, "WEBP", quality=82, method=6)
    print(f"{gid}: {os.path.getsize(out) // 1024} KB")
