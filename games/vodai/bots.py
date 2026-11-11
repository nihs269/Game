"""Bot Võ Đài: máy chủ mô phỏng võ sĩ ảo bằng đúng vật lý & bảng đòn của người chơi (moves.py).

Cứ vài phần mười giây (tuỳ độ khó) bot “nghĩ” một lần: nhìn khoảng cách, đối thủ có đang ra đòn / có chưởng bay tới
không, rồi chọn đi tới, lùi, nhảy, đỡ, ngồi né chưởng, ra đòn hoặc tung tuyệt chiêu. Bot khó phản xạ nhanh, đỡ giỏi
và hay nối đòn. Lúc “KẾT LIỄU ĐI!” bot thắng sẽ đi lại gần đối thủ (máy chủ quyết định lúc tung đòn kết liễu).
"""
import math
import random

from .moves import MOVES, WORLD as W

DT = 1 / 60
LEVELS = {
    "easy": {"react": (0.35, 0.6), "block": 0.15, "dodge": 0.25, "aggr": 0.45, "special": 0.12, "combo": 0.1},
    "normal": {"react": (0.2, 0.38), "block": 0.4, "dodge": 0.55, "aggr": 0.6, "special": 0.2, "combo": 0.35},
    "hard": {"react": (0.1, 0.22), "block": 0.65, "dodge": 0.85, "aggr": 0.72, "special": 0.25, "combo": 0.6},
}


def _sign(v):
    return 1 if v >= 0 else -1


