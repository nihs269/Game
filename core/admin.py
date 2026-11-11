"""Mã đặc quyền: người chơi nhập mã ở sảnh để mở thêm chức năng.

Mã và danh sách game bị ẩn lưu trong `admin.json` ở thư mục gốc. Lần chạy đầu tiên tự tạo
mã admin `trouble` (in ra màn hình khi khởi động).
"""
import copy
import json
import logging
import os
import random
import re
import time

log = logging.getLogger("gamehub")

# Các quyền một vai trò có thể có (tên hiển thị trong bảng quản trị).
PERMS = {
    "hidden": "Thấy & chơi game đang ẩn",
    "rooms": "Đóng phòng bất kỳ",
    "announce": "Gửi thông báo tới mọi người",
    "games": "Ẩn / hiện game",
    "codes": "Quản lý mã & vai trò",
    "ads": "Đặt banner quảng cáo",
}
# Vai trò mặc định (lần chạy đầu). Admin tự thêm / sửa / xoá vai trò trong bảng quản trị;
# riêng vai trò “admin” không xoá được và luôn có đủ mọi quyền.
ROLES = {
    "admin": {"label": "Quản trị viên", "icon": "👑", "perms": ["hidden", "rooms", "announce", "games", "codes", "ads"]},
    "mod": {"label": "Điều hành viên", "icon": "🛡️", "perms": ["hidden", "rooms", "announce"]},
    "vip": {"label": "VIP", "icon": "⭐", "perms": ["hidden"]},
}
ROLE_MAX = 30
FIRST_ADMIN_CODE = "TROUBLE"  # mã không phân biệt hoa/thường
CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_CODE_RE = re.compile(r"^[A-Z0-9]{4,24}$")
REDEEM_LIMIT = 10      # số lần nhập sai tối đa…
REDEEM_WINDOW = 60     # …trong 60 giây, mỗi địa chỉ IP

