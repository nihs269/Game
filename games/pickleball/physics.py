"""Sân và quả bóng pickleball: hằng số, đường bay (có nảy), phân xử điểm rơi và cách tính cú đánh.

Toạ độ: x từ trái sang phải (0 … W), y tính từ mặt sân lên trên. Lưới ở giữa x = NET_X, thấp (ngang hông người).
Hai bên lưới là vùng cấm vô lê (“bếp”, kitchen) rộng KITCHEN. Người bên trái (side 0) đánh sang phải.

Bóng nhựa chịu trọng lực + chút lực cản không khí, chạm sân thì nảy lên (mất bớt vận tốc). Đường bay tính bằng
các bước cố định DT tới lần nảy thứ hai; trình duyệt dùng ĐÚNG công thức này (cùng thứ tự phép tính trên số thực
64-bit) nên mọi máy thấy cùng một đường bay chỉ từ điểm xuất phát + vận tốc.
"""
import math

WORLD = {
    "W": 1200, "NET_X": 600, "NET_H": 70,
    "LINE_L": 60, "LINE_R": 1140,               # vạch cuối sân; bóng nảy lần đầu ngoài hai vạch này là ra ngoài
    "KITCHEN": 170,                             # bề rộng vùng bếp mỗi bên lưới
    "G": 1300, "K": 0.0004, "DT": 1 / 120,      # trọng lực, hệ số cản, bước mô phỏng của bóng
    "BOUNCE": 0.74, "ROLL": 0.86,               # nảy: giữ lại bấy nhiêu vận tốc dọc / ngang
    "PG": 2100, "SPEED": 470, "JUMP": 640,      # người: trọng lực, tốc độ chạy, lực nhảy
    "PW": 26, "MARGIN": 22,                     # nửa bề ngang người; người không được sát lưới hơn MARGIN
    "REACH_X": 30, "REACH_Y": 70, "REACH_R": 76,   # tâm vùng vợt (so với chân, x theo hướng mặt) và bán kính
    "SMASH_Y": 170,                             # bóng cao hơn mức này thì cú đánh mạnh thành cú đập
    "SWING": 0.26, "HIT_FROM": 0.03, "HIT_TO": 0.2,   # thời gian vung vợt và khoảng vợt chạm được bóng
    "SERVE_Y": 48,                              # giao bóng thấp tay
    "MAX_T": 6.0,
    "TOL": 30,                                  # điểm rơi lệch mong muốn không quá chừng này là được
}
W = WORLD

# Cú đánh. Kiểu "ang": giữ góc bắn ưa thích, dò tốc độ để bóng nảy lần đầu đúng độ sâu mong muốn; góc đó mắc lưới
# thì thử dần các góc lân cận. Kiểu "spd": giữ tốc độ, dò góc (đánh mạnh / đập luôn nhanh).
# depth: độ sâu mong muốn tính bằng tỉ lệ từ lưới tới vạch cuối sân đối thủ; aim: độ chỉnh khi giữ phím tiến / lùi.
SHOTS = {
    "drive": {"spd": 1250, "a0": -14, "a1": 40, "depth": 0.78, "aim": 0.14},
    "smash": {"spd": 1700, "a0": -55, "a1": 4, "depth": 0.55, "aim": 0.25},
    "lob": {"ang": 58, "spd": (300, 2200), "depth": 0.86, "aim": 0.07},
    "dink": {"ang": 42, "spd": (120, 1400), "depth": 0.17, "aim": 0.08},
    "serve_long": {"ang": 34, "spd": (300, 2000), "depth": 0.84, "aim": 0.06},
    "serve_short": {"ang": 34, "spd": (300, 2000), "depth": 0.48, "aim": 0.06},
}


