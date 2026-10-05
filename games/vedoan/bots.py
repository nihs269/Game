"""AI cho người chơi ảo (bot) trong Vẽ Đoán: bot chỉ ĐOÁN (không vẽ).

Bot không nhìn được hình nên “giả lập” người đoán: đoán đúng với một xác suất theo độ khó, vào một thời điểm
ngẫu nhiên trong lượt (đoán sau khi có gợi ý chữ cái thì dễ hơn), và thỉnh thoảng đoán sai bằng một từ cùng chủ đề.
"""
import asyncio
import logging
import random

from core.game_base import GameError

log = logging.getLogger("gamehub.vedoan.bots")

LEVELS = {
    "easy": {"hit": 0.4, "when": (0.45, 0.95), "wrong": (1, 2)},
    "normal": {"hit": 0.62, "when": (0.3, 0.85), "wrong": (1, 3)},
    "hard": {"hit": 0.85, "when": (0.15, 0.6), "wrong": (0, 2)},
}
CHAT = ["Khó quá 🤔", "Vẽ gì thế này 😂", "À à biết rồi!", "Đẹp đấy 👏", "Gợi ý đi 🥺"]


class VeDoanBotMixin:
    supports_bots = True

    def _bots_reset(self):
        self._bot_turn = None

    def on_state_broadcast(self):
        if getattr(self, "_disposed", False) or self.phase != "play" or self.stage != "draw":
            return
        if self._bot_turn == (self.game_no, self.turn_id):
            return
        self._bot_turn = (self.game_no, self.turn_id)
        from .words import WORDS
        lv = LEVELS[self.config["bot_level"]]
        total = self.config["draw_time"]
        topic = self.word[1]
        same = [w[0] for w in WORDS if w[1] == topic and w[0] != self.word[0]]
        for p in list(self.room.players.values()):
            if not p.is_bot or p.id not in self.order or p.id == self.drawer:
                continue
            hit = random.random() < lv["hit"] - (self.word[2] - 2) * 0.1
            t_hit = total * random.uniform(*lv["when"])
            for _ in range(random.randint(*lv["wrong"])):
                t = random.uniform(0.1, 0.95) * (t_hit if hit else total)
                asyncio.ensure_future(self._bot_guess(p.id, self.turn_id, t, random.choice(same) if same else "không biết"))
            if hit:
                asyncio.ensure_future(self._bot_guess(p.id, self.turn_id, t_hit, self.word[0]))
            if random.random() < 0.15:
                asyncio.ensure_future(self._bot_chat(p.id, self.turn_id, total * random.uniform(0.2, 0.8)))

    async def _bot_guess(self, pid, tid, delay, text):
        await asyncio.sleep(delay)
        async with self.room.lock:
            if getattr(self, "_disposed", False) or pid not in self.room.players:
                return
            if tid != self.turn_id or self.stage != "draw" or pid in self.guessed:
                return
            try:
                self._act_guess(pid, {"text": text})
            except GameError:
                return
            except Exception:
                log.exception("Lỗi AI bot Vẽ Đoán")
                return
            await self.room.broadcast_state()

    async def _bot_chat(self, pid, tid, delay):
        await asyncio.sleep(delay)
        async with self.room.lock:
            if getattr(self, "_disposed", False) or pid not in self.room.players or tid != self.turn_id:
                return
            self._post_chat("all", random.choice(CHAT), pid)
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
