"""Thống kê banner ở trang chủ: lượt hiển thị, lượt click, số người khác nhau, theo từng ngày.

Lưu riêng trong board_stats.json (ghi gộp vài giây một lần) để không phải ghi admin.json mỗi lượt xem.
"""
import json
import logging
import os
import re
import time

log = logging.getLogger("gamehub")

UNIQUE_CAP = 5000        # tối đa số mã trình duyệt nhớ cho mỗi banner (đếm “người khác nhau”)
DAYS_KEEP = 90           # giữ số liệu theo ngày trong 90 ngày
CLICK_REPEAT = 5         # cùng một người bấm lại trong 5 giây → chỉ tính 1 lần
VIEW_REPEAT = 10         # cùng một người, cùng banner hiện lại trong 10 giây → chỉ tính 1 lần
SAVE_DELAY = 5
_DID_RE = re.compile(r"^[A-Za-z0-9_-]{4,64}$")


def _empty():
    return {"views": 0, "clicks": 0, "viewers": [], "clickers": [], "days": {}, "last_click": None}


class BoardStats:
    def __init__(self, path):
        self.path = path
        self.data = {}          # id banner -> số liệu
        self._sets = {}         # id banner -> (set người xem, set người click) để tra nhanh
        self._recent = {}       # (id, did, loại) -> thời điểm tính gần nhất
        self._dirty_at = None
        self.load()

    def load(self):
        try:
            with open(self.path, encoding="utf-8") as f:
                raw = json.load(f)
        except FileNotFoundError:
            return
        except Exception:
            log.exception("Không đọc được %s", self.path)
            return
        for ad_id, st in (raw if isinstance(raw, dict) else {}).items():
            if isinstance(st, dict):
                self.data[ad_id] = {**_empty(), **st}

    def _entry(self, ad_id):
        st = self.data.get(ad_id)
        if st is None:
            st = self.data[ad_id] = _empty()
        if ad_id not in self._sets:
            self._sets[ad_id] = (set(st["viewers"]), set(st["clickers"]))
        return st

    def hit(self, ad_id, kind, did):
        """Ghi một lượt 'view' hoặc 'click'. Trả về True nếu được tính."""
        if kind not in ("view", "click"):
            return False
        did = did if isinstance(did, str) and _DID_RE.match(did) else ""
        now = time.time()
        if did:
            key = (ad_id, did, kind)
            if now - self._recent.get(key, 0) < (CLICK_REPEAT if kind == "click" else VIEW_REPEAT):
                return False
            self._recent[key] = now
            if len(self._recent) > 20000:
                cut = now - 60
                self._recent = {k: t for k, t in self._recent.items() if t > cut}
        st = self._entry(ad_id)
        day = time.strftime("%Y-%m-%d")
        d = st["days"].setdefault(day, [0, 0])
        i = 0 if kind == "view" else 1
        d[i] += 1
        if kind == "view":
            st["views"] += 1
            people, field = self._sets[ad_id][0], "viewers"
        else:
            st["clicks"] += 1
            st["last_click"] = now
            people, field = self._sets[ad_id][1], "clickers"
        if did and did not in people and len(people) < UNIQUE_CAP:
            people.add(did)
            st[field].append(did)
        if len(st["days"]) > DAYS_KEEP:
            for old in sorted(st["days"])[:-DAYS_KEEP]:
                del st["days"][old]
        self._dirty_at = self._dirty_at or now
        return True

    def drop(self, ad_id):
        if self.data.pop(ad_id, None) is not None:
            self._sets.pop(ad_id, None)
            self.save()

    def summary(self, ad_id, days=14):
        """Số liệu gọn cho bảng quản trị (không gửi danh sách mã trình duyệt)."""
        st = self.data.get(ad_id) or _empty()
        today = time.time()
        series = []
        for n in range(days - 1, -1, -1):
            day = time.strftime("%Y-%m-%d", time.localtime(today - n * 86400))
            v, c = st["days"].get(day, [0, 0])
            series.append({"day": day, "views": v, "clicks": c})
        week = series[-7:]
        return {
            "views": st["views"], "clicks": st["clicks"],
            "viewers": len(st["viewers"]), "clickers": len(st["clickers"]),
            "today": {"views": series[-1]["views"], "clicks": series[-1]["clicks"]},
            "week": {"views": sum(x["views"] for x in week), "clicks": sum(x["clicks"] for x in week)},
            "last_click": st["last_click"], "series": series,
        }

    def save(self):
        self._dirty_at = None
        tmp = self.path + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.data, f, ensure_ascii=False)
            os.replace(tmp, self.path)
        except OSError:
            log.exception("Không ghi được %s", self.path)

    def flush(self, force=False):
        """Gọi định kỳ: ghi file nếu có số liệu mới đã chờ quá SAVE_DELAY giây."""
        if self._dirty_at and (force or time.time() - self._dirty_at >= SAVE_DELAY):
            self.save()