class BotFighter:
    def __init__(self, level, moves=("fireball", "spear", "fkick")):
        self.lv = LEVELS.get(level, LEVELS["normal"])
        self.specials = list(moves)       # 3 tuyệt chiêu của nhân vật bot đang cầm
        self.projs = [m for m in moves if MOVES[m].get("proj")]
        self.dashes = [m for m in moves if MOVES[m].get("dash")]
        self.reset(W["START"][0], 1, 0.0)

    def reset(self, x, face, t):
        self.t = t
        self.x, self.y, self.vx, self.vy, self.face = float(x), 0.0, 0.0, 0.0, face
        self.move = None
        self.mt0 = 0.0
        self.n = 0
        self.hit_n = 0
        self.spawned = False
        self.block = self.crouch = False
        self.walk = 0
        self.stun_until = 0.0
        self.blocked_until = 0.0
        self.down = None          # None | fall | down | rise
        self.down_until = 0.0
        self.dizzy = False
        self.ko = False
        self.think_at = t + random.uniform(0.1, 0.4)
        self.queued = None        # (đòn, lúc ra) — VD nhảy lên rồi mới đá
        self.cd = {}

    # ------------------------------------------------------------------ trạng thái gửi cho mọi người
    @property
    def state(self):
        if self.ko and self.down != "fall":
            return "ko"
        if self.dizzy:
            return "dizzy"
        if self.down:
            return self.down
        if self.t < self.blocked_until:
            return "cblock" if self.crouch else "block"
        if self.t < self.stun_until:
            return "hurt"
        if self.move:
            return "atk"
        if self.y > 0:
            return "jump"
        if self.block:
            return "cblock" if self.crouch else "block"
        if self.crouch:
            return "crouch"
        if self.walk:
            return "walk"
        return "idle"

    @property
    def elapsed(self):
        return self.t - self.mt0 if self.move else 0.0

    def free(self, t):
        return not self.down and not self.ko and not self.dizzy and t >= self.stun_until and t >= self.blocked_until

    # ------------------------------------------------------------------ mô phỏng
    def step(self, t_to, opp, projs, mode):
        """Mô phỏng tới t_to. `opp` là trạng thái đối thủ (x, y, s, m, e), `projs` là chưởng của đối thủ,
        `mode`: fight (đánh nhau) | chase (lại gần đối thủ) | idle (đứng yên). Trả về danh sách sự kiện:
        ("active", đòn, n) khi đòn đang có hiệu lực, ("spawn", đòn) khi tung chưởng."""
        ev = []
        if t_to - self.t > 0.5:
            self.t = t_to - 0.5
        while self.t + DT <= t_to:
            self.t += DT
            self._sub(self.t, opp, projs, mode, ev)
        return ev

    def _sub(self, t, opp, projs, mode, ev):
        if self.down == "down" and t >= self.down_until:
            self.down, self.down_until = "rise", t + W["RISE"]
        elif self.down == "rise" and t >= self.down_until:
            self.down = None
        free = self.free(t)
        if free and mode == "fight":
            self._think(t, opp, projs)
        elif free and mode == "chase":
            self.block = self.crouch = False
            self.walk = _sign(opp["x"] - self.x) if abs(opp["x"] - self.x) > 150 else 0
        elif free and mode.startswith("dummy:"):
            # đối thủ tập: đứng yên / ngồi / luôn đỡ / nhảy liên tục
            kind = mode[6:]
            self.walk = 0
            self.block = kind == "block"
            self.crouch = kind == "crouch"
            if kind == "jump" and self.y <= 0 and t >= self.think_at:
                self._jump(0)
                self.think_at = t + random.uniform(0.5, 1.1)
        elif mode == "idle" or not free:
            self.walk = 0
            if mode == "idle" and t >= self.blocked_until:
                self.block = self.crouch = False
        grounded = self.y <= 0
        # đòn đang ra
        if self.move:
            m = MOVES[self.move]
            e = t - self.mt0
            if m.get("dash") and m["st"] <= e < m["st"] + m["ac"]:
                self.vx = self.face * m["dash"]
            if m.get("proj") and not self.spawned and e >= m["st"]:
                self.spawned = True
                ev.append(("spawn", self.move))
            if m.get("teleport") and not self.spawned and e >= m["st"]:
                self.spawned = True
                self._teleport(opp)
                ev.append(("teleport",))
            if not m.get("proj") and not m.get("teleport") and m["st"] <= e < m["st"] + m["ac"] and self.hit_n != self.n:
                ev.append(("active", self.move, self.n))
            if e >= m["st"] + m["ac"] + m["rc"] or (m.get("air") and grounded and e > m["st"]):
                self.move = None
        elif self.queued and t >= self.queued[1]:
            mv, _ = self.queued
            self.queued = None
            if free and mode == "fight" and bool(MOVES[mv].get("air")) == (self.y > 0):
                self._attack(mv, t)
        # vật lý
        if grounded and self.vy <= 0:
            if free and not self.move and self.walk and not self.block and not self.crouch:
                self.vx = self.walk * (W["WALK"] if self.walk == self.face else W["BACK"])
            elif not (self.move and MOVES[self.move].get("dash")):
                self.vx *= math.exp(-W["FRICTION"] * DT)
        self.vy -= W["G"] * DT
        self.y += self.vy * DT
        self.x += self.vx * DT
        if self.y <= 0:
            self.y = 0.0
            if self.vy < 0:
                self.vy = 0.0
                if self.down == "fall":
                    self.down = "down"
                    self.down_until = float("inf") if self.ko else t + W["DOWN"]
                    self.vx *= 0.3
        self.x = max(W["LEFT"], min(W["RIGHT"], self.x, opp["x"] + W["MAXSEP"]), opp["x"] - W["MAXSEP"])
        # không đứng chồng lên đối thủ
        ox = opp["x"]
        if (abs(self.x - ox) < W["PUSH"] and abs(self.y - opp["y"]) < 100 and not self.down
                and opp.get("s") not in ("down", "ko", "fall")):
            side = _sign(self.x - ox) if self.x != ox else -self.face
            self.x = max(W["LEFT"], min(W["RIGHT"], ox + side * W["PUSH"]))
        if self.y <= 0 and not self.move and not self.down and free:
            self.face = 1 if ox >= self.x else -1

    def _attack(self, mv, t):
        m = MOVES[mv]
        self.move, self.mt0, self.spawned = mv, t, False
        self.n += 1
        self.block = self.crouch = False
        self.walk = 0
        if m.get("hop"):
            self.vy = m["hop"]
        if m.get("cd"):
            self.cd[mv] = t + m["cd"]

    def _jump(self, direction):
        if self.y <= 0:
            self.vy = W["JUMP"]
            self.vx = direction * W["JUMP_VX"]
            self.block = self.crouch = False

    def _ready(self, mv, t):
        return mv in self.specials and t >= self.cd.get(mv, 0.0)

    def _teleport(self, opp):
        """Hiện ra sau lưng đối thủ (bị tường chặn thì hiện ra phía trước)."""
        side = _sign(opp["x"] - self.x)
        x = opp["x"] + side * 75
        if not W["LEFT"] <= x <= W["RIGHT"]:
            x = opp["x"] - side * 75
        self.x = max(W["LEFT"], min(W["RIGHT"], x))
        self.y, self.vy, self.vx = 0.0, 0.0, 0.0
        self.face = 1 if opp["x"] >= self.x else -1
        self.queued = ("jab" if random.random() < 0.5 else "kick", self.t + 0.25)

    def _think(self, t, opp, projs):
        if self.move or t < self.think_at:
            return
        lv = self.lv
        self.think_at = t + random.uniform(*lv["react"])
        d = opp["x"] - self.x
        dist = abs(d)
        toward = _sign(d)
        self.block = self.crouch = False
        self.walk = 0
        if self.y > 0:
            if dist < 150 and random.random() < lv["aggr"]:
                self._attack("akick" if random.random() < 0.7 else "apunch", t)
            return
        om = MOVES.get(opp.get("m") or "")
        threat = (om is not None and not om.get("proj") and opp.get("e", 9) < om["st"] + om["ac"]
                  and dist < om["reach"] + 90)
        incoming = [p for p in projs if (self.x - p["x"]) * p["vx"] > 0 and abs(p["x"] - self.x) < 380]
        if incoming and random.random() < lv["dodge"]:
            r = random.random()
            if r < 0.5:
                self.crouch = True
            elif r < 0.8:
                self.block = True
            else:
                self._jump(toward if random.random() < 0.6 else 0)
            self.think_at = t + 0.35
            return
        if threat and random.random() < lv["block"]:
            self.block = True
            self.crouch = opp.get("m") == "sweep"
            self.think_at = t + 0.3
            return
        if opp.get("s") in ("down", "rise", "ko", "fall"):
            self.walk = -toward if dist < 170 else 0
            return
        r = random.random()
        projs = [m for m in self.projs if self._ready(m, t) and (m != "spear" or dist < 560)]
        dashes = [m for m in self.dashes if self._ready(m, t)]
        if dist > 300:
            if r < lv["special"] * 1.5 and projs:
                self._attack(random.choice(projs), t)
            elif r < lv["special"] * 1.9 and self._ready("teleport", t):
                self._attack("teleport", t)
            else:
                self.walk = toward
                self.think_at = t + random.uniform(0.25, 0.5)
        elif dist > 110:
            if r < lv["special"] * 0.8 and dist < 260 and dashes:
                self._attack(random.choice(dashes), t)
            elif r < 0.28:
                self._jump(toward)
                self.queued = ("akick", t + 0.2)
            elif r < 0.28 + lv["aggr"] * 0.6:
                self.walk = toward
            elif random.random() < 0.4:
                self.walk = -toward
        else:
            if opp["y"] > 30 and r < 0.6:
                self._attack("upper", t)
            elif r < lv["aggr"]:
                close = dist < 70 and opp["y"] <= 0
                mv = random.choices(["jab", "kick", "sweep", "upper", "round", "throw"], [30, 22, 16, 16, 10, 14 if close else 0])[0]
                self._attack(mv, t)
                if mv == "jab" and random.random() < lv["combo"]:
                    self.queued = ("kick" if random.random() < 0.6 else "upper", t + 0.25)
            elif r < lv["aggr"] + 0.15:
                self.block = True
                self.think_at = t + 0.3
            else:
                self.walk = -toward
                self.think_at = t + 0.2

    # ------------------------------------------------------------------ bị đánh
    def on_hit(self, h, t):
        """Áp dụng một cú trúng đòn (cùng định dạng tin `hit` gửi cho trình duyệt)."""
        self.move = None
        self.queued = None
        self.walk = 0
        if h["blk"]:
            self.blocked_until = t + h["stun"]
            self.block = True
            self.vx = h["dir"] * h["kb"]
            return
        self.block = self.crouch = False
        if "pull" in h:
            self.x, self.vx = float(h["pull"]), 0.0
        self.stun_until = t + h["stun"]
        if h.get("finish"):
            self.dizzy = True
            self.vx = h["dir"] * 220
            return
        if h["down"] or h.get("ko") or self.y > 0:
            self.down = "fall"
            self.ko = bool(h.get("ko"))
            self.vy = max(h["up"], W["FALL_UP"])
            self.vx = h["dir"] * max(h["kb"], 200)
        else:
            self.vx = h["dir"] * h["kb"]
            if h["up"]:
                self.vy = h["up"]