# Vị trí banner quảng cáo ở trang chủ: tên hiển thị + kích thước gợi ý (px).
AD_SLOTS = {
    "top": {"label": "Giữa — dải trên cùng", "size": "980 × 120"},
    "left": {"label": "Trái — cột bên trái", "size": "300 × 600"},
    "right": {"label": "Phải — cột bên phải", "size": "300 × 600"},
}
AD_MEDIA_URL = "/media/hb/"     # tên trung tính: đường dẫn có “ads” bị trình chặn quảng cáo chặn
_AD_IMAGE_RE = re.compile(r"^(https?://\S{3,490}|/media/hb/[A-Za-z0-9_-]{1,40}\.(png|jpg|gif|webp))$")
_AD_LINK_RE = re.compile(r"^https?://\S{3,490}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def clean_ad(data):
    """Kiểm tra thông tin một banner. Trả về dict sạch, hoặc báo ValueError."""
    if not isinstance(data, dict):
        raise ValueError("Dữ liệu không hợp lệ.")
    slot = str(data.get("slot") or "")
    if slot not in AD_SLOTS:
        raise ValueError("Hãy chọn vị trí hiển thị.")
    image = str(data.get("image") or "").strip()
    if image.startswith("/ads-media/"):         # ảnh lưu từ bản trước
        image = AD_MEDIA_URL + image[len("/ads-media/"):]
    link = str(data.get("link") or "").strip()
    note = " ".join(str(data.get("note") or "").split())[:200]
    until = str(data.get("until") or "").strip()
    if not image:
        raise ValueError("Hãy chọn ảnh banner (tải lên hoặc dán địa chỉ ảnh).")
    if not _AD_IMAGE_RE.match(image):
        raise ValueError("Địa chỉ ảnh phải bắt đầu bằng http:// hoặc https://")
    if link and not _AD_LINK_RE.match(link):
        raise ValueError("Liên kết phải bắt đầu bằng http:// hoặc https://")
    if until and not _DATE_RE.match(until):
        raise ValueError("Ngày hết hạn không hợp lệ.")
    return {"slot": slot, "image": image, "link": link, "note": note, "until": until,
            "enabled": bool(data.get("enabled", True))}


def clean_role(data):
    """Kiểm tra thông tin một vai trò: {label, icon, perms}. Trả về dict sạch, hoặc báo ValueError."""
    if not isinstance(data, dict):
        raise ValueError("Dữ liệu không hợp lệ.")
    label = " ".join(str(data.get("label") or "").split())[:24]
    icon = "".join(str(data.get("icon") or "").split())[:8] or "🏷️"
    perms = data.get("perms") or []
    if not label:
        raise ValueError("Hãy nhập tên vai trò.")
    if not isinstance(perms, list):
        raise ValueError("Danh sách quyền không hợp lệ.")
    return {"label": label, "icon": icon, "perms": [k for k in PERMS if k in perms]}


def clean_code(value):
    return re.sub(r"[\s-]+", "", str(value or "")).upper()[:24]


def random_code(length=8):
    return "".join(random.choice(CODE_CHARS) for _ in range(length))


class AdminStore:
    def __init__(self, path):
        self.path = path
        self.codes = {}     # MÃ -> {"role", "note", "created"}
        self.roles = copy.deepcopy(ROLES)    # id vai trò -> {"label", "icon", "perms"}
        self.hidden = set()  # id game đang ẩn
        self.ads = []       # banner: {"id", "slot", "image", "link", "note", "until", "enabled", "created"}
        self.failures = {}  # ip -> [thời điểm nhập sai]
        self.load()
        if not any(c["role"] == "admin" for c in self.codes.values()):
            self.codes[FIRST_ADMIN_CODE] = {"role": "admin", "note": "Mã admin đầu tiên", "created": time.time()}
            self.save()

    def load(self):
        try:
            with open(self.path, encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            return
        except Exception:
            log.exception("Không đọc được %s", self.path)
            return
        roles = data.get("roles")
        if isinstance(roles, dict) and roles:
            self.roles = {}
            for rid, info in roles.items():
                try:
                    self.roles[str(rid)[:16]] = clean_role(info)
                except ValueError:
                    log.warning("Bỏ qua vai trò không hợp lệ trong %s", self.path)
            self.roles.setdefault("admin", copy.deepcopy(ROLES["admin"]))
        self.roles["admin"]["perms"] = list(PERMS)
        for code, info in (data.get("codes") or {}).items():
            code = clean_code(code)
            if isinstance(info, str):
                info = {"role": info}
            if _CODE_RE.match(code) and isinstance(info, dict) and info.get("role") in self.roles:
                self.codes[code] = {"role": info["role"], "note": str(info.get("note", ""))[:60],
                                    "created": info.get("created") or time.time()}
        self.hidden = {str(g) for g in data.get("hidden") or []}
        ads = data.get("ads") or []
        if isinstance(ads, dict):       # dạng cũ: {vị trí: banner}
            ads = [{**ad, "slot": slot} for slot, ad in ads.items() if isinstance(ad, dict)]
        for ad in ads:
            try:
                clean = clean_ad(ad)
            except ValueError:
                log.warning("Bỏ qua banner không hợp lệ trong %s", self.path)
                continue
            clean["id"] = str(ad.get("id") or "") or random_code(6)
            clean["created"] = ad.get("created") or time.time()
            self.ads.append(clean)

    def save(self):
        data = {"roles": self.roles, "codes": self.codes, "hidden": sorted(self.hidden), "ads": self.ads}
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.path)

    # ---------------------------------------------------------------- tra quyền
    def role_of(self, code):
        info = self.codes.get(clean_code(code))
        return info["role"] if info else None

    def perms_of(self, code):
        role = self.role_of(code)
        return set(self.roles[role]["perms"]) if role in self.roles else set()

    def describe(self, code):
        role = self.role_of(code)
        if role not in self.roles:
            return None
        r = self.roles[role]
        return {"role": role, "label": r["label"], "icon": r["icon"], "perms": r["perms"]}

    def too_many_failures(self, ip):
        now = time.time()
        recent = [t for t in self.failures.get(ip, []) if now - t < REDEEM_WINDOW]
        self.failures[ip] = recent
        return len(recent) >= REDEEM_LIMIT

    def record_failure(self, ip):
        self.failures.setdefault(ip, []).append(time.time())
        if len(self.failures) > 5000:
            self.failures.clear()

    # ---------------------------------------------------------------- thay đổi
    def set_hidden(self, game_id, hidden):
        if hidden:
            self.hidden.add(game_id)
        else:
            self.hidden.discard(game_id)
        self.save()

    def add_code(self, role, code="", note=""):
        if role not in self.roles:
            raise ValueError("Vai trò không tồn tại.")
        code = clean_code(code)
        if code:
            if not _CODE_RE.match(code):
                raise ValueError("Mã gồm 4–24 chữ cái hoặc chữ số.")
            if code in self.codes:
                raise ValueError("Mã này đã tồn tại.")
        else:
            code = random_code()
            while code in self.codes:
                code = random_code()
        self.codes[code] = {"role": role, "note": " ".join(str(note or "").split())[:60], "created": time.time()}
        self.save()
        return code

    def delete_code(self, code):
        code = clean_code(code)
        info = self.codes.get(code)
        if info is None:
            raise ValueError("Mã không tồn tại.")
        if info["role"] == "admin" and sum(1 for c in self.codes.values() if c["role"] == "admin") <= 1:
            raise ValueError("Phải giữ lại ít nhất một mã admin.")
        del self.codes[code]
        self.save()

    def list_codes(self):
        return [{"code": c, "role": i["role"], "label": self.roles[i["role"]]["label"], "icon": self.roles[i["role"]]["icon"],
                 "note": i["note"], "created": i["created"]}
                for c, i in sorted(self.codes.items(), key=lambda kv: kv[1]["created"]) if i["role"] in self.roles]

    # ---------------------------------------------------------------- vai trò
    def list_roles(self):
        count = {}
        for info in self.codes.values():
            count[info["role"]] = count.get(info["role"], 0) + 1
        return [{"role": rid, **r, "codes": count.get(rid, 0), "locked": rid == "admin"} for rid, r in self.roles.items()]

    def save_role(self, data, role_id=None):
        """Tạo vai trò mới (role_id rỗng) hoặc sửa vai trò có sẵn."""
        clean = clean_role(data)
        if any(r["label"].lower() == clean["label"].lower() for rid, r in self.roles.items() if rid != role_id):
            raise ValueError("Đã có vai trò cùng tên.")
        if role_id:
            if role_id not in self.roles:
                raise ValueError("Vai trò không tồn tại (có thể đã bị xoá).")
            if role_id == "admin":
                clean["perms"] = list(PERMS)       # admin luôn đủ quyền
            self.roles[role_id] = clean
        else:
            if len(self.roles) >= ROLE_MAX:
                raise ValueError("Đã có quá nhiều vai trò — hãy xoá bớt.")
            role_id = "r" + random_code(5).lower()
            while role_id in self.roles:
                role_id = "r" + random_code(5).lower()
            self.roles[role_id] = clean
        self.save()
        return role_id

    def delete_role(self, role_id):
        if role_id == "admin":
            raise ValueError("Không xoá được vai trò Quản trị viên.")
        if role_id not in self.roles:
            raise ValueError("Vai trò không tồn tại.")
        n = sum(1 for c in self.codes.values() if c["role"] == role_id)
        if n:
            raise ValueError(f"Còn {n} mã đang dùng vai trò này — hãy xoá các mã đó trước.")
        del self.roles[role_id]
        self.save()

    # ---------------------------------------------------------------- banner quảng cáo
    def _find_ad(self, ad_id):
        for ad in self.ads:
            if ad["id"] == ad_id:
                return ad
        raise ValueError("Banner không tồn tại (có thể đã bị xoá).")

    def save_ad(self, data, ad_id=None):
        """Tạo banner mới (ad_id rỗng) hoặc sửa banner có sẵn. Trả về (banner, ảnh cũ đã bị thay hoặc None)."""
        clean = clean_ad(data)
        if ad_id:
            ad = self._find_ad(ad_id)
            old = ad["image"]
            ad.update(clean)
        else:
            if len(self.ads) >= 60:
                raise ValueError("Đã có quá nhiều banner — hãy xoá bớt.")
            ids = {a["id"] for a in self.ads}
            new_id = random_code(6)
            while new_id in ids:
                new_id = random_code(6)
            ad = {**clean, "id": new_id, "created": time.time()}
            self.ads.append(ad)
            old = None
        self.save()
        return ad, (old if old and old != ad["image"] else None)

    def set_ad_enabled(self, ad_id, enabled):
        self._find_ad(ad_id)["enabled"] = bool(enabled)
        self.save()

    def delete_ad(self, ad_id):
        ad = self._find_ad(ad_id)
        self.ads.remove(ad)
        self.save()
        return ad["image"]

    def image_in_use(self, image):
        return any(ad["image"] == image for ad in self.ads)

    @staticmethod
    def ad_running(ad, today=None):
        return ad["enabled"] and (not ad["until"] or ad["until"] >= (today or time.strftime("%Y-%m-%d")))

    def public_ads(self):
        """Banner đang chạy, theo vị trí: {top|left|right: [{image, link, note}, …]} — vị trí trống thì không có."""
        today = time.strftime("%Y-%m-%d")
        out = {}
        for ad in self.ads:
            if self.ad_running(ad, today):
                out.setdefault(ad["slot"], []).append({"id": ad["id"], "image": ad["image"], "link": ad["link"], "note": ad["note"]})
        return out

    def list_ads(self):
        today = time.strftime("%Y-%m-%d")
        return [{**ad, "running": self.ad_running(ad, today)} for ad in self.ads]
