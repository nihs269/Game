"""Bot Cầu Lông: máy chủ mô phỏng người chơi ảo bằng đúng luật di chuyển như trình duyệt.

Khi cầu bay sang phía mình, bot dò trước đường bay để chọn điểm đón cầu vừa tầm vợt mà chạy kịp (sau một khoảng phản
xạ), chạy tới, nhảy nếu cầu cao rồi vung vợt đúng lúc. Máy chủ kiểm tra vợt chạm cầu như với người thật.
Bot dễ phản xạ chậm, hay đứng lệch, hay vung trượt; bot khó đọc cầu ra ngoài để bỏ và hay đập cầu.
"""
import random

from .physics import WORLD as W

LEVELS = {
    "easy": {"react": 0.4, "err": 40, "miss": 0.2, "smash": 0.3, "judge": 0.2, "speed": 0.8, "vs_smash": 0.6},
    "normal": {"react": 0.26, "err": 22, "miss": 0.1, "smash": 0.6, "judge": 0.55, "speed": 0.92, "vs_smash": 0.4},
    "hard": {"react": 0.16, "err": 10, "miss": 0.05, "smash": 0.85, "judge": 0.9, "speed": 1.0, "vs_smash": 0.25},
}
STAND_TOP = W["REACH_Y"] + W["REACH_R"] - 14     # cao nhất đánh được khi đứng
LOW = 26                                          # thấp nhất còn cứu được


class BotPlayer:
    def __init__(self, level, side):
        self.lv = LEVELS[level]
        self.side = side
        self.face = 1 if side == 0 else -1
        self.home = W["NET_X"] + (-1 if side == 0 else 1) * 280
        self.reset(self.home)

    def reset(self, x):
        self.x, self.y, self.vx, self.vy = float(x), 0.0, 0.0, 0.0
        self.state = "idle"
        self.kind = ""
        self.swing_at = None
        self.elapsed = 0.0
        self.plan = None          # (n, thời điểm đón, x cần đứng, cần nhảy?, cú đánh) hoặc (n, None) = bỏ cầu
        self.jumped = False
        self.decided = None       # đánh đôi: quả cầu số n đã được chia ai đón

    def _bounds(self):
        m, pw = W["MARGIN"], W["PW"]
        if self.side == 0:
            return pw, W["NET_X"] - m - pw
        return W["NET_X"] + m + pw, W["W"] - pw

    def _mine(self, x):
        return x <= W["NET_X"] if self.side == 0 else x >= W["NET_X"]

    def _make_plan(self, shot, now):
        lv = self.lv
        pts, t0 = shot["pts"], shot["t0"]
        lx = pts[-1][0]
        out = lx < W["LINE_L"] or lx > W["LINE_R"]
        if out and not shot["net"] and random.random() < lv["judge"]:
            return (shot["n"], None)   # cầu sẽ ra ngoài — để đó
        start = now + lv["react"]
        lo, hi = self._bounds()
        speed = W["SPEED"] * lv["speed"]
        i0 = max(0, int((start - t0) / W["DT"]))
        best = None
        for i in range(i0, len(pts)):
            sx, sy = pts[i]
            if not self._mine(sx) or sy < LOW:
                continue
            t = t0 + i * W["DT"]
            want = sx - self.face * W["REACH_X"]
            if not lo - 10 <= want <= hi + 10:
                continue
            need_jump = sy > STAND_TOP
            if need_jump and sy > STAND_TOP + 95:
                continue
            if abs(want - self.x) > speed * (t - start) + W["REACH_R"] * 0.5:
                continue
            smashable = sy >= W["SMASH_Y"]
            if best is None:
                best = (t, want, need_jump, sy)
                if not smashable or random.random() > lv["smash"]:
                    break
            elif smashable:
                best = (t, want, need_jump, sy)
                break
            if t - best[0] > 0.45:
                break
        if best is None:
            return (shot["n"], None)
        t, want, jump, sy = best
        want += random.uniform(-lv["err"], lv["err"])
        if sy >= W["SMASH_Y"] and random.random() < lv["smash"]:
            kind = "smash"
        else:
            kind = random.choices(["clear", "drop", "smash"], weights=[5, 3, 2])[0]
        # Vung trượt: vung sớm quá, vợt qua rồi cầu mới tới.
        if random.random() < lv["miss"] + (lv["vs_smash"] if shot["kind"] == "smash" else 0):
            t -= random.choice((0.4, 0.45))
        return (shot["n"], t, want, jump, kind)

    def ensure_plan(self, shot, now):
        if self.plan is None or self.plan[0] != shot["n"]:
            self.plan = self._make_plan(shot, now)
            self.jumped = False
        return self.plan

    def step(self, now, dt, shot, serving):
        """Một bước mô phỏng. Trả về cú đánh muốn thử ("swing") — máy chủ tự kiểm tra trúng cầu."""
        target = self.home
        if shot is not None and shot["by_side"] != self.side and now < shot["land_t"]:
            self.ensure_plan(shot, now)
            if self.plan[1] is not None:
                _, t, want, jump, kind = self.plan
                target = want
                if jump and not self.jumped and self.y <= 0 and now >= t - 0.3:
                    self.vy, self.jumped = W["JUMP"], True
                if self.swing_at is None and t - 0.1 <= now < t + 0.1:
                    self.swing_at, self.kind = now, kind
        elif serving:
            target = self.home - self.face * 60
        lo, hi = self._bounds()
        speed = W["SPEED"] * self.lv["speed"]
        dx = target - self.x
        self.vx = 0.0 if abs(dx) < 4 else speed * (1 if dx > 0 else -1)
        self.x = max(lo, min(hi, self.x + max(-abs(dx), min(abs(dx), self.vx * dt))))
        if self.y > 0 or self.vy > 0:
            self.vy -= W["PG"] * dt
            self.y += self.vy * dt
            if self.y <= 0:
                self.y, self.vy = 0.0, 0.0
        if self.swing_at is not None and now - self.swing_at > W["SWING"]:
            self.swing_at = None
        self.elapsed = now - self.swing_at if self.swing_at is not None else 0.0
        if self.swing_at is not None:
            self.state = "swing"
        elif self.y > 0:
            self.state = "jump"
        elif self.vx:
            self.state = "run"
        else:
            self.state = "idle"
        return self.swing_at is not None and W["HIT_FROM"] <= self.elapsed <= W["HIT_TO"]
