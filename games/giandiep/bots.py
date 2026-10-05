"""AI cho người chơi ảo (bot) trong Gián Điệp.

Bot cũng KHÔNG biết mình thuộc phe nào — chỉ biết từ khoá của mình (lấy gợi ý trong words.py để mô tả).
Khi bỏ phiếu, bot nghi ngờ người có câu mô tả KHÔNG khớp với từ của mình (và người im lặng); bot vừa/khó còn
hơi “theo số đông”. Gián điệp bị loại đoán từ của dân bằng cách so các câu mô tả đã nghe với kho từ.
"""
import asyncio
import logging
import random
import re
import unicodedata

from core.game_base import GameError

log = logging.getLogger("gamehub.giandiep.bots")

LEVELS = {"easy": {"logic": 0.25, "crowd": 0.0, "guess": 0.3}, "normal": {"logic": 0.5, "crowd": 0.3, "guess": 0.45},
          "hard": {"logic": 0.8, "crowd": 0.5, "guess": 0.65}}
TALK = ["Nghi {n} quá 🤔", "{n} mô tả lạ lạ", "Mình thấy {n} đáng ngờ", "Tin mình đi 😇", "Không phải mình đâu nha 😅"]


def toks(s):
    d = unicodedata.normalize("NFD", str(s or "").lower())
    d = "".join(c for c in d if unicodedata.category(c) != "Mn").replace("đ", "d")
    return {t for t in re.findall(r"\w+", d) if len(t) > 1}


_BANK = None


def bank_tokens():
    """Mọi chữ xuất hiện trong kho từ & gợi ý — câu mô tả không chứa chữ nào trong đây thì bot “không hiểu”."""
    global _BANK
    if _BANK is None:
        from .words import PAIRS
        _BANK = set()
        for pair in PAIRS:
            for w, hints in pair:
                _BANK |= toks(w) | toks(" ".join(hints))
    return _BANK


