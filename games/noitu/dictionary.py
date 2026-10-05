"""Từ điển cho game Nối Từ: ~62.000 từ / cụm 2 tiếng (words.txt) và ~34.000 từ thông dụng (common.txt).

Nguồn: tổng hợp từ dự án từ điển mở undertheseanlp/dictionary (Hồ Ngọc Đức, Từ điển tiếng Việt,
Wiktionary) và bộ cặp từ của Noi-Tu-Discord (giấy phép MIT, xem LICENSE-wordpairs.txt); chỉ giữ từ viết
thường (bỏ tên riêng), đúng 2 tiếng, mỗi tiếng là âm tiết tiếng Việt hợp lệ. Từ người chơi bỏ phiếu chấp
nhận trong game được lưu thêm vào custom.txt.

So khớp không phân biệt kiểu bỏ dấu cũ / mới (hoá = hóa, thuỷ = thủy) và i / y cuối (kĩ = kỹ, lí = lý).
"""
import os
import random
import re
import unicodedata

_DIR = os.path.dirname(__file__)
_TONES = {"̀", "́", "̃", "̉", "̣"}
_VOWELS = set("aăâeêioôơuưy")
CUSTOM_FILE = "custom.txt"


def syl_key(s):
    """Khoá so khớp của một tiếng: chữ không dấu thanh + dấu thanh (bất kể đặt dấu ở đâu)."""
    d = unicodedata.normalize("NFD", s.lower())
    tone = "".join(c for c in d if c in _TONES)
    base = unicodedata.normalize("NFC", "".join(c for c in d if c not in _TONES))
    # i / y cuối sau phụ âm là một (kĩ = kỹ, lí = lý, mĩ = mỹ) — trừ "uy", "quy"…
    if len(base) > 1 and base.endswith("y") and base[-2] not in _VOWELS:
        base = base[:-1] + "i"
    return base + tone


def word_key(w):
    return " ".join(syl_key(x) for x in w.split())


def clean_input(text):
    """Chuẩn hoá chữ người chơi gõ: thường, bỏ dấu câu, gộp khoảng trắng."""
    t = unicodedata.normalize("NFC", str(text or "")).lower().replace("-", " ").replace("_", " ")
    t = re.sub(r"[^\w\s]", " ", t)
    return " ".join(t.split())


class Dictionary:
    def __init__(self):
        self.display = {}     # khoá từ → cách viết trong từ điển
        self.by_first = {}    # khoá tiếng đầu → [khoá từ]
        self.common = set()   # khoá các từ thông dụng
        self.syllables = set()  # mọi tiếng có trong từ điển (để kiểm tra từ xin duyệt)
        for name, is_common in (("words.txt", False), (CUSTOM_FILE, False), ("common.txt", True)):
            path = os.path.join(_DIR, name)
            if not os.path.exists(path):
                continue
            with open(path, encoding="utf-8") as f:
                for line in f:
                    w = unicodedata.normalize("NFC", line.strip())
                    if not w:
                        continue
                    if is_common:
                        self.common.add(word_key(w))
                    else:
                        self._index(w)
        self.common &= set(self.display)
        # Từ mở màn: từ quen thuộc (starters.txt) mà tiếng cuối nối tiếp được nhiều từ (để ván không tắc ngay).
        with open(os.path.join(_DIR, "starters.txt"), encoding="utf-8") as f:
            fam = {word_key(unicodedata.normalize("NFC", x.strip())) for x in f if x.strip()}
        self.starters = [k for k in fam if k in self.display and len(self.by_first.get(k.split()[1], ())) >= 12]

    def _index(self, w):
        k = word_key(w)
        if k in self.display or len(k.split()) != 2:
            return
        self.display[k] = w
        a, b = k.split()
        self.by_first.setdefault(a, []).append(k)
        self.syllables.update((a, b))

    def add(self, w):
        """Thêm từ được người chơi bỏ phiếu chấp nhận — lưu vào custom.txt để các ván sau dùng tiếp."""
        k = word_key(w)
        if k in self.display:
            return
        self._index(w)
        try:
            with open(os.path.join(_DIR, CUSTOM_FILE), "a", encoding="utf-8") as f:
                f.write(w + "\n")
        except OSError:
            pass

    def __len__(self):
        return len(self.display)

    def has(self, k):
        return k in self.display

    def show(self, k):
        return self.display.get(k, k)

    def nexts(self, k, used=()):
        """Các từ (khoá) nối tiếp được sau từ k, chưa dùng."""
        last = k.split()[1]
        return [w for w in self.by_first.get(last, ()) if w not in used]

    def random_start(self, used=()):
        for _ in range(50):
            k = random.choice(self.starters)
            if k not in used:
                return k
        return random.choice(self.starters)


DICT = Dictionary()
