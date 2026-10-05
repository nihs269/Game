"""AI cho người chơi ảo (bot) trong Poker.

Bot ước lượng xác suất thắng bằng mô phỏng Monte Carlo (tay bài của mình trước các tay
ngẫu nhiên của đối thủ), so với tỉ lệ pot để quyết định bỏ / theo / tố, và thỉnh thoảng bluff.
Mỗi bot có “tính cách” riêng: độ liều (aggression) và độ lỳ (hay theo bài) khác nhau.
"""
import asyncio
import logging
import random

from core.game_base import GameError
from .hands import equity

log = logging.getLogger("gamehub.poker.bots")

TURN_DELAY = (1.2, 3.0)
RAISE_LINES = ["Tố! 💰", "Dám theo không? 😏", "Hôm nay tôi hên lắm 🍀", "Chơi lớn đi!"]
ALLIN_LINES = ["ALL-IN! 🔥", "Tất tay luôn!", "Được ăn cả, ngã về không 😤"]
FOLD_LINES = ["Bài xấu quá 😩", "Thôi, nhường đấy", "Lần sau nhé…"]
WIN_LINES = ["Ngon! 😎", "Cảm ơn nhé 💸", "Đã bảo mà 😏", "GG"]


class PokerBotMixin:
    supports_bots = True

    def _bots_reset(self):
        self._bot_pending = {}
        self._bot_style = {}

    def _bot_jobs(self, pid):
        if self.phase == "play" and self.stage == "bet" and self.cur == pid:
            return {"turn": (self.hand_no, self._seq)}
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
                asyncio.ensure_future(self._bot_run(p.id, kind, key, random.uniform(*TURN_DELAY)))
        # Thắng pot thì thỉnh thoảng khoe một câu.
        ev = self.events[-1] if self.events else None
        if ev and ev["type"] == "win" and self._bot_pending.get("win") != ev["seq"]:
            self._bot_pending["win"] = ev["seq"]
            bots = [w for w in ev.get("pids", []) if self.room.players.get(w) and self.room.players[w].is_bot]
            if bots and random.random() < 0.35:
                self._post_chat("all", random.choice(WIN_LINES), random.choice(bots))

    async def _bot_run(self, pid, kind, key, delay):
        await asyncio.sleep(delay)
        async with self.room.lock:
            if getattr(self, "_disposed", False) or pid not in self.room.players:
                return
            if self._bot_jobs(pid).get(kind) != key:
                return
            try:
                self._bot_turn(pid)
            except GameError:
                try:
                    self._move(pid, "check" if self.options(pid)["canCheck"] else "fold")
                except Exception:
                    pass
            except Exception:
                log.exception("Lỗi AI bot Poker")
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
    def _style(self, pid):
        if pid not in self._bot_style:
            self._bot_style[pid] = {"aggr": random.uniform(0.7, 1.4), "loose": random.uniform(0.85, 1.15)}
        return self._bot_style[pid]

    def _bot_turn(self, pid):
        opt = self.options(pid)
        if opt is None:
            return
        st = self._style(pid)
        opponents = len(self._alive()) - 1
        eq = equity(self.hole[pid], self.board, opponents, sims=160 if self.board else 120)
        strength = eq * (opponents + 1)          # 1.0 = trung bình so với số người còn lại
        pot = self._pot()
        to_call = opt["toCall"]
        odds = to_call / (pot + to_call) if to_call else 0
        chips = self.chips[pid]
        r = random.random()

        def raise_to(frac):
            target = opt["currentBet"] + int((pot + to_call) * frac * st["aggr"])
            target = max(opt["minTo"], min(opt["maxTo"], target))
            if target >= opt["bet"] + chips * 0.85:
                target = opt["maxTo"]
            return target

        def do_raise(frac):
            target = raise_to(frac)
            self._move(pid, "raise", target)
            allin = pid in self.allin
            if random.random() < (0.5 if allin else 0.15):
                self._post_chat("all", random.choice(ALLIN_LINES if allin else RAISE_LINES), pid)

        if to_call == 0:
            if opt["canRaise"] and (strength > 1.8 / st["aggr"] and r < 0.7 or r < 0.06 * st["aggr"]):
                do_raise(random.uniform(0.45, 0.9))
            else:
                self._move(pid, "check")
            return

        # Phải bỏ chip ra để theo. Đối thủ vừa tố thường có bài khá hơn bài ngẫu nhiên,
        # nên đòi hỏi xác suất thắng cao hơn tỉ lệ pot, càng cao khi bị tố mạnh.
        pressure = to_call / max(pot, 1)
        need = (odds + 0.08 + 0.12 * pressure) / st["loose"]
        if not self.board:
            need = max(need, 0.9 / (opponents + 1) / st["loose"])  # bỏ bài rác trước flop
        if to_call >= chips * 0.5:
            need += 0.1  # sắp phải tất tay
        if eq < need and r > 0.03:
            self._move(pid, "fold")
            if random.random() < 0.1:
                self._post_chat("all", random.choice(FOLD_LINES), pid)
            return
        if opt["canRaise"] and strength > 2.2 / st["aggr"] and eq > need + 0.15 and r < 0.5:
            do_raise(random.uniform(0.5, 1.0))
            return
        self._move(pid, "call")
