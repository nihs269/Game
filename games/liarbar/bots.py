"""AI cho người chơi ảo (bot) trong Liar's Bar.

Bot ước lượng khả năng người trước nói dối dựa trên số lá hợp lệ còn lại
(6 lá của bàn + 2 Joker trừ đi số bot đang cầm) và số lá vừa khai, rồi quyết
định hô Liar! hay đánh tiếp. Khi đánh, bot thường khai thật nếu có bài hợp lệ,
còn không thì đành bịp.
"""
import asyncio
import logging
import random

from core.game_base import GameError

log = logging.getLogger("gamehub.liarbar.bots")

TURN_DELAY = (1.5, 3.5)
TRIGGER_DELAY = (1.8, 3.5)
VALID_TOTAL = 8  # 6 lá của bàn + 2 Joker

CALL_LINES = ["LIAR! 🤥", "Xạo quá à 😏", "Lật bài ra coi!", "Không tin nổi 🧐"]
PLAY_LINES = ["Tin tôi đi 😇", "Toàn hàng thật nha", "Hehe 😏", "…"]
SURVIVE_LINES = ["Phù… 😰", "Trời thương 🙏", "Tim muốn rớt ra ngoài 😵"]


class LiarBotMixin:
    supports_bots = True

    def _bots_reset(self):
        self._bot_pending = {}

    # ------------------------------------------------------------------ lên lịch
    def _bot_jobs(self, pid):
        if self.phase != "play" or pid not in self.alive:
            return {}
        if self.stage == "turn" and pid == self.current:
            return {"turn": (self.round, self._seq)}
        if self.stage == "roulette" and self.reveal and self.reveal["shooter"] == pid:
            return {"trigger": (self.round, self._seq)}
        return {}

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
                delay = random.uniform(*(TURN_DELAY if kind == "turn" else TRIGGER_DELAY))
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
                else:
                    self._act_trigger(pid, {})
                    if not self.shot["dead"] and random.random() < 0.4:
                        self._post_chat("all", random.choice(SURVIVE_LINES), pid)
            except GameError:
                pass
            except Exception:
                log.exception("Lỗi AI bot Liar's Bar")
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
    def _bot_lie_chance(self, pid):
        """Ước lượng xác suất lượt vừa rồi có lá gian."""
        hand = self.hands[pid]
        n = len(self.last_play["cards"])
        mine = sum(1 for c in hand if self._is_valid(c))
        left = VALID_TOTAL - mine
        if n > left:
            return 1.0
        chance = 0.2 + 0.15 * (n - 1) + 0.08 * mine
        liar = self.last_play["pid"]
        if not self.hands.get(liar):
            chance += 0.1  # vừa đánh hết bài — hay bịp để thoát
        if not any(self._is_valid(c) for c in hand):
            chance += 0.15  # mình toàn bài gian, đánh tiếp cũng dễ bị bắt
        return min(0.9, chance)

    def _bot_turn(self, pid):
        hand = self.hands[pid]
        if self._can_call(pid) and (not hand or random.random() < self._bot_lie_chance(pid)):
            self._act_call(pid, {})
            if random.random() < 0.4:
                self._post_chat("all", random.choice(CALL_LINES), pid)
            return
        valid = [c for c in hand if self._is_valid(c)]
        bad = [c for c in hand if not self._is_valid(c)]
        valid.sort(key=lambda c: c["r"] == "J")  # để dành Joker
        if valid and (not bad or random.random() < 0.8):
            k = min(len(valid), random.choice([1, 1, 2, 2, 3]))
            cards = valid[:k]
            if bad and k < 3 and random.random() < 0.15:
                cards.append(random.choice(bad))  # kẹp thêm 1 lá gian
        else:
            k = 1 if len(bad) < 3 or random.random() < 0.6 else 2
            cards = random.sample(bad, min(k, len(bad)))
        self._act_play(pid, {"cards": [c["id"] for c in cards]})
        if random.random() < 0.15:
            self._post_chat("all", random.choice(PLAY_LINES), pid)
