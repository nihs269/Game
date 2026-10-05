"""AI cho người chơi ảo (bot) trong Nối Từ.

Bot tra từ điển để nối, độ khó (chủ phòng chọn) quyết định tốc độ, tỉ lệ “bí” và độ hiểm:
  dễ    — nghĩ lâu, hay bí, chỉ dùng từ thông dụng;
  vừa   — thỉnh thoảng bí, đôi khi chọn từ ít đường nối;
  khó   — nhanh, hiếm khi bí, ưu tiên từ chặn / từ ít đường nối để dồn người sau.
"""
import asyncio
import logging
import random

from core.game_base import GameError

log = logging.getLogger("gamehub.noitu.bots")

LEVELS = {
    "easy": {"think": (4.0, 9.0), "miss": 0.22, "trap": 0.0, "kill": 0.0},
    "normal": {"think": (2.5, 6.0), "miss": 0.08, "trap": 0.15, "kill": 0.2},
    "hard": {"think": (1.5, 4.0), "miss": 0.02, "trap": 0.45, "kill": 0.5},
}
WIN_LINES = ["Nối đi nào 😏", "Từ này khó nha 😎", "Hehe 🤭"]
FAIL_LINES = ["Chịu thôi 😅", "Bí rồi 😭", "Quên mất từ 🤯", "Ơ…"]
VOTE_DELAY = (1.5, 4.0)


class NoiTuBotMixin:
    supports_bots = True

    def _bots_reset(self):
        self._bot_pending = {}

    def _bot_jobs(self, pid):
        if self.phase != "play":
            return {}
        if self.stage == "turn" and self.cur == pid:
            return {"say": (self._seq, "say")}
        if self.stage == "vote" and self.vote and pid in self.vote["voters"] and pid not in self.vote["votes"]:
            return {"vote": (self._seq, "vote")}
        return {}

    def _bot_delay(self, kind):
        if kind == "vote":
            return random.uniform(*VOTE_DELAY)
        lo, hi = LEVELS[self.config["bot_level"]]["think"]
        limit = max(1.0, self.config["turn_time"] - 1.5)
        return min(random.uniform(lo, hi), limit)

    def on_state_broadcast(self):
        if getattr(self, "_disposed", False):
            return
        for p in list(self.room.players.values()):
            if not p.is_bot:
                continue
            for kind, key in self._bot_jobs(p.id).items():
                if self._bot_pending.get(p.id) == key:
                    continue
                self._bot_pending[p.id] = key
                asyncio.ensure_future(self._bot_run(p.id, kind, key, self._bot_delay(kind)))

    async def _bot_run(self, pid, kind, key, delay):
        await asyncio.sleep(delay)
        async with self.room.lock:
            if getattr(self, "_disposed", False) or pid not in self.room.players:
                return
            if self._bot_jobs(pid).get(kind) != key:
                return
            try:
                if kind == "say":
                    self._bot_say(pid)
                else:
                    self._act_vote(pid, {"yes": random.random() < 0.65})
            except GameError:
                pass
            except Exception:
                log.exception("Lỗi AI bot Nối Từ")
            await self.room.broadcast_state()

    def _bot_say(self, pid):
        from .dictionary import DICT
        lv = LEVELS[self.config["bot_level"]]
        cands = DICT.nexts(self.word, self.used)
        if not cands or random.random() < lv["miss"]:
            if random.random() < 0.5:
                self._post_chat("all", random.choice(FAIL_LINES), pid)
            self._act_giveup(pid, {})
            return
        common = [k for k in cands if k in DICT.common]
        pool = common if (common and (self.config["bot_level"] != "hard" or random.random() < 0.5)) else cands
        pick = random.choice(pool)
        if random.random() < lv["trap"]:
            # Chọn từ ít đường nối để dồn người kế tiếp; dùng hẳn từ chặn (0 đường nối) chỉ thỉnh thoảng.
            scored = [(len(DICT.nexts(k, self.used | {k})), random.random(), k) for k in pool]
            kills = [k for n, _, k in scored if n == 0]
            hard = sorted(x for x in scored if x[0] > 0)
            if kills and random.random() < lv["kill"]:
                pick = random.choice(kills)
            elif hard:
                pick = random.choice(hard[:3])[2]
        self._act_say(pid, {"text": DICT.show(pick)})
        if not DICT.nexts(pick, self.used) and random.random() < 0.5:
            self._post_chat("all", random.choice(WIN_LINES), pid)

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
