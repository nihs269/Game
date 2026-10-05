"""AI cho người chơi ảo (bot) trong Ma Sói.

Bot hành động sau một khoảng trễ ngẫu nhiên cho giống người thật, và có vài
"suy luận" đơn giản: Tiên Tri soi ra Sói sẽ tố cáo vào ban ngày, dân làng nghe
theo lời tố cáo khi bỏ phiếu, bầy Sói bám theo mục tiêu của đồng bọn...
"""
import asyncio
import logging
import random
from collections import Counter

from core.game_base import GameError

log = logging.getLogger("gamehub.werewolf.bots")

DELAYS = {
    "reveal": (1, 3), "wolf_vote": (2, 5), "seer": (2, 6), "guard": (2, 6), "witch": (3, 7),
    "discuss": (5, 12), "vote": (3, 9), "hunter": (2, 5),
}

SUSPECT_LINES = [
    "Mình thấy {x} đáng nghi lắm 🤔",
    "{x} nãy giờ im im, hơi lạ đó nha.",
    "Linh cảm của mình là {x} có vấn đề.",
    "Có ai thấy {x} lươn lẹo không?",
    "Vote {x} đi mọi người!",
]
DEFENSE_LINES = [
    "Mình là dân thường thôi, đừng treo mình nha 😅",
    "Đêm qua mình ngủ say lắm, chẳng biết gì cả.",
    "Mọi người bình tĩnh, suy nghĩ kỹ rồi hãy vote.",
    "Hmm… khó đoán thật.",
]


