"""Sân và quả bóng: hằng số, bước mô phỏng bóng và va chạm bóng – người.

Toạ độ: x từ trái sang phải (0 … W), y tính từ mặt sân lên trên. Khung thành trái chiếm 0 … GOAL_D, khung thành phải
chiếm W − GOAL_D … W, cao GOAL_H; xà ngang là một thanh nằm ngang ở độ cao GOAL_H (bóng nảy được trên mái khung thành).
Người bên trái (side 0) tấn công sang phải (khung thành phải), người bên phải tấn công sang trái.

Máy chủ mô phỏng bóng (kể cả va vào người); trình duyệt dùng cùng hàm `step` (không có người) để vẽ bóng mượt giữa
hai gói tin.
"""
import math

WORLD = {
    "W": 1200, "CEIL": 760,
    "GOAL_D": 72, "GOAL_H": 210, "BAR": 6,       # bề sâu, chiều cao khung thành, nửa bề dày xà ngang
    "R": 22,                                     # bán kính bóng
    "G": 1500, "AIR": 0.12, "FRICTION": 1.6,     # trọng lực, cản không khí, ma sát lăn trên sân
    "REST": 0.68, "REST_WALL": 0.7, "REST_BAR": 0.6, "REST_BODY": 0.3,
    "PG": 2200, "SPEED": 430, "JUMP": 800,       # người: trọng lực, tốc độ chạy, lực nhảy
    "PX_MIN": 44, "PX_MAX": 1156,                # người không ra khỏi hai đầu sân
    "HEAD_Y": 100, "HEAD_R": 30,                 # vòng tròn đầu (tâm cao HEAD_Y so với chân)
    "BODY_Y": 44, "BODY_R": 27,                  # vòng tròn thân
    "FOOT_X": 30, "FOOT_Y": 18, "FOOT_R": 40,    # vùng chân sút (x theo hướng tấn công)
    "KICK": 0.28, "KICK_FROM": 0.02, "KICK_TO": 0.2,   # thời gian vung chân và khoảng chân chạm được bóng
    "BLOCK": 50,                                 # hai người không đứng gần nhau hơn mức này (khi cùng ở dưới đất)
}
W = WORLD

# Cú sút: vận tốc bóng (x theo hướng tấn công) + một phần vận tốc của người sút.
KICKS = {
    "shoot": {"vx": 1080, "vy": 330, "carry": 0.35},
    "lob": {"vx": 400, "vy": 1000, "carry": 0.2},
}


def step(b, dt):
    """Một bước mô phỏng bóng b = [x, y, vx, vy] (không tính người). Trả về True nếu bóng chạm xà / cột."""
    x, y, vx, vy = b
    R = W["R"]
    vy -= W["G"] * dt
    k = 1 - W["AIR"] * dt
    vx *= k
    vy *= k
    x += vx * dt
    y += vy * dt
    if y - R <= 0:
        y = R
        if vy < 0:
            vy = -vy * W["REST"]
            if vy < 70:
                vy = 0.0
        vx *= max(0.0, 1 - W["FRICTION"] * dt)
    if y + R > W["CEIL"]:
        y = W["CEIL"] - R
        vy = -abs(vy) * W["REST_WALL"]
    if x - R < 0:
        x = R
        vx = abs(vx) * W["REST_WALL"]
    elif x + R > W["W"]:
        x = W["W"] - R
        vx = -abs(vx) * W["REST_WALL"]
    hit = False
    # Xà ngang của hai khung thành: đoạn thẳng nằm ngang, bóng bật ra theo pháp tuyến.
    for x0, x1 in ((0, W["GOAL_D"]), (W["W"] - W["GOAL_D"], W["W"])):
        px = min(max(x, x0), x1)
        dx, dy = x - px, y - W["GOAL_H"]
        d2 = dx * dx + dy * dy
        rr = R + W["BAR"]
        if d2 < rr * rr:
            d = math.sqrt(d2) or 1e-6
            nx, ny = (dx / d, dy / d) if d2 > 1e-9 else (0.0, 1.0)
            x, y = px + nx * rr, W["GOAL_H"] + ny * rr
            vn = vx * nx + vy * ny
            if vn < 0:
                vx -= (1 + W["REST_BAR"]) * vn * nx
                vy -= (1 + W["REST_BAR"]) * vn * ny
                hit = abs(vn) > 120
            # Bóng nằm yên trên mái khung thành: đẩy nhẹ ra phía sân.
            if ny > 0.9 and abs(vx) < 40 and abs(vy) < 80:
                vx += (1 if x0 == 0 else -1) * 160
    b[0], b[1], b[2], b[3] = x, y, vx, vy
    return hit


def goal_side(b):
    """0 = bóng đã lọt hẳn khung thành trái (bên phải ghi bàn), 1 = khung thành phải, None = chưa."""
    x, y = b[0], b[1]
    if y < W["GOAL_H"]:
        if x + W["R"] * 0.2 < W["GOAL_D"]:
            return 0
        if x - W["R"] * 0.2 > W["W"] - W["GOAL_D"]:
            return 1
    return None


def collide(b, cx, cy, cr, pvx, pvy):
    """Bóng va vào vòng tròn (cx, cy, cr) của người đang chạy với vận tốc (pvx, pvy). Trả về True nếu chạm."""
    R = W["R"]
    dx, dy = b[0] - cx, b[1] - cy
    d2 = dx * dx + dy * dy
    rr = R + cr
    if d2 >= rr * rr:
        return False
    d = math.sqrt(d2)
    nx, ny = (dx / d, dy / d) if d > 1e-6 else (0.0, 1.0)
    b[0], b[1] = cx + nx * rr, max(R, cy + ny * rr)
    rvx, rvy = b[2] - pvx, b[3] - pvy
    vn = rvx * nx + rvy * ny
    if vn < 0:
        b[2] -= (1 + W["REST_BODY"]) * vn * nx
        b[3] -= (1 + W["REST_BODY"]) * vn * ny
    return True


def foot(x, y, face):
    return x + face * W["FOOT_X"], y + W["FOOT_Y"]


def kick_reaches(b, x, y, face, slack=0.0):
    fx, fy = foot(x, y, face)
    dx, dy = b[0] - fx, b[1] - fy
    rr = W["FOOT_R"] + W["R"] + slack
    return dx * dx + dy * dy <= rr * rr


def kick(b, kind, face, pvx, pvy):
    k = KICKS[kind]
    b[2] = face * k["vx"] + pvx * k["carry"]
    b[3] = k["vy"] + max(0.0, pvy) * 0.3
