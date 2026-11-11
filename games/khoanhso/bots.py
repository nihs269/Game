"""AI cho người chơi ảo (bot) trong Khoanh Số: mỗi khi số cần tìm đổi, bot “dò” tờ giấy trong một
khoảng thời gian ngẫu nhiên (tờ giấy càng nhiều số càng lâu) rồi khoanh — nếu chưa ai khoanh trước."""
import asyncio
import logging
import random
import time

from core.game_base import GameError

log = logging.getLogger("gamehub.khoanhso.bots")

# Thời gian tìm một số (giây) với tờ giấy 50 số; tỉ lệ thỉnh thoảng bấm nhầm.
LEVELS = {
    "easy": {"find": (3.0, 7.5), "miss": 0.06},
    "normal": {"find": (1.8, 4.6), "miss": 0.04},
    "hard": {"find": (1.0, 2.8), "miss": 0.02},
}
CHEER = ["Thấy rồi! 😎", "Của tui 🤭", "Hehe ✍️", "Nhanh tay nè ⚡"]


class KhoanhSoBotMixin:
    supports_bots = True

    def _bots_reset(self):
        self._bot_pending = {}

    def on_state_broadcast(self):
        if getattr(self, "_disposed", False) or self.phase != "play" or self.stage != "play":
            return
        key = (self.game_no, self.target)
        for p in list(self.room.players.values()):
            if not p.is_bot or p.id not in self.order or self._bot_pending.get(p.id) == key:
                continue
            self._bot_pending[p.id] = key
            asyncio.ensure_future(self._bot_find(p.id, key))

    async def _bot_find(self, pid, key):
        lv = LEVELS[self.config["bot_level"]]
        scale = 0.55 + 0.45 * self.size / 50
        delay = random.uniform(*lv["find"]) * scale
        # Bot đang bị khoá bút thì phải chờ hết khoá.
        delay = max(delay, self.lock_until.get(pid, 0) - time.time() + 0.1)
        await asyncio.sleep(delay)
        async with self.room.lock:
            if getattr(self, "_disposed", False) or pid not in self.room.players:
                return
            if (self.game_no, self.target) != key or self.phase != "play" or self.stage != "play":
                return
            try:
                if random.random() < lv["miss"] and self.target < self.size:
                    wrong = random.choice([k for k in range(self.target + 1, self.size + 1) if self.owner[k - 1] is None])
                    self._act_circle(pid, {"n": wrong})
                    # Bị khoá bút → thử lại số này sau khi hết khoá.
                    self._bot_pending.pop(pid, None)
                else:
                    self._act_circle(pid, {"n": self.target})
                    if random.random() < 0.04:
                        self._post_chat("all", random.choice(CHEER), pid)
            except GameError:
                pass
            except Exception:
                log.exception("Lỗi AI bot Khoanh Số")
            await self.room.broadcast_state()
