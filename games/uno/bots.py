"""AI cho người chơi ảo (bot) trong UNO.

Bot đánh sau một khoảng trễ ngẫu nhiên cho giống người thật: ưu tiên giữ lá đổi
màu tới cuối, dùng lá chức năng khi người kế tiếp sắp hết bài, chọn màu mình có
nhiều nhất. Thỉnh thoảng bot quên hô UNO — và cũng biết bắt lỗi người khác.
"""
import asyncio
import logging
import random
from collections import Counter

from core.game_base import GameError

log = logging.getLogger("gamehub.uno.bots")

TURN_DELAY = (1.2, 2.8)
UNO_DELAY = (0.6, 2.2)
CATCH_DELAY = (1.5, 4.0)
FORGET_UNO = 0.15   # xác suất bot quên hô UNO
CATCH_CHANCE = 0.55  # xác suất bot phát hiện người khác quên hô

TAUNTS = ["UNO! 😎", "Hehe, lá cuối rồi nha!", "Sắp thắng rồi 😏"]
OUCH = ["Ối trời 😵", "Ác quá vậy!", "Thôi xong…", "Để đó, lát tính sổ 😤"]
WIN_LINES = ["GG! 🎉", "Ez game 😎", "Cảm ơn mọi người nha 😄"]


class UnoBotMixin:
    supports_bots = True

    def _bots_reset(self):
        self._bot_pending = {}

    def _is_bot(self, pid):
        p = self.room.players.get(pid)
        return bool(p and p.is_bot)

    # ------------------------------------------------------------------ lên lịch
    def _bot_jobs(self, pid):
        """Các việc bot có thể làm lúc này: {loại: khoá}."""
        if self.phase != "play" or pid not in self.hands:
            return {}
        jobs = {}
        base = (self.round, self._seq)
        if pid == self.current:
            jobs["turn"] = base + (self.drawn,)
        if self.uno_pending == pid:
            jobs["uno"] = base
        elif self.uno_pending is not None:
            jobs["catch"] = base + (self.uno_pending,)
        return jobs

    def on_state_broadcast(self):
        if getattr(self, "_disposed", False):
            return
        for p in list(self.room.players.values()):
            if not p.is_bot:
                continue
            for kind, key in self._bot_jobs(p.id).items():
                slot = (p.id, kind)
                if self._bot_pending.get(slot) == key:
                    continue
                self._bot_pending[slot] = key
                if kind == "turn":
                    delay = random.uniform(*TURN_DELAY)
                elif kind == "uno":
                    if random.random() < FORGET_UNO:
                        continue
                    delay = random.uniform(*UNO_DELAY)
                else:
                    if random.random() > CATCH_CHANCE:
                        continue
                    delay = random.uniform(*CATCH_DELAY)
                asyncio.ensure_future(self._bot_run(p.id, kind, key, delay))

    async def _bot_run(self, pid, kind, key, delay):
        await asyncio.sleep(delay)
        async with self.room.lock:
            if getattr(self, "_disposed", False) or pid not in self.room.players:
                return
            if self._bot_jobs(pid).get(kind) != key:
                return
            try:
                if kind == "turn":
                    self._bot_turn(pid)
                elif kind == "uno":
                    self._act_uno(pid, {})
                    if random.random() < 0.35:
                        self._post_chat("all", random.choice(TAUNTS), pid)
                else:
                    self._act_catch(pid, {})
            except GameError:
                pass
            except Exception:
                log.exception("Lỗi AI bot UNO")
            await self.room.broadcast_state()

    # ------------------------------------------------------------------ tương tác
    def on_fx(self, from_pid, to_pid, kind):
        if not to_pid or not self._is_bot(to_pid) or self._is_bot(from_pid):
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
        self._bot_emit(to_pid, reply[1], reply[0], random.uniform(0.9, 2.0))

    def _bot_emit(self, pid, target, kind, delay):
        async def run():
            await asyncio.sleep(delay)
            if not getattr(self, "_disposed", False) and pid in self.room.players:
                await self.room.emit_fx(pid, target, kind)
        asyncio.ensure_future(run())

    # ------------------------------------------------------------------ quyết định
    def _bot_color(self, pid):
        counts = Counter(c["c"] for c in self.hands[pid] if c["c"] != "w")
        if not counts:
            return random.choice(["r", "y", "g", "b"])
        best = max(counts.values())
        return random.choice([c for c, n in counts.items() if n == best])

    def _bot_score(self, pid, card, danger):
        """Điểm ưu tiên của một lá có thể đánh (cao hơn = đánh trước)."""
        colors = Counter(c["c"] for c in self.hands[pid])
        v = card["v"]
        score = random.random()
        if card["c"] == "w":
            score -= 30 if v == "w4" else 20       # giữ lá đổi màu tới cuối
            if danger:
                score += 45 if v == "w4" else 5
        else:
            score += colors[card["c"]] * 2          # xả màu mình nhiều nhất
            if v in ("skip", "rev", "d2"):
                score += 25 if danger else 3
            else:
                score += int(v) / 3                 # bỏ lá điểm cao trước
        return score

    def _bot_turn(self, pid):
        playable = [c for c in self.hands[pid] if c["id"] in self._playable_ids(pid)]
        if not playable:
            if self.drawn is not None:
                self._act_pass(pid, {})
            else:
                had_pending = self.pending
                self._act_draw(pid, {})
                if had_pending and random.random() < 0.4:
                    self._post_chat("all", random.choice(OUCH), pid)
            return
        if self.drawn is not None and random.random() < 0.1:
            self._act_pass(pid, {})  # đôi khi giữ lại lá vừa rút
            return
        nxt = self.order[self._next_index(1)]
        danger = len(self.hands[nxt]) <= 2
        card = max(playable, key=lambda c: self._bot_score(pid, c, danger))
        if len(self.hands[pid]) == 2 and random.random() > FORGET_UNO:
            self._act_uno(pid, {})
        self._act_play(pid, {"card": card["id"], "color": self._bot_color(pid) if card["c"] == "w" else None})
        if self.phase == "end" and self.winner == pid and random.random() < 0.6:
            self._post_chat("all", random.choice(WIN_LINES), pid)
        elif card["v"] in ("d2", "w4") and random.random() < 0.3:
            self._bot_emit(pid, nxt, "poke", 0.6)
