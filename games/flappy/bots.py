"""Bot Flappy: máy chủ mô phỏng vật lý thật cho bot (cùng đường bay, cùng va chạm như người chơi).

Bot nhắm hơi thấp hơn tâm khe ống kế tiếp và vỗ cánh khi rơi xuống dưới mức đó. Thỉnh thoảng bot “run tay”
(bỏ vỗ cánh một lúc) — càng về sau, ống càng hẹp và càng nhanh thì càng dễ run. Trúng vật phẩm của đối thủ
(sương mù, đảo ngược…) bot cũng run tay nhiều hơn. Bot nhặt hộp vật phẩm khi bay qua và dùng sau vài giây.
"""
import random

from .world import WORLD as W, box_x, dist, hits

DT = 1 / 60
# Xác suất run tay mỗi ống: base + per·(số ống); thời gian run tay (giây); độ lệch khi ngắm.
LEVELS = {
    "easy": {"base": 0.07, "per": 0.0035, "slip": (0.3, 0.5), "aim": 16},
    "normal": {"base": 0.025, "per": 0.0016, "slip": (0.25, 0.45), "aim": 10},
    "hard": {"base": 0.01, "per": 0.0009, "slip": (0.22, 0.4), "aim": 6},
}
CONFUSE = {"fog": 0.25, "flip": 0.5, "splat": 0.15, "narrow": 0.12, "heavy": 0.1}


class BotBird:
    def __init__(self, level):
        self.lv = LEVELS[level]
        self.y = W["GROUND"] / 2
        self.vy = 0.0
        self.t = 0.0
        self.target_i = -1
        self.slip_until = -1.0
        self.cool = 0.0
        self.aim = 0.0
        self.use_at = None
        self.inv_until = -1.0

    def step(self, pipes, t_to, active):
        """Mô phỏng tới thời điểm t_to. `active(kind, t)` cho biết hiệu ứng nào đang tác động. Trả về True nếu chết."""
        while self.t + DT <= t_to:
            self.t += DT
            t = self.t
            flip = active("flip", t)
            g = W["G"] * (W["HEAVY"] if active("heavy", t) else 1)
            if flip:
                g = -g
            self._think(pipes, t, flip, active)
            self.vy += g * DT
            self.vy = max(-W["MAXFALL"], min(W["MAXFALL"], self.vy))
            self.y += self.vy * DT
            if self.y < -60:
                self.y, self.vy = -60, 0
            if t < self.inv_until and self.y + W["R"] >= W["GROUND"]:
                self.y, self.vy = W["GROUND"] - W["R"] - 1, W["FLAP"]
            if t >= self.inv_until and hits(pipes, t, self.y, active("narrow", t)):
                if active("shield", t, consume=True):
                    self.vy = W["FLAP"]
                    self.inv_until = t + 1.0      # khiên vỡ: bay xuyên ống thêm 1 giây
                    self.y = min(self.y, W["GROUND"] - W["R"] - 1)
                    continue
                return True
        return False

    def _think(self, pipes, t, flip, active):
        bx = dist(t) + W["BIRD_X"]
        i = max(0, int((bx - W["R"] - W["FIRST"] - W["PW"]) // W["SPACING"]) + 1)
        i = min(i, len(pipes) - 1)
        if i != self.target_i:
            self.target_i = i
            self.aim = random.uniform(-self.lv["aim"], self.lv["aim"])
            p = self.lv["base"] + self.lv["per"] * i
            p += sum(v for k, v in CONFUSE.items() if active(k, t))
            if random.random() < p:
                self.slip_until = t + random.uniform(*self.lv["slip"])
        self.cool -= DT
        if t < self.slip_until or self.cool > 0:
            return
        c, gap = pipes[i]
        if active("narrow", t):
            gap -= W["NARROW"]
        drop = min(30, gap * 0.22)
        if not flip and self.y > c + drop + self.aim and self.vy >= 0:
            self.vy, self.cool = W["FLAP"], 0.12
        elif flip and self.y < c - drop + self.aim and self.vy <= 0:
            self.vy, self.cool = -W["FLAP"], 0.12

    def touches_box(self, t, i, y):
        bx = dist(t) + W["BIRD_X"]
        reach = W["R"] + W["BOX_R"]
        return abs(bx - box_x(i)) < reach and abs(self.y - y) < reach
