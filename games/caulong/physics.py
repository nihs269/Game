"""Sân và quả cầu: hằng số, đường bay của cầu và cách tính cú đánh.

Toạ độ: x từ trái sang phải (0 … W), y tính từ mặt sân lên trên. Lưới ở giữa x = NET_X.
Người bên trái (side 0) đánh sang phải, người bên phải (side 1) đánh sang trái.

Quả cầu chịu trọng lực + lực cản không khí tỉ lệ bình phương vận tốc nên bay nhanh lúc đầu rồi chậm dần, rơi gần
như thẳng đứng — giống cầu thật. Đường bay tính bằng các bước cố định DT; trình duyệt dùng ĐÚNG công thức này
(cùng thứ tự phép tính trên số thực 64-bit) nên mọi máy thấy cùng một đường bay chỉ từ điểm xuất phát + vận tốc.
"""
import math

WORLD = {
    "W": 1200, "NET_X": 600, "NET_H": 150,
    "LINE_L": 60, "LINE_R": 1140,               # vạch cuối sân; cầu rơi ngoài hai vạch này là ra ngoài
    "G": 760, "K": 0.0016, "DT": 1 / 120,       # trọng lực, hệ số cản, bước mô phỏng của cầu
    "PG": 2100, "SPEED": 500, "JUMP": 700,      # người: trọng lực, tốc độ chạy, lực nhảy
    "PW": 26, "MARGIN": 22,                     # nửa bề ngang người; người không được sát lưới hơn MARGIN
    "REACH_X": 26, "REACH_Y": 104, "REACH_R": 92,   # tâm vùng vợt (so với chân, x theo hướng mặt) và bán kính
    "SMASH_Y": 215,                             # cầu phải cao hơn mức này mới đập được
    "SWING": 0.3, "HIT_FROM": 0.03, "HIT_TO": 0.22,   # thời gian vung vợt và khoảng vợt chạm được cầu
    "SERVE_Y": 92,
    "MAX_T": 8.0,
    "LOW_Y": 70,                                # cầu thấp hơn mức này: phông / đập đều thành “vớt cầu” (lift)
    "TOL": 40,                                  # điểm rơi lệch mong muốn không quá chừng này là được
}
W = WORLD

# Cú đánh. Kiểu "ang": giữ góc bắn ưa thích, dò tốc độ (trong khoảng spd) để cầu rơi đúng độ sâu mong muốn; nếu góc đó
# mắc lưới thì thử dần các góc lân cận. Kiểu "spd": giữ tốc độ, dò góc (đập cầu / tạt cầu luôn mạnh).
# depth: độ sâu mong muốn, tính bằng tỉ lệ từ lưới tới vạch cuối sân đối thủ; aim: độ chỉnh khi giữ phím tiến / lùi.
SHOTS = {
    "clear": {"ang": 44, "spd": (500, 3200), "depth": 0.88, "aim": 0.08},
    "lift": {"ang": 50, "spd": (500, 3200), "depth": 0.82, "aim": 0.1},       # vớt cầu thấp lên cao
    "drop": {"ang": 12, "spd": (150, 1600), "depth": 0.2, "aim": 0.1},
    "serve_long": {"ang": 50, "spd": (400, 3000), "depth": 0.85, "aim": 0.06},
    "serve_short": {"ang": 25, "spd": (150, 1400), "depth": 0.18, "aim": 0.05},
    "smash": {"spd": 2300, "a0": -40, "a1": 6, "depth": 0.55, "aim": 0.25},
    "drive": {"spd": 1500, "a0": -4, "a1": 36, "depth": 0.65, "aim": 0.15},
}


def trajectory(x, y, vx, vy):
    """Đường bay từ (x, y) với vận tốc (vx, vy) cho tới khi chạm đất (hoặc hết MAX_T).

    Trả về (pts, net): pts = [(x, y), …] mỗi DT một điểm, điểm cuối là lúc chạm đất; net = True nếu cầu mắc lưới
    (khi đó cầu rơi xuống ngay bên phía người đánh).
    """
    g, k, dt, nx, nh = W["G"], W["K"], W["DT"], W["NET_X"], W["NET_H"]
    pts = [(x, y)]
    net = False
    steps = int(W["MAX_T"] / dt)
    for _ in range(steps):
        v = math.sqrt(vx * vx + vy * vy)
        vx = vx - k * v * vx * dt
        vy = vy - (g + k * v * vy) * dt
        px = x
        x = x + vx * dt
        y = y + vy * dt
        if not net and (px - nx) * (x - nx) <= 0 and px != x and y < nh:
            # Mắc lưới: cầu bật nhẹ lại rồi rơi xuống phía người đánh.
            net = True
            back = -1 if px < nx else 1
            x = nx + back * 3
            vx = back * abs(vx) * 0.08
            vy = min(vy, 0.0) * 0.3
        if y <= 0:
            pts.append((x, 0.0))
            break
        pts.append((x, y))
    return pts, net