def trajectory(x, y, vx, vy):
    """Đường bay từ (x, y) với vận tốc (vx, vy) tới lần nảy thứ hai (hoặc bay khỏi sân / hết MAX_T).

    Trả về (pts, net, b1): pts = [(x, y), …] mỗi DT một điểm; net = True nếu bóng mắc lưới (khi đó bóng rơi xuống
    ngay bên phía người đánh); b1 = chỉ số điểm nảy lần đầu trong pts (None nếu bóng chưa chạm sân).
    """
    g, k, dt, nx, nh = W["G"], W["K"], W["DT"], W["NET_X"], W["NET_H"]
    pts = [(x, y)]
    net = False
    b1 = None
    steps = int(W["MAX_T"] / dt)
    for _ in range(steps):
        v = math.sqrt(vx * vx + vy * vy)
        vx = vx - k * v * vx * dt
        vy = vy - (g + k * v * vy) * dt
        px = x
        x = x + vx * dt
        y = y + vy * dt
        if not net and (px - nx) * (x - nx) <= 0 and px != x and y < nh:
            # Mắc lưới: bóng bật nhẹ lại rồi rơi xuống phía người đánh.
            net = True
            back = -1 if px < nx else 1
            x = nx + back * 4
            vx = back * abs(vx) * 0.1
            vy = min(vy, 0.0) * 0.3
        if y <= 0:
            pts.append((x, 0.0))
            if b1 is not None:
                break
            b1 = len(pts) - 1
            vy = -vy * W["BOUNCE"]
            vx = vx * W["ROLL"]
            y = 0.0
            continue
        pts.append((x, y))
        if x < -150 or x > W["W"] + 150:
            break
    return pts, net, b1


def judge(pts, net, b1, side, serve):
    """Phân xử cú đánh của bên `side` theo lần nảy đầu: None = bóng tốt (đối thủ phải đỡ trước lần nảy thứ hai),
    hoặc lý do người đánh mất điểm: "net" | "short" | "out" | "kitchen"."""
    nx = W["NET_X"]
    if net:
        return "net"
    if b1 is None:
        return "out"
    x = pts[b1][0]
    if (x < nx) == (side == 0):
        return "short"
    if x < W["LINE_L"] or x > W["LINE_R"]:
        return "out"
    if serve and abs(x - nx) < W["KITCHEN"]:
        return "kitchen"
    return None


def pos_at(pts, dt_since):
    """Vị trí bóng sau dt_since giây kể từ lúc đánh (nội suy giữa hai điểm)."""
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
    """Đổi cú bấm thành cú đánh thật theo độ cao chạm bóng."""
    if serve:
        return "serve_short" if kind == "dink" else "serve_long"
    if kind == "drive":
        return "smash" if cy >= W["SMASH_Y"] else "drive"
    return kind


def in_kitchen(x):
    return abs(x - W["NET_X"]) < W["KITCHEN"]


def _land(cx, cy, vx, vy):
    """(điểm nảy đầu x, mắc lưới?) — bóng bay khỏi sân mà chưa nảy thì lấy điểm cuối."""
    pts, net, b1 = trajectory(cx, cy, vx, vy)
    return pts[b1 if b1 is not None else -1][0], net


def solve(kind, side, cx, cy, aim=0):
    """Vận tốc (vx, vy) cho cú đánh `kind` của người bên `side` chạm bóng ở (cx, cy).

    aim: -1 = giữ phím lùi (đánh ngắn hơn), 1 = giữ phím tiến (đánh sâu hơn).
    """
    s = SHOTS[kind]
    d = 1 if side == 0 else -1
    nx = W["NET_X"]
    half = nx - W["LINE_L"]
    depth = max(0.06, min(0.98, s["depth"] + s["aim"] * aim))
    target = depth * half                      # khoảng cách mong muốn từ lưới tới điểm nảy (phía đối thủ)

    def over(lx, net):
        """Điểm nảy tính theo khoảng cách qua lưới về phía đối thủ (mắc lưới / rơi bên mình = âm)."""
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
        # Không đánh trúng chỗ với lực tối đa (bóng thấp sát lưới…) thì đánh nhẹ tay dần.
        for f in (1.0, 0.85, 0.7):
            spd = s["spd"] * f
            for i in range(41):
                a = math.radians(s["a0"] + (s["a1"] - s["a0"]) * i / 40)
                vx, vy = d * spd * math.cos(a), spd * math.sin(a)
                o = over(*_land(cx, cy, vx, vy))
                if o <= 0:
                    continue
                err = abs(o - target)
                if best is None or err < best[0] - 0.5:
                    best = (err, vx, vy)
            if best is not None and best[0] <= 3 * W["TOL"]:
                break
    if best is None or (best[0] > 3 * W["TOL"] and kind != "lob"):
        return solve("lob", side, cx, cy, aim)   # không đánh được kiểu này — lốp bóng lên
    return best[1], best[2]


def reach_center(x, y, face):
    return x + face * W["REACH_X"], y + W["REACH_Y"]
