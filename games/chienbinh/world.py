"""Bản đồ, vũ khí và vật lý dùng chung cho Chiến Binh Tí Hon.

Toạ độ: x sang phải, y hướng XUỐNG (giống canvas). Vị trí người chơi là điểm giữa bàn chân.
Bục là bục một chiều: nhảy xuyên từ dưới lên được, đứng trên đó bấm ↓ để rơi xuống.
Trình duyệt chạy đúng các công thức này (app.js) để người chơi điều khiển nhân vật của mình không bị trễ.
"""
import math

PHYS = {
    "G": 2300.0,        # trọng lực
    "RUN": 340.0,       # tốc độ chạy
    "JUMP": 930.0,      # vận tốc nhảy
    "MAXFALL": 1300.0,
    "HW": 20,           # nửa bề ngang thân
    "HH": 74,           # chiều cao thân (tới đỉnh đầu)
    "DROP": 0.28,       # bấm ↓ trên bục: bỏ qua bục trong chừng này giây
}

MAX_HP = 100
MAX_ARMOR = 50
RESPAWN = 3.0
SPAWN_SAFE = 1.6        # vừa hồi sinh: miễn sát thương trong chừng này giây

# name, dmg, cd (giây giữa 2 phát), speed, life (giây bay), spread (radian), pellets, ammo (None = vô hạn), splash, pierce
WEAPONS = {
    "pistol": {"name": "Súng lục", "icon": "🔫", "dmg": 14, "cd": 0.3, "speed": 1500, "life": 0.85, "spread": 0.03, "pellets": 1, "ammo": None},
    "smg": {"name": "Tiểu liên", "icon": "💨", "dmg": 8, "cd": 0.085, "speed": 1700, "life": 0.7, "spread": 0.08, "pellets": 1, "ammo": 60},
    "shotgun": {"name": "Shotgun", "icon": "💥", "dmg": 10, "cd": 0.8, "speed": 1450, "life": 0.3, "spread": 0.24, "pellets": 7, "ammo": 10},
    "sniper": {"name": "Bắn tỉa", "icon": "🎯", "dmg": 75, "cd": 1.3, "speed": 3400, "life": 0.85, "spread": 0.0, "pellets": 1, "ammo": 6},
    "rocket": {"name": "Rocket", "icon": "🚀", "dmg": 85, "cd": 1.1, "speed": 950, "life": 2.2, "spread": 0.0, "pellets": 1, "ammo": 4, "splash": 125},
    "laser": {"name": "Laser", "icon": "⚡", "dmg": 30, "cd": 0.45, "speed": 4200, "life": 0.5, "spread": 0.0, "pellets": 1, "ammo": 12, "pierce": True},
}
GRENADE = {"speed": 820, "g": 1800, "fuse": 1.4, "bounce": 0.45, "dmg": 85, "splash": 135, "max": 4}

# Vật phẩm rơi trên bản đồ: súng (kèm đạn) và đồ dùng.
ITEMS = {
    "smg": {"icon": "💨", "name": "Tiểu liên", "w": 22},
    "shotgun": {"icon": "💥", "name": "Shotgun", "w": 18},
    "sniper": {"icon": "🎯", "name": "Bắn tỉa", "w": 12},
    "rocket": {"icon": "🚀", "name": "Rocket", "w": 9},
    "laser": {"icon": "⚡", "name": "Laser", "w": 11},
    "medkit": {"icon": "❤️", "name": "Hộp cứu thương", "w": 18},
    "armor": {"icon": "🛡️", "name": "Áo giáp", "w": 12},
    "grenade": {"icon": "💣", "name": "Lựu đạn ×2", "w": 14},
}
ITEM_RESPAWN = 11.0
DROP_LIFE = 15.0        # súng rơi ra khi chết tồn tại chừng này giây
PICK_R = 38


def _mirror(w, half, center):
    plats = [list(p) for p in half] + [list(p) for p in center]
    plats += [[w - x - pw, y, pw] for x, y, pw in half]
    return plats


def _pts(w, half, center=()):
    """Điểm bên trái → nhân đôi sang phải: [x, y, team]."""
    out = [[x, y, 0] for x, y in half]
    out += [[w - x, y, 1] for x, y in half]
    out += [[x, y, -1] for x, y in center]
    return out


def _build(mid, name, theme, w, ground, half, center, spawns, items_half, items_center, base_y):
    return {
        "id": mid, "name": name, "theme": theme, "w": w, "h": ground + 80, "ground": ground,
        "plats": _mirror(w, half, center),
        "spawns": _pts(w, spawns),
        "items": [[x, y] for x, y, _ in _pts(w, items_half, items_center)],
        "bases": [[110, base_y], [w - 110, base_y]],
    }


