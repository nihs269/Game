"""AI cho người chơi ảo (bot) trong Hải Chiến.

  dễ    — bắn ngẫu nhiên; trúng rồi thì hay (không phải lúc nào cũng) bắn quanh đó.
  vừa   — săn theo ô bàn cờ (bỏ qua ô không thể chứa tàu nhỏ nhất), trúng thì dò dọc/ngang tới khi chìm.
  khó   — bản đồ xác suất: đếm mọi cách đặt các tàu còn lại phù hợp với những gì đã biết, bắn ô có khả năng cao nhất.
Hàm `_bot_pick` cũng dùng để bắn hộ người chơi hết giờ.
"""
import asyncio
import logging
import random

from core.game_base import GameError

log = logging.getLogger("gamehub.haichien.bots")

TAUNT_HIT = ["Trúng rồi nhé 😎", "Bùm! 💥", "Thấy rồi 👀"]
TAUNT_SUNK = ["Chìm luôn 🫡", "Bye bye tàu 👋", "Hạm đội của bạn đang mỏng dần 😏"]
SAD = ["Ối tàu của tôi 😭", "Sao biết hay vậy 😱", "Đau quá 🥲"]


class HaiChienBotMixin:
    supports_bots = True

    def _bots_reset(self):
        self._bot_pending = {}

    def _bot_jobs(self, pid):
        if self.phase != "play" or pid not in self.order:
            return {}
        if self.stage == "place" and pid not in self.ready:
            return {"place": (self.game_no, "place")}
        if self.stage == "battle" and self.cur == pid:
            return {"fire": (self._seq, "fire")}
        return {}

    def on_state_broadcast(self):
        if getattr(self, "_disposed", False):
            return
        for p in list(self.room.players.values()):
            if not p.is_bot:
                continue
            for kind, key in self._bot_jobs(p.id).items():
                if self._bot_pending.get((p.id, kind)) == key:
                    continue
                self._bot_pending[(p.id, kind)] = key
                delay = random.uniform(2.0, 5.0) if kind == "place" else random.uniform(1.1, 2.2)
                asyncio.ensure_future(self._bot_run(p.id, kind, key, delay))
        # Thỉnh thoảng bot nói một câu khi bắn trúng / bị đánh chìm.
        ev = self.events[-1] if self.events else None
        if ev and ev["type"] == "shot" and ev["result"] != "miss" and self._bot_pending.get("say") != ev["seq"]:
            self._bot_pending["say"] = ev["seq"]
            shooter = self.room.players.get(ev["pid"])
            victim = self.room.players.get(self._foe(ev["pid"]) or "")
            if ev["result"] == "sunk" and victim and victim.is_bot and random.random() < 0.5:
                self._post_chat("all", random.choice(SAD), victim.id)
            elif shooter and shooter.is_bot and random.random() < (0.35 if ev["result"] == "sunk" else 0.12):
                self._post_chat("all", random.choice(TAUNT_SUNK if ev["result"] == "sunk" else TAUNT_HIT), shooter.id)

    async def _bot_run(self, pid, kind, key, delay):
        await asyncio.sleep(delay)
        async with self.room.lock:
            if getattr(self, "_disposed", False) or pid not in self.room.players:
                return
            if self._bot_jobs(pid).get(kind) != key:
                return
            try:
                if kind == "place":
                    from .fleet import random_place
                    self._act_place(pid, {"ships": random_place(self.fleet, self.n, self.config["no_touch"])})
                else:
                    x, y = self._bot_pick(pid, self.config["bot_level"])
                    self._act_fire(pid, {"x": x, "y": y})
            except GameError:
                pass
            except Exception:
                log.exception("Lỗi AI bot Hải Chiến")
            await self.room.broadcast_state()

    # ------------------------------------------------------------------ chọn ô bắn
    def _bot_pick(self, pid, level):
        from .fleet import rotate, rotations
        n = self.n
        foe = self._foe(pid)
        shots = self.shots[pid]
        sunk_cells = set()
        for sid in self.sunk[foe]:
            sunk_cells |= set(self._cells(sid, self.place[foe][sid]))
        open_hits = [c for c, r in shots.items() if r == "hit" and c not in sunk_cells]
        free = [(x, y) for x in range(n) for y in range(n) if (x, y) not in shots]
        if not free:
            return 0, 0
        left = [s for s in self.fleet if s["id"] not in self.sunk[foe]]

        def around(cells):
            out = []
            for x, y in cells:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    c = (x + dx, y + dy)
                    if 0 <= c[0] < n and 0 <= c[1] < n and c not in shots:
                        out.append(c)
            return out

        if level == "easy":
            if open_hits and random.random() < 0.6:
                cand = around(open_hits)
                if cand:
                    return random.choice(cand)
            return random.choice(free)

        if level == "normal":
            if open_hits:
                # Có ≥ 2 ô trúng thẳng hàng → dò tiếp theo hàng đó (tàu đa hình thì quay về dò xung quanh).
                xs = {x for x, _ in open_hits}
                ys = {y for _, y in open_hits}
                line = []
                if len(open_hits) >= 2 and len(ys) == 1:
                    y = next(iter(ys))
                    line = [(min(xs) - 1, y), (max(xs) + 1, y)]
                elif len(open_hits) >= 2 and len(xs) == 1:
                    x = next(iter(xs))
                    line = [(x, min(ys) - 1), (x, max(ys) + 1)]
                line = [c for c in line if 0 <= c[0] < n and 0 <= c[1] < n and c not in shots]
                cand = line or around(open_hits)
                if cand:
                    return random.choice(cand)
            step = min(s["size"] for s in left) if left else 2
            step = min(step, 3)
            parity = [c for c in free if (c[0] + c[1]) % step == 0] or free
            return random.choice(parity)

        # Khó: bản đồ xác suất — đếm mọi cách đặt (mọi hướng xoay) của các tàu còn lại khớp với điều đã biết.
        score = {c: 0.0 for c in free}
        hit_set = set(open_hits)
        for s in left:
            for r in rotations(s):
                shape = rotate(s["cells"], r)
                w = max(x for x, _ in shape) + 1
                h = max(y for _, y in shape) + 1
                for x in range(n - w + 1):
                    for y in range(n - h + 1):
                        cs = [(x + dx, y + dy) for dx, dy in shape]
                        if any(shots.get(c) == "miss" or c in sunk_cells for c in cs):
                            continue
                        k = sum(1 for c in cs if c in hit_set)
                        wgt = 1 + 30 * k
                        for c in cs:
                            if c in score:
                                score[c] += wgt
        best = max(score.values())
        if best <= 0:
            return random.choice(free)
        return random.choice([c for c, v in score.items() if v >= best * 0.98])