class WerewolfBotMixin:
    supports_bots = True

    def _bots_reset(self):
        self._bot_pending = {}
        self._bot_seen = {}        # bot tiên tri -> {pid: là sói?}
        self._accuse = Counter()   # mức độ bị tố cáo trong ngày
        self._seer_claim = None    # pid tự nhận là Tiên Tri (đáng tin với bot)
        self._known_wolves = set() # sói bị Tiên Tri công khai
        self._bot_talked = set()

    def _is_bot(self, pid):
        p = self.room.players.get(pid)
        return bool(p and p.is_bot)

    # ------------------------------------------------------------------ lên lịch
    def _bot_key(self, pid):
        a = self._action_for(pid) if pid in self.roles and self.phase != "lobby" else None
        if not a or a["kind"] not in DELAYS:
            return None
        if a["kind"] == "reveal" and a["done"]:
            return None
        if a["kind"] == "discuss" and a["ready"]:
            return None
        key = (self.phase, self.round, a["kind"])
        if a["kind"] == "wolf_vote":
            others = tuple(sorted((w, t) for w, t in self.night["wolf_votes"].items() if w != pid))
            key += (others,)
        return key

    def on_state_broadcast(self):
        if getattr(self, "_disposed", False):
            return
        for p in list(self.room.players.values()):
            if not p.is_bot:
                continue
            key = self._bot_key(p.id)
            if key is None or self._bot_pending.get(p.id) == key:
                continue
            self._bot_pending[p.id] = key
            lo, hi = DELAYS[key[2]]
            asyncio.ensure_future(self._bot_run(p.id, key, random.uniform(lo, hi)))

    async def _bot_run(self, pid, key, delay):
        await asyncio.sleep(delay)
        async with self.room.lock:
            if getattr(self, "_disposed", False) or pid not in self.room.players:
                return
            if self._bot_key(pid) != key:
                return
            try:
                self._bot_decide(pid, self._action_for(pid))
            except GameError:
                pass
            except Exception:
                log.exception("Lỗi AI bot")
            await self.room.broadcast_state()

    # ------------------------------------------------------------------ tương tác
    def on_fx(self, from_pid, to_pid, kind):
        """Bot bị tương tác thì phản ứng lại cho vui."""
        if not to_pid or not self._is_bot(to_pid) or self._is_bot(from_pid):
            return
        if kind == "tomato":
            reply = random.choice([("tomato", from_pid), ("angry", None), ("cry", None)])
        elif kind in ("heart", "flower"):
            reply = random.choice([("heart", from_pid), ("laugh", None), ("dance", None)])
        elif kind == "wave":
            reply = ("wave", from_pid)
        elif kind == "highfive":
            reply = ("highfive", from_pid)
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
    def _bot_decide(self, pid, a):
        kind = a["kind"]
        if kind == "reveal":
            self._act_ready(pid, {})
        elif kind == "wolf_vote":
            self._bot_wolf(pid, a)
        elif kind == "seer":
            self._bot_seer(pid, a)
        elif kind == "guard":
            self._bot_guard(pid, a)
        elif kind == "witch":
            self._bot_witch(pid, a)
        elif kind == "discuss":
            self._bot_discuss(pid)
        elif kind == "vote":
            self._bot_vote(pid, a)
        elif kind == "hunter":
            self._bot_hunter(pid, a)

    def _bot_wolf(self, pid, a):
        targets = a["targets"]
        if not targets:
            return
        mates = Counter(t for w, t in self.night["wolf_votes"].items() if w != pid and t in targets)
        if mates:
            target = mates.most_common(1)[0][0]  # bám theo đồng bọn để thống nhất
        else:
            # ưu tiên người tự nhận Tiên Tri, rồi đến người hay tố cáo đúng
            target = self._seer_claim if self._seer_claim in targets else random.choice(targets)
        if a.get("selected") != target:
            self._act_wolf_vote(pid, {"target": target})

    def _bot_seer(self, pid, a):
        seen = self._bot_seen.setdefault(pid, {})
        fresh = [t for t in a["targets"] if t not in seen] or a["targets"]
        target = random.choice(fresh)
        self._act_seer(pid, {"target": target})
        seen[target] = self._is_wolf(target)

    def _bot_guard(self, pid, a):
        targets = a["targets"]
        if self._seer_claim in targets and random.random() < 0.7:
            target = self._seer_claim
        elif pid in targets and random.random() < 0.3:
            target = pid
        else:
            target = random.choice(targets)
        self._act_guard(pid, {"target": target})

    def _bot_witch(self, pid, a):
        heal = bool(a["canHeal"] and (a["victim"] == pid or a["victim"] == self._seer_claim or random.random() < 0.55))
        poison = None
        if a["canPoison"]:
            wolves = [t for t in a["targets"] if t in self._known_wolves]
            if wolves:
                poison = random.choice(wolves)
            elif self.round >= 2 and random.random() < 0.15:
                poison = random.choice(a["targets"])
        self._act_witch(pid, {"heal": heal, "target": poison})

    def _bot_discuss(self, pid):
        if pid not in self._bot_talked and random.random() < 0.75:
            self._bot_talked.add(pid)
            self._bot_say(pid)
        self._act_ready(pid, {})

    def _bot_say(self, pid):
        alive_others = [p for p in self.order if p in self.alive and p != pid]
        if not alive_others:
            return
        role = self.roles[pid]
        text = None
        if role == "seer":
            seen = self._bot_seen.get(pid, {})
            wolves = [t for t, w in seen.items() if w and t in self.alive]
            if wolves:
                w = wolves[0]
                text = f"Mình là Tiên Tri! Mình đã soi {self._name(w)} — đó là SÓI 🐺. Treo ngay!"
                self._seer_claim = pid
                self._known_wolves.add(w)
                self._accuse[w] += 5
            elif seen and random.random() < 0.5:
                g = random.choice(list(seen))
                text = f"Mình đảm bảo {self._name(g)} là người tốt."
                self._accuse[g] -= 2
        elif role == "werewolf":
            others = [p for p in alive_others if not self._is_wolf(p)]
            if others:
                x = self._seer_claim if self._seer_claim in others and random.random() < 0.5 else random.choice(others)
                if x == self._seer_claim:
                    text = f"{self._name(x)} nhận Tiên Tri là giả đó, đừng tin!"
                else:
                    text = random.choice(SUSPECT_LINES).format(x=self._name(x))
                self._accuse[x] += 1
                if random.random() < 0.4:
                    self._bot_emit(pid, x, "poke", 0.5)
        if text is None:
            if random.random() < 0.6:
                x = random.choice(alive_others)
                text = random.choice(SUSPECT_LINES).format(x=self._name(x))
                self._accuse[x] += 1
                if random.random() < 0.4:
                    self._bot_emit(pid, x, "poke", 0.5)
            else:
                text = random.choice(DEFENSE_LINES)
                if random.random() < 0.5:
                    self._bot_emit(pid, None, random.choice(["think", "cry", "laugh"]), 0.3)
        self._post_chat("all", text, pid)

    def _bot_vote(self, pid, a):
        targets = a["targets"]
        if not targets:
            self._act_vote(pid, {"target": "skip"})
            return
        role = self.roles[pid]
        if role == "seer":
            wolves = [t for t, w in self._bot_seen.get(pid, {}).items() if w and t in targets]
            if wolves:
                self._act_vote(pid, {"target": wolves[0]})
                return
        current = Counter(v for v in self.votes.values() if v in targets)
        if role == "werewolf":
            pool = [t for t in targets if not self._is_wolf(t)] or targets
            weights = [1 + 2 * current[t] + 2 * max(0, self._accuse[t]) + (3 if t == self._seer_claim else 0) for t in pool]
        else:
            if random.random() < 0.1:
                self._act_vote(pid, {"target": "skip"})
                return
            pool = [t for t in targets if t != self._seer_claim]  or targets
            weights = [1 + 2 * current[t] + 3 * max(0, self._accuse[t]) + (8 if t in self._known_wolves else 0) for t in pool]
        target = random.choices(pool, weights=weights, k=1)[0]
        self._act_vote(pid, {"target": target})

    def _bot_hunter(self, pid, a):
        targets = [t for t in a["targets"] if t != pid]
        if not targets:
            self._act_shoot(pid, {"target": None})
            return
        wolves = [t for t in targets if t in self._known_wolves]
        if wolves:
            target = wolves[0]
        else:
            target = max(targets, key=lambda t: (self._accuse[t], random.random()))
        self._act_shoot(pid, {"target": target})