MAPS = {
    "congtruong": _build(
        "congtruong", "Công Trường", "city", 2400, 920,
        half=[(70, 770, 250), (430, 785, 200), (760, 700, 180), (240, 625, 210), (560, 560, 220),
              (90, 470, 190), (380, 420, 200), (770, 430, 170), (560, 290, 200)],
        center=[(1060, 785, 280), (1090, 620, 220), (960, 430, 480), (1110, 260, 180)],
        spawns=[(60, 920), (170, 770), (260, 920), (180, 470), (330, 625)],
        items_half=[(530, 785), (670, 560), (480, 420), (650, 290), (300, 625)],
        items_center=[(1200, 920), (1200, 620), (1200, 430), (1200, 260)],
        base_y=920),
    "rungtre": _build(
        "rungtre", "Rừng Tre", "forest", 2600, 940,
        half=[(60, 800, 220), (360, 820, 160), (580, 740, 200), (150, 650, 200), (430, 600, 160),
              (680, 560, 200), (60, 500, 160), (300, 450, 220), (600, 400, 160), (820, 320, 200), (380, 290, 160)],
        center=[(1150, 820, 300), (980, 680, 240), (1380, 680, 240), (1180, 540, 240), (1050, 390, 500), (1200, 230, 200)],
        spawns=[(50, 940), (160, 800), (250, 650), (120, 500), (300, 940)],
        items_half=[(660, 740), (500, 600), (400, 450), (920, 320), (450, 290), (230, 940)],
        items_center=[(1300, 940), (1300, 540), (1300, 390), (1300, 230)],
        base_y=940),
}


def step_body(b, move, jump, drop, dt, mp, now):
    """Một bước vật lý cho người chơi. b: dict x, y, vx, vy, ground, drop_until. move ∈ {-1,0,1}.
    Trả về True nếu vừa chạm đất."""
    P = PHYS
    kx = b.get("kx", 0.0)          # bị đẩy lùi (trúng đạn / vụ nổ), giảm dần
    b["vx"] = move * P["RUN"] + kx
    b["kx"] = kx * max(0.0, 1 - 7 * dt) if abs(kx) > 5 else 0.0
    if jump and b["ground"]:
        b["vy"] = -P["JUMP"]
        b["ground"] = False
    if drop and b["ground"] and b["y"] < mp["ground"] - 1:
        b["drop_until"] = now + P["DROP"]
        b["ground"] = False
        b["y"] += 2
    b["vy"] = min(P["MAXFALL"], b["vy"] + P["G"] * dt)
    ox, oy = b["x"], b["y"]
    nx = max(P["HW"], min(mp["w"] - P["HW"], ox + b["vx"] * dt))
    ny = oy + b["vy"] * dt
    landed = False
    b["ground"] = False
    if b["vy"] >= 0:
        top = None
        if ny >= mp["ground"]:
            top = mp["ground"]
        if now >= b.get("drop_until", 0):
            for px, py, pw in mp["plats"]:
                if oy <= py + 0.5 and ny >= py and px - 6 <= nx <= px + pw + 6:
                    if top is None or py < top:
                        top = py
        if top is not None:
            ny = top
            landed = b["vy"] > 200
            b["vy"] = 0.0
            b["ground"] = True
    b["x"], b["y"] = nx, ny
    return landed


def on_platform(x, y, mp):
    """Đang đứng trên bục nào (không tính mặt đất)? Trả về bục hoặc None."""
    for p in mp["plats"]:
        px, py, pw = p
        if abs(y - py) < 1.5 and px - 6 <= x <= px + pw + 6:
            return p
    return None


def seg_hits_box(x0, y0, x1, y1, bx0, by0, bx1, by1):
    """Đoạn thẳng (x0,y0)→(x1,y1) có cắt hình chữ nhật không (Liang–Barsky). Trả về t ∈ [0,1] hoặc None."""
    dx, dy = x1 - x0, y1 - y0
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, x0 - bx0), (dx, bx1 - x0), (-dy, y0 - by0), (dy, by1 - y0)):
        if p == 0:
            if q < 0:
                return None
        else:
            r = q / p
            if p < 0:
                if r > t1:
                    return None
                t0 = max(t0, r)
            else:
                if r < t0:
                    return None
                t1 = min(t1, r)
    return t0


def dist(ax, ay, bx, by):
    return math.hypot(ax - bx, ay - by)
