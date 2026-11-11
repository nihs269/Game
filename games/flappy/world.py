"""Thế giới Flappy: hằng số vật lý, đường bay (dãy ống + hộp vật phẩm) và va chạm.

Toạ độ theo “đơn vị thế giới”: màn hình cao H, mặt đất ở GROUND. Camera trôi sang phải với tốc độ tăng dần theo thời gian,
mọi con chim đứng ở cùng toạ độ ngang BIRD_X so với camera — nên ai cũng gặp cùng một ống vào cùng một lúc.
Trình duyệt dùng chung các hằng số này (gửi trong trạng thái) và đường bay (gửi một lần mỗi ván), máy chủ dùng để mô phỏng bot.
"""
import random

WORLD = {
    "H": 600, "GROUND": 540, "BIRD_X": 130, "R": 13,
    "G": 1600, "FLAP": -460, "MAXFALL": 650,
    "V0": 150, "VA": 1.2, "VMAX": 245,            # tốc độ trôi: V0 + VA·t, tối đa VMAX (đơn vị/giây)
    "FIRST": 720, "SPACING": 240, "PW": 72,      # ống đầu tiên, khoảng cách giữa hai ống, bề rộng ống
    "BOX_R": 17, "NARROW": 42,                   # bán kính hộp vật phẩm, ống hẹp lại bao nhiêu khi trúng 🧱
    "HEAVY": 1.4,                                # trọng lực ×1.4 khi trúng 🪨
    "ZAP": 380,                                  # ⚡ hất chim xuống với vận tốc này
}
GAP0, GAP_MIN, GAP_SHRINK = 180, 108, 0.75       # khe ống rộng dần hẹp lại theo số ống
MAX_STEP = 150                                   # tâm khe hai ống liền nhau lệch tối đa
BOX_CHANCE = 0.32
COURSE_LEN = 1000                                # ~16 phút bay ở tốc độ tối đa

W = WORLD
T_MAX = (W["VMAX"] - W["V0"]) / W["VA"]


def dist(t):
    """Quãng đường camera đã trôi sau t giây (t < 0: đang đếm ngược, camera đứng yên)."""
    if t <= 0:
        return 0.0
    if t <= T_MAX:
        return W["V0"] * t + W["VA"] * t * t / 2
    return W["V0"] * T_MAX + W["VA"] * T_MAX * T_MAX / 2 + W["VMAX"] * (t - T_MAX)


def pipe_x(i):
    return W["FIRST"] + i * W["SPACING"]


def make_course(seed):
    """Dãy ống [[tâm khe, độ rộng khe], …] và hộp vật phẩm {i: y} (hộp nằm giữa ống i và i+1)."""
    rng = random.Random(seed)
    pipes = []
    c = W["GROUND"] / 2
    for i in range(COURSE_LEN):
        gap = max(GAP_MIN, GAP0 - i * GAP_SHRINK)
        lo, hi = 55 + gap / 2, W["GROUND"] - 55 - gap / 2
        c = min(hi, max(lo, c + rng.uniform(-MAX_STEP, MAX_STEP)))
        pipes.append([round(c), round(gap)])
    boxes = {}
    for i in range(1, COURSE_LEN - 1):
        if rng.random() < BOX_CHANCE:
            y = (pipes[i][0] + pipes[i + 1][0]) / 2 + rng.uniform(-35, 35)
            boxes[i] = round(y)
    return pipes, boxes


def box_x(i):
    return pipe_x(i) + W["PW"] + (W["SPACING"] - W["PW"]) / 2


def passed(t):
    """Số ống đã bay qua tại thời điểm t."""
    bx = dist(t) + W["BIRD_X"] - W["R"]
    n = int((bx - W["FIRST"] - W["PW"]) // W["SPACING"]) + 1
    return max(0, min(COURSE_LEN, n))


def hits(pipes, t, y, narrow=False):
    """Chim ở độ cao y tại thời điểm t có đâm vào ống / mặt đất không."""
    r = W["R"]
    if y + r >= W["GROUND"]:
        return True
    bx = dist(t) + W["BIRD_X"]
    i0 = max(0, int((bx - r - W["FIRST"] - W["PW"]) // W["SPACING"]))
    for i in (i0, i0 + 1):
        if i >= len(pipes):
            continue
        x0 = pipe_x(i)
        x1 = x0 + W["PW"]
        if bx + r <= x0 or bx - r >= x1:
            continue
        c, gap = pipes[i]
        if narrow:
            gap -= W["NARROW"]
        top, bot = c - gap / 2, c + gap / 2
        # Hình tròn chạm hình chữ nhật: điểm gần nhất của ống so với tâm chim.
        nx = min(max(bx, x0), x1)
        if y - r < top:
            ny = min(y, top)
            if (bx - nx) ** 2 + (y - ny) ** 2 < r * r or y < top:
                return True
        if y + r > bot:
            ny = max(y, bot)
            if (bx - nx) ** 2 + (y - ny) ** 2 < r * r or y > bot:
                return True
    return False
