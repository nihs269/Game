"""AI cho người chơi ảo (bot) trong Phản Xạ: mỗi vòng bot “trả lời” sau một khoảng thời gian ngẫu nhiên
quanh tốc độ của độ khó, đúng với một xác suất (trò trí nhớ khó hơn trò bấm nhanh)."""
import asyncio
import logging
import random

from core.game_base import GameError

log = logging.getLogger("gamehub.phanxa.bots")

# Thời gian phản ứng (ms) cho vòng ⚡ và các vòng còn lại (theo tỉ lệ thời gian trả lời), tỉ lệ đúng.
LEVELS = {
    "easy": {"react": (380, 620), "think": (0.45, 0.85), "acc": 0.62, "early": 0.08},
    "normal": {"react": (290, 470), "think": (0.3, 0.65), "acc": 0.78, "early": 0.04},
    "hard": {"react": (210, 330), "think": (0.16, 0.42), "acc": 0.9, "early": 0.01},
}
MEMORY = {"sequence", "position", "count"}
CHEER = ["Nhanh như chớp ⚡", "Dễ mà 😎", "Hehe 🤭"]
SAD = ["Ơ sao sai 😭", "Run tay quá 🥲", "Nhầm rồi 🤦"]


class PhanXaBotMixin:
    supports_bots = True

    def _bots_reset(self):
        self._bot_pending = {}

    def on_state_broadcast(self):
        if getattr(self, "_disposed", False) or self.phase != "play" or self.stage != "play":
            return
        key = (self.game_no, self.round_no)
        for p in list(self.room.players.values()):
            if not p.is_bot or p.id not in self.order or self._bot_pending.get(p.id) == key:
                continue
            self._bot_pending[p.id] = key
            asyncio.ensure_future(self._bot_answer(p.id, key))

    async def _bot_answer(self, pid, key):
        lv = LEVELS[self.config["bot_level"]]
        r = self.rnd
        acc = lv["acc"] - (0.12 if r["type"] in MEMORY else 0)
        if r["type"] == "reaction":
            early = random.random() < lv["early"]
            ms = random.randint(*lv["react"])
            wait = r["content"]["wait"] / 1000
            delay = wait * random.uniform(0.4, 0.9) if early else wait + ms / 1000
            value = "early" if early else "go"
        else:
            ms = int(r["limit"] * random.uniform(*lv["think"]))
            delay = (r["show"] + ms) / 1000
            value = self._bot_value(r, random.random() < acc)
        await asyncio.sleep(delay)
        async with self.room.lock:
            if getattr(self, "_disposed", False) or pid not in self.room.players:
                return
            if (self.game_no, self.round_no) != key or self.stage != "play":
                return
            try:
                self._act_answer(pid, {"round": self.round_no, "value": value, "ms": ms})
                a = self.answers.get(pid)
                if a and random.random() < 0.08:
                    self._post_chat("all", random.choice(CHEER if a["ok"] else SAD), pid)
            except GameError:
                pass
            except Exception:
                log.exception("Lỗi AI bot Phản Xạ")
            await self.room.broadcast_state()

    def _bot_value(self, r, right):
        key = r["key"]
        if r["type"] == "sequence":
            if right:
                return list(key)
            wrong = list(key)
            i = random.randrange(len(wrong))
            wrong[i] = (wrong[i] + random.randint(1, 3)) % 4
            return wrong
        if right:
            return key
        n = len(r["content"].get("options", [])) or (r["content"].get("size", 3) ** 2)
        return random.choice([i for i in range(n) if i != key])