def pos_at(pts, dt_since):
    """Vị trí cầu sau dt_since giây kể từ lúc bắn (nội suy giữa hai điểm)."""
    if dt_since <= 0:
        return pts[0]
    f = dt_since / W["DT"]
    i = int(f)
    if i >= len(pts) - 1:
        return pts[-1]
    a, b = pts[i], pts[i + 1]
    u = f - i
    return (a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u)


def shot_kind(kind, cy, serve=False):
    """Đổi cú bấm thành cú đánh thật theo độ cao chạm cầu."""
    if serve:
        return "serve_short" if kind == "drop" else "serve_long"
    if kind == "smash":
        if cy >= W["SMASH_Y"]:
            return "smash"
        return "drive" if cy >= W["LOW_Y"] else "lift"
    if kind == "clear":
        return "clear" if cy >= W["LOW_Y"] else "lift"
    return "drop"


def _land(cx, cy, vx, vy):
    """(điểm rơi x, mắc lưới?)"""
    pts, net = trajectory(cx, cy, vx, vy)
    return pts[-1][0], net


def solve(kind, side, cx, cy, aim=0):
    """Vận tốc bắn (vx, vy) cho cú đánh `kind` của người bên `side` chạm cầu ở (cx, cy).

    aim: -1 = giữ phím lùi (đánh ngắn hơn), 1 = giữ phím tiến (đánh sâu hơn).
    """
    s = SHOTS[kind]
    d = 1 if side == 0 else -1
    nx = W["NET_X"]
    half = nx - W["LINE_L"]
    depth = max(0.06, min(0.98, s["depth"] + s["aim"] * aim))
    target = depth * half                      # khoảng cách mong muốn từ lưới tới điểm rơi (phía đối thủ)

    def over(lx, net):
        """Điểm rơi tính theo khoảng cách qua lưới về phía đối thủ (mắc lưới / rơi bên mình = âm)."""
        return -1.0 if net else (lx - nx) * d

    best = None                                # (sai lệch, vx, vy)
    if "ang" in s:
        lo_s, hi_s = s["spd"]
        for k in range(17):
            a = math.radians(s["ang"] + 4 * ((k + 1) // 2) * (1 if k % 2 else -1))
            ca, sa = math.cos(a), math.sin(a)
            if over(*_land(cx, cy, d * hi_s * ca, hi_s * sa)) <= 0:
                continue                       # góc này mạnh nhất cũng không qua lưới
            lo, hi = lo_s, hi_s
            for _ in range(14):
                mid = (lo + hi) / 2
                if over(*_land(cx, cy, d * mid * ca, mid * sa)) < target:
                    lo = mid
                else:
                    hi = mid
            err = abs(over(*_land(cx, cy, d * hi * ca, hi * sa)) - target)
            if best is None or err < best[0]:
                best = (err, d * hi * ca, hi * sa)
            if err <= W["TOL"]:
                break
    else:
        for i in range(41):
            a = math.radians(s["a0"] + (s["a1"] - s["a0"]) * i / 40)
            vx, vy = d * s["spd"] * math.cos(a), s["spd"] * math.sin(a)
            o = over(*_land(cx, cy, vx, vy))
            if o <= 0:
                continue
            err = abs(o - target)
            if best is None or err < best[0] - 0.5:
                best = (err, vx, vy)
    if best is None or (best[0] > 3 * W["TOL"] and kind != "lift"):
        return solve("lift", side, cx, cy, aim)   # không đánh được kiểu này — vớt cầu lên cao
    return best[1], best[2]


def reach_center(x, y, face):
    return x + face * W["REACH_X"], y + W["REACH_Y"]
