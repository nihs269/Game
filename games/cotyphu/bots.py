"""AI cho người chơi ảo (bot) trong Cờ Tỷ Phú (kiểu Business Tour).

Bot giữ một khoản dự phòng tăng dần theo vòng chơi; mua đất và xây cấp cao nhất còn đủ tiền; mua lại
đất của đối thủ khi việc đó giúp gom đủ bộ vùng (nhất là khi mua xong là thắng luôn); tổ chức World
Championship ở thành phố thu nhiều tiền nhất; dùng World Tour để bay tới ô có lợi nhất.
"""
import asyncio
import logging
import random

from core.game_base import GameError

log = logging.getLogger("gamehub.cotyphu.bots")

DELAY = {"roll": (0.8, 1.6), "island": (0.9, 1.6), "tour": (1.0, 1.8), "buy": (0.9, 1.8),
         "upgrade": (0.8, 1.5), "buyout": (1.0, 2.0), "champ": (0.9, 1.6), "debt": (1.0, 1.8)}
BUY_LINES = ["Chốt đơn! 🏙️", "Thành phố đẹp đấy 😎", "Đầu tư dài hạn 📈"]
BUYOUT_LINES = ["Cảm ơn nhé, giờ là của tôi 😏", "Mua lại luôn! 🤝", "Xin phép nha 😇"]
RENT_LINES = ["Đắt quá 😭", "Lại mất tiền 💸", "Chủ đất ơi nhẹ tay thôi!"]


class TyPhuBotMixin:
    supports_bots = True

    def _bots_reset(self):
        self._bot_pending = {}

    def _bot_jobs(self, pid):
        if self.phase == "play" and self.current == pid and self.stage in DELAY:
            return {self.stage: (self._seq, self.stage, self.pending)}
        return {}

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
                asyncio.ensure_future(self._bot_run(p.id, kind, key, random.uniform(*DELAY[kind])))

    async def _bot_run(self, pid, kind, key, delay):
        await asyncio.sleep(delay)
        async with self.room.lock:
            if getattr(self, "_disposed", False) or pid not in self.room.players:
                return
            if self._bot_jobs(pid).get(kind) != key:
                return
            try:
                getattr(self, "_bot_" + kind)(pid)
            except GameError:
                try:
                    self._auto()
                except Exception:
                    pass
            except Exception:
                log.exception("Lỗi AI bot Cờ Tỷ Phú")
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

    # ------------------------------------------------------------------ đánh giá
    def _reserve(self):
        return 120 + 20 * self.round

    def _say(self, pid, lines, chance):
        if random.random() < chance:
            self._post_chat("all", random.choice(lines), pid)

    def _wins_if_owned(self, pid, i):
        """Sở hữu thêm ô `i` thì có thắng ngay không (độc quyền 3 vùng / cạnh bàn / nghỉ dưỡng)."""
        from .game import GROUPS, SIDES, RESORTS
        own = set(self._owned(pid)) | {i}
        if sum(1 for g in GROUPS if all(j in own for j in self._group_of(g))) >= 3:
            return True
        if any(all(j in own for j in side) for side in SIDES):
            return True
        return all(j in own for j in RESORTS)

    def _group_of(self, g):
        from .game import GROUP_MEMBERS
        return GROUP_MEMBERS[g]

    def _completes(self, pid, i):
        from .game import SQ
        if SQ[i]["type"] != "city":
            return False
        return all(self.props[j]["owner"] == pid for j in self._group_of(SQ[i]["group"]) if j != i)

    def _blocks(self, pid, i):
        from .game import SQ
        if SQ[i]["type"] != "city":
            return False
        others = {self.props[j]["owner"] for j in self._group_of(SQ[i]["group"]) if j != i}
        return len(others) == 1 and None not in others and pid not in others

    # ------------------------------------------------------------------ quyết định
    def _bot_roll(self, pid):
        self._act_roll(pid, {})

    def _bot_island(self, pid):
        from .game import ISLAND_FEE
        if self.cards[pid]["escape"]:
            self._act_use_escape(pid, {})
        elif self.round <= 8 and self.money[pid] - ISLAND_FEE >= self._reserve() + 200:
            self._act_pay_island(pid, {})
        self._act_roll(pid, {})

    def _bot_tour(self, pid):
        from .game import SQ, TOUR, TOUR_FEE, N, level_cost
        budget = self.money[pid] - TOUR_FEE
        best, best_score = None, 0
        for i in range(N):
            if i == TOUR:
                continue
            p = self.props.get(i)
            score = 0
            if p is not None and p["owner"] is None and budget >= SQ[i]["price"]:
                score = 30 + (200 if self._wins_if_owned(pid, i) else 0) + (60 if self._completes(pid, i) else 0) + (20 if self._blocks(pid, i) else 0)
            elif p is not None and p["owner"] == pid and SQ[i]["type"] == "city":
                nxt = self._build_levels(pid, p["level"])
                if nxt and budget >= level_cost(i, p["level"], nxt[0]) + self._reserve():
                    score = 25 + p["level"] * 5
            if score > best_score:
                best, best_score = i, score
        if best is not None and budget >= 0:
            self._act_tour(pid, {"square": best})
        else:
            self._act_roll(pid, {})

    def _bot_buy(self, pid):
        from .game import SQ
        i = self.pending
        s = SQ[i]
        money = self.money[pid]
        key = self._wins_if_owned(pid, i) or self._completes(pid, i) or self._blocks(pid, i)
        if s["type"] == "resort":
            if money - s["price"] >= self._reserve() or (key and money >= s["price"]):
                self._act_buy(pid, {})
                self._say(pid, BUY_LINES, 0.1)
            else:
                self._act_skip(pid, {})
            return
        self._build_best(pid, must=key or money - s["price"] >= self._reserve())

    def _bot_upgrade(self, pid):
        self._build_best(pid, must=False)

    def _build_best(self, pid, must):
        levels = [o for o in (self.view(pid)["offer"] or {}).get("levels", [])]
        affordable = [o for o in levels if self.money[pid] - o["cost"] >= self._reserve()]
        if affordable:
            self._act_buy(pid, {"level": affordable[-1]["level"]})
            self._say(pid, BUY_LINES, 0.08)
        elif must and levels and self.money[pid] >= levels[0]["cost"]:
            self._act_buy(pid, {"level": levels[0]["level"]})
        else:
            self._act_skip(pid, {})

    def _bot_buyout(self, pid):
        i = self.pending
        price = self._buyout_price(i)
        money = self.money[pid]
        if money >= price and (self._wins_if_owned(pid, i) or
                               (self._completes(pid, i) and money - price >= self._reserve() // 2) or
                               (self._blocks(pid, i) and money - price >= self._reserve()) or
                               money - price >= self._reserve() * 3):
            self._act_buyout(pid, {})
            self._say(pid, BUYOUT_LINES, 0.4)
        else:
            self._act_skip(pid, {})

    def _bot_champ(self, pid):
        from .game import SQ
        mine = [i for i in self._owned(pid) if SQ[i]["type"] == "city"]
        if mine:
            self._act_champ(pid, {"square": max(mine, key=self._rent)})
        else:
            self._act_skip(pid, {})

    def _bot_debt(self, pid):
        if self._raisable(pid) >= self.debt["amount"]:
            self._act_auto_pay(pid, {})
            self._say(pid, RENT_LINES, 0.3)
        else:
            self._act_bankrupt(pid, {})
