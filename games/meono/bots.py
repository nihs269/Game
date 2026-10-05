"""AI cho người chơi ảo (bot) trong Mèo Nổ.

Bot biết đếm: càng ít bài mà còn nhiều Mèo Nổ thì càng dè chừng — dùng Tiên Tri
để xem trước, Bỏ Lượt / Tấn Công / Xáo Bài để né khi biết lá trên cùng là bom.
Bot dùng “Không!” để chặn những đòn nhắm vào mình, và đôi khi chặn ngược lại.
"""
import asyncio
import logging
import random
from collections import Counter

from core.game_base import GameError

log = logging.getLogger("gamehub.meono.bots")

TURN_DELAY = (1.2, 2.6)
NOPE_DELAY = (0.8, 2.2)
GIVE_DELAY = (1.0, 2.5)
INSERT_DELAY = (1.5, 3.0)
MAX_PLAYS = 3  # số lá tối đa bot đánh trong một lượt trước khi rút
CATS = {"taco", "melon", "potato", "beard", "rainbow"}

# lá “rẻ” nhất đưa đi trước khi bị Xin Xỏ
GIVE_ORDER = ["taco", "melon", "potato", "beard", "rainbow", "shuffle", "favor", "future", "skip", "attack", "nope", "defuse"]
BOOM_LINES = ["💥 Á á á!", "Không thể tin nổi 😭", "GG… mèo nổ banh xác 🙀", "Ai nhét bom chỗ này vậy 😤"]
DEFUSE_LINES = ["Phù… suýt chết 😅", "Hên quá có Gỡ Bom 🧯", "Hehe, bom này để dành cho người sau 😏"]
NOPE_LINES = ["Không nhé! 🚫", "Đừng hòng 😤", "Mơ đi 😎"]


class MeoNoBotMixin:
    supports_bots = True

    def _bots_reset(self):
        self._bot_pending = {}
        self._bot_plays = Counter()

    def _is_bot(self, pid):
        p = self.room.players.get(pid)
        return bool(p and p.is_bot)

    # ------------------------------------------------------------------ lên lịch
    def _bot_jobs(self, pid):
        if self.phase != "play" or pid not in self.alive:
            return {}
        w = self.wait
        if w is None:
            if pid == self.current:
                return {"turn": (self.round, self._seq)}
            return {}
        if w["kind"] == "nope":
            if self._find(pid, "nope"):
                return {"nope": (self.round, w["seq"], w["nopes"])}
        elif w["kind"] == "favor" and w["target"] == pid:
            return {"give": (self.round, self._seq)}
        elif w["kind"] == "defuse" and w["pid"] == pid:
            return {"insert": (self.round, self._seq)}
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
                if kind == "nope" and not self._bot_wants_nope(p.id):
                    continue
                lo, hi = {"turn": TURN_DELAY, "nope": NOPE_DELAY, "give": GIVE_DELAY, "insert": INSERT_DELAY}[kind]
                delay = random.uniform(lo, hi)
                if kind == "nope":
                    delay = min(delay, self.config["nope_time"] - 0.6)
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
                elif kind == "nope":
                    self._act_nope(pid, {})
                    if random.random() < 0.3:
                        self._post_chat("all", random.choice(NOPE_LINES), pid)
                elif kind == "give":
                    self._bot_give(pid)
                else:
                    self._bot_insert(pid)
            except GameError:
                pass
            except Exception:
                log.exception("Lỗi AI bot Mèo Nổ")
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
    def _bot_wants_nope(self, pid):
        w = self.wait
        effective = w["nopes"] % 2 == 0   # hành động hiện đang có hiệu lực
        if w["pid"] == pid:
            return not effective and random.random() < 0.6   # bị chặn → chặn ngược
        if not effective:
            return False
        hurts_me = w["target"] == pid or (w["action"] == "attack" and self._next_alive(w["pid"]) == pid)
        if hurts_me:
            return random.random() < 0.65
        return random.random() < 0.05

    def _bot_turn(self, pid):
        hand = self.hands[pid]
        have = Counter(c["t"] for c in hand)
        plays = self._bot_plays[(pid, self.turn_no)]
        future = self._future(pid)
        top_bomb = bool(future and future[0]["t"] == "kitten")
        danger = (len(self.alive) - 1) / max(1, len(self.deck))

        def play(t, count=1, target=None, name=None):
            ids = [c["id"] for c in hand if c["t"] == t][:count]
            self._bot_plays[(pid, self.turn_no)] += 1
            self._act_play(pid, {"cards": ids, "target": target, "name": name})

        def rich_target():
            others = [q for q in self.alive if q != pid and self.hands.get(q)]
            if not others:
                return None
            return max(others, key=lambda q: (len(self.hands[q]), random.random()))

        if plays < MAX_PLAYS:
            if top_bomb:
                for t in ("skip", "attack", "shuffle"):
                    if have[t]:
                        return play(t)
            if self.turns_left > 1 and have["attack"] and random.random() < 0.6:
                return play("attack")
            if future is None and have["future"] and danger > 0.15 and random.random() < 0.6:
                return play("future")
            target = rich_target()
            if target and not (future and not top_bomb):
                pairs = [t for t in have if t in CATS and have[t] >= 2]
                if pairs and random.random() < 0.55:
                    t = random.choice(pairs)
                    if have[t] >= 3:
                        return play(t, 3, target, "defuse")
                    return play(t, 2, target)
                if have["favor"] and random.random() < 0.3:
                    return play("favor", target=target)
            if not have["defuse"] and danger > 0.3 and not (future and not top_bomb):
                for t in ("skip", "attack"):
                    if have[t]:
                        return play(t)
                if have["shuffle"] and random.random() < 0.5:
                    return play("shuffle")
        self._act_draw(pid, {})
        if self.phase == "play" and pid not in self.alive and random.random() < 0.6:
            self._post_chat("all", random.choice(BOOM_LINES), pid)

    def _bot_give(self, pid):
        hand = self.hands[pid]
        card = min(hand, key=lambda c: (GIVE_ORDER.index(c["t"]) if c["t"] in GIVE_ORDER else 99, random.random()))
        self._act_give(pid, {"card": card["id"]})

    def _bot_insert(self, pid):
        if random.random() < 0.45:
            pos = 0  # để ngay trên cùng cho người kế tiếp
        elif random.random() < 0.5:
            pos = random.randint(0, min(3, len(self.deck)))
        else:
            pos = "random"
        self._act_insert(pid, {"pos": pos})
        if random.random() < 0.4:
            self._post_chat("all", random.choice(DEFUSE_LINES), pid)
