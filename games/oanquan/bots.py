"""AI cho người chơi ảo (bot) trong Ô Ăn Quan.

Thử hết các nước (ô × chiều) bằng chính hàm rải của luật. Bot dễ hay chọn bừa; bot vừa chọn nước ăn được
nhiều nhất; bot khó nhìn thêm một nước: trừ đi phần người đi kế tiếp ăn lại được ngay sau đó.
Hàm `_best_move` cũng dùng khi người chơi hết giờ.
"""
import asyncio
import logging
import random

from core.game_base import GameError
from .rules import legal_moves, row, sow

log = logging.getLogger("gamehub.oanquan.bots")

THINK = (0.8, 1.6)
LEVELS = {"easy": {"random": 0.45, "look": False}, "normal": {"random": 0.1, "look": False},
          "hard": {"random": 0.0, "look": True}}
EAT_LINES = ["Ăn quan rồi nhé 😎", "Ngon! 😋", "Cảm ơn nha 🤭", "Hehe 😏"]
EATEN_LINES = ["Ơ quan của tôi 😭", "Sao lại thế 😩", "Để đấy, trả thù sau 😤"]


class OanQuanBotMixin:
    supports_bots = True

    def _bots_reset(self):
        self._bot_pending = {}

    def on_state_broadcast(self):
        if getattr(self, "_disposed", False):
            return
        pid = self.current
        p = self.room.players.get(pid) if pid else None
        if p and p.is_bot and self.stage == "pick":
            key = (self._seq, "pick")
            if self._bot_pending.get(pid) != key:
                self._bot_pending[pid] = key
                asyncio.ensure_future(self._bot_run(pid, key, random.uniform(*THINK)))
        # Ăn được quan / bị ăn quan thì thỉnh thoảng nói một câu.
        ev = self.events[-1] if self.events else None
        if ev and ev["type"] == "move" and ev.get("quan") and self._bot_pending.get("say") != ev["seq"]:
            self._bot_pending["say"] = ev["seq"]
            mover = self.room.players.get(ev["pid"])
            owners = [self.seats[v] for v in ev.get("victims", []) if v < len(self.seats) and self.seats[v] != ev["pid"]]
            other = owners[0] if owners else None
            victim = self.room.players.get(other) if other else None
            if mover and mover.is_bot and random.random() < 0.5:
                self._post_chat("all", random.choice(EAT_LINES), ev["pid"])
            elif victim and victim.is_bot and random.random() < 0.5:
                self._post_chat("all", random.choice(EATEN_LINES), other)

    async def _bot_run(self, pid, key, delay):
        await asyncio.sleep(delay)
        async with self.room.lock:
            if getattr(self, "_disposed", False) or pid not in self.room.players:
                return
            if self.current != pid or self.stage != "pick" or self._bot_pending.get(pid) != key:
                return
            try:
                cell, d = self._best_move(pid, self.config["bot"])
                self._act_move(pid, {"cell": cell, "dir": d})
            except GameError:
                pass
            except Exception:
                log.exception("Lỗi AI bot Ô Ăn Quan")
            await self.room.broadcast_state()

    # ------------------------------------------------------------------ tương tác
    def on_fx(self, from_pid, to_pid, kind):
        p_to, p_from = self.room.players.get(to_pid or ""), self.room.players.get(from_pid)
        if not p_to or not p_to.is_bot or (p_from and p_from.is_bot):
            return
        if kind == "tomato":
            reply = random.choice([("tomato", from_pid), ("angry", None), ("cry", None)])
        elif kind in ("heart", "flower"):
            reply = random.choice([("heart", from_pid), ("laugh", None), ("dance", None)])
        elif kind in ("wave", "highfive"):
            reply = (kind, from_pid)
        elif kind == "poke":
            reply = random.choice([("angry", None), ("shock", None), ("poke", from_pid)])
        else:
            return

        async def run():
            await asyncio.sleep(random.uniform(0.9, 2.0))
            if not getattr(self, "_disposed", False) and to_pid in self.room.players:
                await self.room.emit_fx(to_pid, reply[1], reply[0])
        asyncio.ensure_future(run())

    # ------------------------------------------------------------------ quyết định
    def _gain(self, got_dan, got_quan):
        return got_dan + got_quan * self.config["quan_value"]

    def _best_move(self, pid, level="hard"):
        seat = self.seats.index(pid)
        moves = legal_moves(self.dan, seat)
        lv = LEVELS.get(level, LEVELS["normal"])
        if random.random() < lv["random"]:
            return random.choice(moves)
        qn = self.config["quan_non"]
        best, best_score = None, None
        for cell, d in moves:
            dan, quan, gd, gq, _ = sow(self.dan, self.quan, cell, d, qn)
            score = self._gain(gd, gq) + random.random() * 0.5
            if lv["look"]:
                replies = legal_moves(dan, (seat + 1) % len(self.seats))
                worst = max((self._gain(*sow(dan, quan, c, dd, qn)[2:4]) for c, dd in replies), default=0)
                score -= 0.9 * worst
                # Để hàng nhà trống trơn thì lượt sau phải rải quân từ kho — hơi thiệt.
                if not any(dan[c] for c in row(seat)):
                    score -= 2
            if best_score is None or score > best_score:
                best, best_score = (cell, d), score
        return best

