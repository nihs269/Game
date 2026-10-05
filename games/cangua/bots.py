"""AI cho người chơi ảo (bot) trong Cờ Cá Ngựa.

Chấm điểm từng nước đi: đá được ngựa đối thủ, lên chuồng (bậc càng cao càng tốt), ra quân, cứu con
ngựa đang bị đối thủ rình phía sau, tránh dừng ngay trước mặt đối thủ, và ưu tiên con đã đi xa.
Hàm `_best_move` cũng dùng khi người chơi hết giờ.
"""
import asyncio
import logging
import random

from core.game_base import GameError

log = logging.getLogger("gamehub.cangua.bots")

DELAY = {"roll": (0.5, 1.0), "move": (0.5, 1.0)}
KICK_LINES = ["Về chuồng đi nhé 😎", "Xin lỗi nha 🤭", "Đá bay luôn! 💥", "Hehe 😏"]
KICKED_LINES = ["Ơ kìa 😭", "Trả thù sau! 😤", "Sao lại là tôi 😩"]
HOME_LINES = ["Lên chuồng! 🏠", "Về đích một con 🐴", "Yeah 🎉"]


class CaNguaBotMixin:
    supports_bots = True

    def _bots_reset(self):
        self._bot_pending = {}

    def _bot_jobs(self, pid):
        if self.phase == "play" and self.current == pid and self.stage in DELAY:
            return {self.stage: (self._seq, self.stage)}
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
        # Bị đá / đá được / lên chuồng thì thỉnh thoảng nói một câu.
        ev = self.events[-1] if self.events else None
        if ev and ev["type"] == "move" and self._bot_pending.get("say") != ev["seq"]:
            self._bot_pending["say"] = ev["seq"]
            mover = self.room.players.get(ev["pid"])
            kicked = ev.get("kicked")
            victim = self.room.players.get(kicked["pid"]) if kicked else None
            if kicked and mover and mover.is_bot and random.random() < 0.4:
                self._post_chat("all", random.choice(KICK_LINES), ev["pid"])
            elif kicked and victim and victim.is_bot and random.random() < 0.5:
                self._post_chat("all", random.choice(KICKED_LINES), kicked["pid"])
            elif ev.get("home") and mover and mover.is_bot and random.random() < 0.15:
                self._post_chat("all", random.choice(HOME_LINES), ev["pid"])

    async def _bot_run(self, pid, kind, key, delay):
        await asyncio.sleep(delay)
        async with self.room.lock:
            if getattr(self, "_disposed", False) or pid not in self.room.players:
                return
            if self._bot_jobs(pid).get(kind) != key:
                return
            try:
                if kind == "roll":
                    self._act_roll(pid, {})
                else:
                    self._act_move(pid, {"horse": self._best_move(pid)})
            except GameError:
                pass
            except Exception:
                log.exception("Lỗi AI bot Cờ Cá Ngựa")
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
    def _threat(self, pid, absq):
        """Có ngựa đối thủ nào đứng sau ô `absq` trong tầm 1–6 ô (đường thẳng, chưa tính cản) không."""
        from .game import TRACK, GATE, abs_of
        for q in self.order:
            if q == pid:
                continue
            c = self.color[q]
            for pos in self.horses[q]:
                if 0 <= pos < GATE:
                    gap = (absq - abs_of(c, pos)) % TRACK
                    if 1 <= gap <= 6 and pos + gap <= GATE:
                        return True
        return False

    def _best_move(self, pid):
        from .game import GATE, HOME, abs_of
        c = self.color[pid]
        best, best_score = None, None
        for h, to in self.moves.items():
            frm = self.horses[pid][h]
            score = random.random()
            if to >= HOME:
                score += 60 + (to - HOME) * 3
            elif frm == -1:
                score += 55
            else:
                score += to * 0.4
            if to <= GATE:
                occ = self._occupant(abs_of(c, to))
                if occ and occ[0] != pid:
                    score += 100
                if to < GATE and self._threat(pid, abs_of(c, to)):
                    score -= 25
                if to == GATE:
                    score += 15
            if 0 <= frm < GATE and self._threat(pid, abs_of(c, frm)):
                score += 20  # đang bị rình → chạy
            if best_score is None or score > best_score:
                best, best_score = h, score
        return best
