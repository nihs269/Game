"""Bot Đá Bóng: máy chủ mô phỏng người chơi ảo bằng đúng luật di chuyển như trình duyệt.

Bot dự đoán bóng sẽ ở đâu sau một khoảng phản xạ, chạy ra sau quả bóng (phía khung thành nhà) để đẩy bóng về phía
khung thành đối thủ, nhảy đánh đầu khi bóng bổng tới gần, sút khi bóng nằm trong tầm chân. Bóng ở xa bên kia sân thì
lùi về giữ khung thành. Bot dễ phản xạ chậm, chạy chậm, hay sút hụt; bot khó đọc bóng tốt và hay lốp bóng.
"""
import random

from .physics import WORLD as W, kick_reaches, step

LEVELS = {
    "easy": {"react": 0.32, "speed": 0.72, "miss": 0.35, "lob": 0.15, "jump": 0.35, "err": 30},
    "normal": {"react": 0.2, "speed": 0.88, "miss": 0.18, "lob": 0.3, "jump": 0.6, "err": 16},
    "hard": {"react": 0.1, "speed": 1.0, "miss": 0.06, "lob": 0.4, "jump": 0.85, "err": 6},
}


class BotPlayer:
    def __init__(self, level, side):
        self.lv = LEVELS[level]
        self.side = side
        self.face = 1 if side == 0 else -1
        self.goal_x = W["GOAL_D"] if side == 0 else W["W"] - W["GOAL_D"]   # khung thành nhà
        self.reset(300 if side == 0 else 900)

    def reset(self, x):
        self.x, self.y, self.vx, self.vy = float(x), 0.0, 0.0, 0.0
        self.state = "idle"
        self.kick_at = None
        self.kind = ""
        self.elapsed = 0.0
        self.next_think = 0.0
        self.target = x
        self.want_jump = False
        self.hop = False
        self.err = 0.0

    def _predict(self, ball, t):
        b = list(ball)
        n = int(t / (1 / 60))
        for _ in range(n):
            step(b, 1 / 60)
        return b

    def _think(self, now, ball, opp):
        lv = self.lv
        b = self._predict(ball, lv["react"])
        bx, by = b[0], b[1]
        home = self.goal_x + self.face * 150
        on_my_half = (bx < W["W"] / 2) if self.side == 0 else (bx > W["W"] / 2)
        if random.random() < 0.15:
            self.err = random.uniform(-lv["err"], lv["err"])
        # Đứng sau bóng (về phía khung thành nhà) để đẩy bóng đi đúng hướng.
        behind = bx - self.face * 34
        cx, cy = ball[0], ball[1]          # vị trí bóng lúc này (bx, by là vị trí đoán sau khoảng phản xạ)
        on_head = abs(cx - self.x) < 60 and cy > self.y + W["HEAD_Y"]
        ball_behind_me = (cx - self.x) * self.face < -10 and not on_head
        incoming = ball[2] * self.face < -300 and not ball_behind_me
        self.hop = False
        self.want_jump = False
        if on_head:
            # Bóng nằm trên đầu: tiến lên để bóng lăn về phía đối thủ (đừng đội bóng chạy về lưới nhà).
            self.target = cx + self.face * 40
        elif ball_behind_me:
            # Bóng lọt ra sau lưng: vòng về phía khung thành nhà — bóng thấp ở sát thì nhảy qua, không đẩy bóng về lưới nhà.
            self.target = cx - self.face * 70
            self.hop = cy < 70 and abs(cx - self.x) < 110
        elif incoming and cy >= 110 and self._keeper(ball):
            pass                            # bóng bổng đang rơi về phía khung thành nhà: đã chọn chỗ đón
        elif incoming and cy < 110 and abs(cx - self.x) < 420:
            # Cú sút thấp đang lao tới: đứng chắn bằng người.
            self.target = self.x
        elif abs(opp[0] - bx) + 90 < abs(self.x - bx) and not on_my_half:
            # Đối thủ đang giữ bóng bên kia sân: lùi về giữ khung thành.
            self.target = home
        elif on_my_half or abs(bx - self.x) < 260:
            self.target = behind
        else:
            self.target = (home + behind) / 2
        self.target += self.err
        # Nhảy đánh đầu / chặn bóng: bóng đang bay tới, lúc tới chỗ mình sẽ ở ngang tầm đầu khi nhảy lên.
        vx = ball[2]
        if self.want_jump:
            pass
        elif abs(vx) > 60:
            t = (self.x - ball[0]) / vx
            if 0.15 < t < 0.4:
                y = self._predict(ball, t)[1]
                self.want_jump = 95 < y < 290 and random.random() < lv["jump"]
        elif abs(ball[0] - self.x) < 70 and 120 < ball[1] < 260 and ball[3] < 0:
            self.want_jump = random.random() < lv["jump"]

    def _keeper(self, ball):
        """Bóng bổng bay về phía khung thành nhà: chạy tới chỗ bóng rơi xuống tầm đầu, nhảy lên đánh đầu ra."""
        b = list(ball)
        for i in range(1, 50):
            step(b, 1 / 40)
            near_goal = (b[0] - self.goal_x) * self.face < 520
            if b[1] < 230 and near_goal:
                t = i / 40
                self.target = b[0] + self.face * 8
                need = abs(self.target - self.x) / (W["SPEED"] * self.lv["speed"])
                self.want_jump = b[1] > 130 and 0.2 < t < 0.42 and need < 0.25 and random.random() < self.lv["jump"]
                return True
        return False

    def step(self, now, dt, ball, opp, active):
        """Một bước. ball = [x, y, vx, vy]; opp = (x, y) đối thủ."""
        lv = self.lv
        if active:
            if now >= self.next_think:
                self.next_think = now + 0.08
                self._think(now, ball, opp)
            if self.kick_at is None and kick_reaches(ball, self.x, self.y, self.face, slack=6):
                self.kick_at = now
                # Sút hụt: vung chân xong bóng mới tới / bóng đã trôi qua.
                if random.random() < lv["miss"]:
                    self.kick_at = now - W["KICK_TO"]
                # Lốp bóng khi đối thủ đứng chắn ngay phía trước, còn lại thì sút căng.
                ahead = (opp[0] - self.x) * self.face
                blocked = 0 < ahead < 280
                self.kind = "lob" if random.random() < lv["lob"] * (2 if blocked else 0.5) else "shoot"
            if (self.want_jump or self.hop) and self.y <= 0:
                self.vy = W["JUMP"]
                self.want_jump = self.hop = False
        else:
            self.target = self.x
        speed = W["SPEED"] * lv["speed"]
        dx = self.target - self.x
        self.vx = 0.0 if abs(dx) < 6 else speed * (1 if dx > 0 else -1)
        nx = self.x + max(-abs(dx), min(abs(dx), self.vx * dt))
        # Không chạy xuyên qua đối thủ khi cả hai ở dưới đất.
        ox, oy = opp
        if self.y < 40 and oy < 40 and abs(nx - ox) < W["BLOCK"] and abs(nx - ox) < abs(self.x - ox):
            nx = self.x
            self.vx = 0.0
        self.x = max(W["PX_MIN"], min(W["PX_MAX"], nx))
        if self.y > 0 or self.vy > 0:
            self.vy -= W["PG"] * dt
            self.y += self.vy * dt
            if self.y <= 0:
                self.y, self.vy = 0.0, 0.0
        if self.kick_at is not None and now - self.kick_at > W["KICK"]:
            self.kick_at = None
        self.elapsed = now - self.kick_at if self.kick_at is not None else 0.0
        if self.kick_at is not None:
            self.state = "kick"
        elif self.y > 0:
            self.state = "jump"
        elif self.vx:
            self.state = "run"
        else:
            self.state = "idle"