class GianDiepBotMixin:
    supports_bots = True

    def _bots_reset(self):
        self._bot_pending = {}

    def _bot_jobs(self, pid):
        if self.phase != "play" or pid not in self.alive:
            if self.phase == "play" and self.stage == "guess" and self.guess and self.guess["pid"] == pid:
                return {"guess": (self._seq, "guess")}
            return {}
        if self.stage == "describe" and self.speaker == pid:
            return {"say": (self._seq, "say")}
        if self.stage == "vote" and pid not in self.votes:
            return {"vote": (self.round_no, "vote")}
        return {}

    def on_state_broadcast(self):
        if getattr(self, "_disposed", False):
            return
        for p in list(self.room.players.values()):
            if not p.is_bot:
                continue
            for kind, key in self._bot_jobs(p.id).items():
                if self._bot_pending.get((p.id, kind)) == key:
                    continue
                self._bot_pending[(p.id, kind)] = key
                delay = {"say": random.uniform(2.5, 5.5), "vote": random.uniform(3, min(14, self.config["vote_time"] - 3)),
                         "guess": random.uniform(4, 9)}[kind]
                asyncio.ensure_future(self._bot_run(p.id, kind, key, delay))

    async def _bot_run(self, pid, kind, key, delay):
        await asyncio.sleep(delay)
        async with self.room.lock:
            if getattr(self, "_disposed", False) or pid not in self.room.players:
                return
            if self._bot_jobs(pid).get(kind) != key:
                return
            try:
                if kind == "say":
                    self._act_say(pid, {"text": self._bot_clue(pid)})
                elif kind == "vote":
                    target = self._bot_target(pid)
                    if target:
                        self._act_vote(pid, {"target": target})
                        if random.random() < 0.18:
                            self._post_chat("all", random.choice(TALK).format(n=self._name(target)), pid)
                else:
                    from .words import PAIRS
                    # Gián điệp bị loại đoán từ của dân: so các câu mô tả của người khác với kho từ (trừ từ của mình).
                    sure = random.random() < LEVELS[self.config["bot_level"]]["guess"]
                    own = self.word.get(pid)
                    w = self._bot_best_word(exclude=pid, skip=own)[0] if sure else random.choice([x for x in random.choice(PAIRS) if x[0] != own])[0]
                    self._act_guess(pid, {"text": w})
            except GameError:
                pass
            except Exception:
                log.exception("Lỗi AI bot Gián Điệp")
            await self.room.broadcast_state()

    # ------------------------------------------------------------------ suy luận
    def _all_clues(self, exclude=None):
        return [c for p, cs in self.clues.items() if p != exclude for c in cs if c]

    def _bot_best_word(self, exclude=None, skip=None):
        """(từ, gợi ý) trong kho khớp nhất với các câu mô tả đã nghe (bỏ qua từ `skip`)."""
        from .words import PAIRS
        heard = set()
        for c in self._all_clues(exclude):
            heard |= toks(c)
        best, best_s = None, -1
        for pair in PAIRS:
            for w, hints in pair:
                if w == skip:
                    continue
                s = len(heard & (toks(" ".join(hints)) | toks(w))) + random.random() * 0.5
                if s > best_s:
                    best, best_s = (w, hints), s
        return best

    def _my_word(self, pid):
        from .words import PAIRS
        w = self.word.get(pid)
        if w is None:
            return self._bot_best_word(exclude=pid)
        for pair in PAIRS:
            for word, hints in pair:
                if word == w:
                    return word, hints
        return w, []

    def _suspect_self(self, pid):
        """Bot nghe thấy phần lớn mô tả không khớp từ của mình → đoán mình là gián điệp."""
        if self.word.get(pid) is None:
            return True
        word, hints = self._my_word(pid)
        mine = toks(" ".join(hints)) | toks(word)
        heard = [c for c in self._all_clues(exclude=pid) if toks(c) & bank_tokens()]   # chỉ tính câu bot hiểu được
        if len(heard) < 2:
            return False
        match = sum(1 for c in heard if toks(c) & mine)
        return match / len(heard) < 0.34

    def _bot_clue(self, pid):
        from .words import GENERIC
        word, hints = self._my_word(pid)
        if self.word.get(pid) is not None and self._suspect_self(pid) and random.random() < LEVELS[self.config["bot_level"]]["logic"]:
            # Có vẻ mình lạc loài → mô tả theo hướng số đông để trà trộn.
            guess = self._bot_best_word(exclude=pid)
            if guess and guess[0] != word:
                word, hints = guess
        if self.round_no == 1 and random.random() < 0.65:
            # Vòng đầu nói chung chung: ưu tiên gợi ý cũng đúng với từ “anh em” trong cặp.
            vague = self._vague_hints(word, hints)
            if vague:
                hints = vague
        said = {" ".join(sorted(toks(c))) for c in self._all_clues()}
        own = self.word.get(pid)
        from .game import norm
        hints = [h for h in hints if not own or f" {norm(own)} " not in f" {norm(h)} "]   # không tự nói lộ từ khoá
        fresh = [h for h in hints if " ".join(sorted(toks(h))) not in said]
        if self.word.get(pid) is None and random.random() < 0.35:
            return random.choice(GENERIC)
        return random.choice(fresh or hints or GENERIC)

    def _vague_hints(self, word, hints):
        from .words import PAIRS
        for pair in PAIRS:
            names = [w for w, _ in pair]
            if word in names:
                other = pair[1] if pair[0][0] == word else pair[0]
                pool = toks(" ".join(other[1])) | toks(other[0])
                return [h for h in hints if toks(h) & pool]
        return []

    def _bot_target(self, pid):
        lv = LEVELS[self.config["bot_level"]]
        others = [p for p in self.alive if p != pid]
        if not others:
            return None
        if random.random() > lv["logic"]:
            return random.choice(others)
        crowd = {}
        for t in self.votes.values():
            crowd[t] = crowd.get(t, 0) + 1
        if self.word.get(pid) is not None and self._suspect_self(pid):
            # Nghi mình là gián điệp: hùa theo số đông để không bị chú ý.
            if crowd:
                return max(others, key=lambda q: (crowd.get(q, 0), random.random()))
            return random.choice(others)
        word, hints = self._my_word(pid)
        mine = toks(" ".join(hints)) | toks(word)
        crowd = {}
        for t in self.votes.values():
            crowd[t] = crowd.get(t, 0) + 1
        best, best_s = None, None
        for q in others:
            s = random.random() * 2.0
            for c in self.clues.get(q, []):
                if not c:
                    s += 1.2
                elif toks(c) & mine:
                    s -= 0.6
                elif toks(c) & bank_tokens():
                    s += 0.25   # câu bot hiểu được nhưng không khớp từ của mình → hơi đáng ngờ
            s += crowd.get(q, 0) * lv["crowd"]
            if best_s is None or s > best_s:
                best, best_s = q, s
        return best

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
