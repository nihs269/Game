"""AI cho người chơi ảo (bot) trong Hiểu Ý Nhau: trả lời ngẫu nhiên theo lựa chọn / câu mẫu, khi đoán về
người khác thì thỉnh thoảng “hiểu” đúng (chép câu trả lời thật), bot được hỏi thì chấm theo máy."""
import asyncio
import logging
import random

from core.game_base import GameError

log = logging.getLogger("gamehub.hieuy.bots")

KNOW = 0.4   # xác suất bot đoán trúng ý người khác
CHAT = ["Biết ngay mà 😎", "Ơ thật á 😳", "Hiểu nhau quá trời 💞", "Sai bét 🤦", "Hehe 🤭"]


class HieuYBotMixin:
    supports_bots = True

    def _bots_reset(self):
        self._bot_pending = {}

    def on_state_broadcast(self):
        if getattr(self, "_disposed", False) or self.phase != "play" or self.stage not in ("answer", "judge"):
            return
        key = (self.game_no, self.round_no, self.stage)
        r = self.rnd
        for p in list(self.room.players.values()):
            if not p.is_bot or p.id not in self.order or self._bot_pending.get(p.id) == key:
                continue
            if self.stage == "judge" and p.id not in r["who"]:
                continue
            self._bot_pending[p.id] = key
            delay = random.uniform(1.5, 3) if self.stage == "judge" else random.uniform(3, 9)
            asyncio.ensure_future(self._bot_act(p.id, key, delay))

    async def _bot_act(self, pid, key, delay):
        await asyncio.sleep(delay)
        async with self.room.lock:
            if getattr(self, "_disposed", False) or pid not in self.room.players:
                return
            if (self.game_no, self.round_no, self.stage) != key:
                return
            r = self.rnd
            try:
                if self.stage == "judge" and r["type"] == "single":
                    self._act_judge_done(pid, {})
                elif self.stage == "judge":
                    # Máy đã không khớp được hai câu → bot coi là khác thật.
                    self._act_agree(pid, {"on": False, "final": True})
                elif r["type"] == "pair" and pid not in r["who"]:
                    self._act_predict(pid, {"round": self.round_no, "same": random.random() < 0.45})
                elif pid in r["who"]:
                    self._act_answer(pid, {"round": self.round_no, "value": self._bot_value(r)})
                else:
                    truth = r["answers"].get(r["who"][0])
                    value = truth if truth is not None and random.random() < KNOW else self._bot_value(r)
                    self._act_answer(pid, {"round": self.round_no, "value": value})
                if random.random() < 0.06:
                    self._post_chat("all", random.choice(CHAT), pid)
            except GameError:
                pass
            except Exception:
                log.exception("Lỗi AI bot Hiểu Ý Nhau")
            await self.room.broadcast_state()

    def _bot_value(self, r):
        if r["options"]:
            return random.randrange(len(r["options"]))
        return random.choice(r["samples"] or ["Không biết"])
