"""AI cho bot Chiến Binh Tí Hon: chọn mục tiêu (kẻ địch gần nhất, cờ, súng / hộp cứu thương gần),
chạy tới, nhảy lên bục khi mục tiêu ở cao, rơi xuống khi mục tiêu ở thấp, ngắm có sai số theo độ khó."""
import math
import random

from .world import ITEMS, WEAPONS, on_platform

LEVELS = {
    #          sai số ngắm, phản xạ (giây), tỉ lệ bắn khi trong tầm, tầm nhìn, hay né (nhảy)
    "easy": {"err": 0.22, "react": 0.75, "trigger": 0.55, "sight": 650, "dodge": 0.5, "nade": 0.15},
    "normal": {"err": 0.12, "react": 0.45, "trigger": 0.8, "sight": 800, "dodge": 0.9, "nade": 0.3},
    "hard": {"err": 0.055, "react": 0.25, "trigger": 1.0, "sight": 950, "dodge": 1.4, "nade": 0.5},
}


class BotBrain:
    def __init__(self, level):
        self.lv = LEVELS.get(level, LEVELS["normal"])
        self.reset()

    def reset(self):
        self.target = None
        self.seen_at = None
        self.last_x = None
        self.stuck = 0.0
        self.wander = random.choice((-1, 1))
        self.next_think = 0.0
        self.goal = None
        self.jitter = random.uniform(-40, 40)

    # ------------------------------------------------------------------
    def _pick_goal(self, g, pid, f, now):
        """Điểm muốn đi tới (x, y)."""
        mode = g.config["mode"]
        my = g.team.get(pid)
        enemies = [(q, o) for q, o in g.f.items() if o["alive"] and g._enemy(pid, q)]
        if mode == "ctf" and g.flags:
            if f["flag"] is not None:
                return tuple(g.map["bases"][my])
            own = g.flags[my]
            enemy_flag = g.flags[1 - my]
            if own["state"] == "dropped":
                return own["x"], own["y"]
            if own["state"] == "carried" and random.random() < 0.6:
                c = g.f.get(own["by"])
                if c:
                    return c["x"], c["y"]
            if enemy_flag["state"] != "carried":
                return enemy_flag["x"], enemy_flag["y"]
            c = g.f.get(enemy_flag["by"])        # đồng đội đang cầm cờ địch → chạy theo hộ tống
            if c:
                return c["x"] + self.jitter, c["y"]
        # Thiếu máu → tìm hộp cứu thương; đang cầm súng lục → tìm súng gần.
        want = []
        if f["hp"] < 45:
            want = [it for it in g.items if it["kind"] == "medkit"]
        if not want and f["wpn"] == "pistol":
            want = [it for it in g.items if it["kind"] in WEAPONS]
        near = [it for it in want if abs(it["x"] - f["x"]) < 600 and abs(it["y"] - f["y"]) < 350]
        if near:
            it = min(near, key=lambda it: abs(it["x"] - f["x"]) + abs(it["y"] - f["y"]))
            return it["x"], it["y"]
        if enemies:
            q, o = min(enemies, key=lambda e: abs(e[1]["x"] - f["x"]) + 1.5 * abs(e[1]["y"] - f["y"]))
            return o["x"] + self.jitter, o["y"]
        return f["x"] + self.wander * 300, f["y"]

    def think(self, g, pid, now):
        f = g.f[pid]
        lv = self.lv
        if now >= self.next_think or self.goal is None:
            self.goal = self._pick_goal(g, pid, f, now)
            self.next_think = now + random.uniform(0.3, 0.7)
        gx, gy = self.goal
        dx, dy = gx - f["x"], gy - f["y"]
        move = 0
        if abs(dx) > 24:
            move = 1 if dx > 0 else -1
        jump = drop = False
        if f["ground"]:
            if dy < -70 and random.random() < 0.08:
                jump = True
            elif dy > 60 and on_platform(f["x"], f["y"], g.map) and random.random() < 0.1:
                drop = True
        # Kẹt (đi mãi không nhích) → nhảy.
        if self.last_x is not None and move and abs(f["x"] - self.last_x) < 0.5:
            self.stuck += 1 / 60
            if self.stuck > 0.4 and f["ground"]:
                jump = True
                self.stuck = 0.0
                self.wander = -self.wander
        else:
            self.stuck = 0.0
        if f["x"] < 40 or f["x"] > g.map["w"] - 40:
            self.wander = 1 if f["x"] < 40 else -1
        self.last_x = f["x"]

        # Ngắm bắn kẻ địch gần nhất trong tầm nhìn.
        aim = f["aim"]
        fire = nade = swap = False
        enemies = [(q, o) for q, o in g.f.items() if o["alive"] and g._enemy(pid, q)]
        tgt = None
        if enemies:
            q, o = min(enemies, key=lambda e: math.hypot(e[1]["x"] - f["x"], e[1]["y"] - f["y"]))
            d = math.hypot(o["x"] - f["x"], o["y"] - f["y"])
            if d < lv["sight"]:
                tgt = (q, o, d)
        if tgt:
            q, o, d = tgt
            if self.target != q:
                self.target, self.seen_at = q, now
            w = WEAPONS[f["wpn"]]
            lead = d / w["speed"]
            tx = o["x"] + o["vx"] * lead
            ty = o["y"] - 37 + (o["vy"] * lead if not o["ground"] else 0)
            sx, sy = f["x"], f["y"] - 37
            aim = math.atan2(ty - sy, tx - sx) + random.gauss(0, lv["err"])
            rng = w["speed"] * w["life"] * 0.9
            if now - self.seen_at > lv["react"] and d < rng and random.random() < lv["trigger"]:
                fire = True
            if f["gren"] > 0 and 220 < d < 520 and random.random() < lv["nade"] / 60:
                nade = True
                # ném vồng: ngắm cao hơn một chút
                aim = math.atan2(ty - sy - d * 0.35, tx - sx)
            # Khi đấu súng thì thỉnh thoảng nhảy né, giữ khoảng cách vừa phải.
            if f["ground"] and random.random() < lv["dodge"] / 60:
                jump = True
            if d < 150 and f["wpn"] not in ("shotgun",) and g.config["mode"] != "ctf":
                move = -1 if o["x"] > f["x"] else 1
        else:
            self.target = None
            if move:
                aim = 0.0 if move > 0 else math.pi
        # Đứng trên súng tốt hơn súng đang cầm → đổi.
        if f["wpn"] != "pistol":
            for it in g.items:
                if it["kind"] in WEAPONS and it["kind"] != f["wpn"] and abs(it["x"] - f["x"]) < 30 and abs(it["y"] - f["y"]) < 40:
                    if ITEMS[it["kind"]]["w"] < ITEMS[f["wpn"]]["w"] and random.random() < 0.05:
                        swap = True
        return move, jump, drop, aim, fire, nade, swap
