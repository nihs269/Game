"""Hiểu Ý Nhau — đố nhau xem hiểu bạn bè tới đâu.

Mỗi vòng là một trong hai kiểu:
  🤝 pair   — Tâm Đầu Ý Hợp: 2 người cùng trả lời một câu về chính mình ("Màu yêu thích của bạn?"),
              giống nhau thì cả hai được điểm; những người còn lại đoán trước xem hai người GIỐNG hay KHÁC.
  🎯 single — Hiểu Bạn Đến Đâu: 1 người bí mật trả lời về mình, cả phòng đoán ("Món ăn Khoa thích nhất?").
              Câu gõ tự do thì chính người đó chấm ai đoán đúng (máy chấm sẵn các câu khớp).

Các bước của một vòng: intro → answer → judge (chỉ khi câu gõ tự do cần người chấm / xác nhận) → reveal.
Câu trả lời giữ ở máy chủ, chỉ lộ ra ở bước judge / reveal.
"""
import asyncio
import difflib
import logging
import random
import re
import time
import unicodedata

from core.game_base import BaseGame, GameError
from .bots import HieuYBotMixin
from .questions import PAIR, SINGLE

log = logging.getLogger("gamehub.hieuy")

COLORS = ["#ff6b6b", "#4d8df7", "#3cc47c", "#ffc23c", "#b07cff", "#ff8fc7", "#2fd0d0", "#ff9f43", "#9be15d", "#e0e0e0", "#f78fb3", "#7bed9f"]
ROUNDS = (6, 10, 15, 20)
MODES = ("mix", "pair", "single")
INTRO_TIME = 3.0
ANSWER_TIME = {"options": 25, "text": 45}
JUDGE_TIME = 30
REVEAL_TIME = 8.0
PTS_GUESS = 100        # đoán đúng về một người
PTS_KNOWN = 50         # người được hỏi: +50 cho mỗi người đoán đúng mình
PTS_MATCH = 150        # hai người trả lời giống nhau
PTS_PREDICT = 50       # đoán đúng hai người giống / khác
MAX_TEXT = 60


def norm(s):
    s = str(s or "").lower().replace("đ", "d")
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "", s)


def same(a, b):
    """Hai câu trả lời gõ tay có coi là giống nhau không (bỏ dấu, hoa thường, khoảng trắng; gần đúng cũng được)."""
    x, y = norm(a), norm(b)
    if not x or not y:
        return False
    if x == y:
        return True
    if min(len(x), len(y)) >= 3 and (x in y or y in x):
        return True
    return difflib.SequenceMatcher(None, x, y).ratio() >= 0.8


class HieuYGame(HieuYBotMixin, BaseGame):
    id = "hieuy"
    name = "Hiểu Ý Nhau"
    icon = "💞"
    description = "Bạn hiểu bạn bè tới đâu? Đoán món khoái khẩu, màu yêu thích của nhau… và tìm ra cặp tâm đầu ý hợp nhất nhóm!"
    min_players = 2
    max_players = 12
    guide = [
        ("🎯 Mục tiêu", "Đoán đúng về bạn bè và “hiểu ý” nhau để ghi điểm. Hết các vòng, **tổng điểm cao nhất** thắng — kèm bảng **ai hiểu ai nhất**."),
        ("🤝 Tâm Đầu Ý Hợp (câu hỏi chung cho 2 người)", [
            "Game chọn **2 người** cùng trả lời một câu về chính mình, VD *“Màu yêu thích của bạn?”*.",
            "Trả lời **giống nhau** → cả hai **+150**. Gõ tay mà gần giống (VD “xanh” và “xanh dương”) thì hai người có thể cùng bấm **Tính là giống**.",
            "Những người còn lại đoán trước: hai người này **giống** hay **khác**? Đoán đúng **+50**.",
        ]),
        ("🎯 Hiểu Bạn Đến Đâu (câu hỏi về 1 người)", [
            "1 người bí mật trả lời thật lòng về mình, VD *“Món ăn bạn thích nhất?”*.",
            "Cả phòng đoán *“Món ăn mà Khoa thích nhất là gì?”*. Đoán đúng **+100**, người được hỏi **+50** cho mỗi người đoán đúng mình.",
            "Câu gõ tự do thì **chính người đó chấm** ai đoán đúng (máy đã đánh dấu sẵn các câu khớp, có thể sửa).",
        ]),
        ("⚙️ Tuỳ chọn (chủ phòng)", "Số vòng, kiểu câu hỏi (trộn / chỉ cặp đôi / chỉ một người). Thêm bot nếu thiếu người — nhưng chơi với bạn thân mới vui nhất!"),
    ]

    def __init__(self, room):
        super().__init__(room)
        self.config = {"rounds": 10, "mode": "mix"}
        self.chat = []
        self.log = []
        self.events = []
        self._msg_id = 0
        self._seq = 0
        self._token = 0
        self.deadline = None
        self.phase_total = None
        self.wins = {}
        self.game_no = 0
        self._used = set()
        self._reset_game()
        self.phase = "lobby"

    def _reset_game(self):
        self._token += 1
        self.deadline = self.phase_total = None
        self.order = []
        self.names = {}
        self.colors = {}
        self.score = {}
        self.stage = None          # intro · answer · judge · reveal
        self.round_no = 0
        self.total_rounds = 0
        self.rnd = None
        self.hot = {}              # số lần mỗi người được hỏi / được chọn vào cặp
        self.pair_count = {}
        self.know = {}             # (người đoán, người được hỏi) → số lần đoán đúng
        self.tries = {}
        self.matches = {}          # (a, b) → số lần hai người trả lời giống nhau
        self.types = []
        self.asked = set()         # câu đã hỏi trong ván (tránh cùng câu ra ở cả hai kiểu)
        self.winner = None
        self.ranking = []
        self._bots_reset()

    # ------------------------------------------------------------------ tiện ích
    def _name(self, pid):
        p = self.room.players.get(pid)
        return p.name if p else self.names.get(pid, "?")

    def _connected(self, pid):
        p = self.room.players.get(pid)
        return bool(p and p.connected)

    def _add_log(self, text, kind="info"):
        self.log.append({"t": time.time(), "text": text, "kind": kind})
        if len(self.log) > 200:
            self.log = self.log[-200:]

    def _event(self, kind, pid=None, **extra):
        self._seq += 1
        self.events.append({"seq": self._seq, "type": kind, "pid": pid, **extra})
        if len(self.events) > 30:
            self.events = self.events[-30:]

    def _post_chat(self, channel, text, pid=None):
        self._msg_id += 1
        self.chat.append({"id": self._msg_id, "t": time.time(), "channel": channel, "text": text,
                          "pid": pid, "name": self._name(pid) if pid else None})
        if len(self.chat) > 300:
            self.chat = self.chat[-300:]

    def _require_host(self, pid):
        if pid != self.room.host_id:
            raise GameError("Chỉ chủ phòng mới làm được việc này.")

    # ------------------------------------------------------------------ hẹn giờ
    def _set_timer(self, seconds, fn):
        self._token += 1
        token = self._token
        self.phase_total = seconds
        self.deadline = time.time() + seconds
        asyncio.ensure_future(self._timer_loop(token, fn))

    async def _timer_loop(self, token, fn):
        while token == self._token:
            remaining = self.deadline - time.time()
            if remaining <= 0:
                break
            await asyncio.sleep(min(remaining, 0.5))
        async with self.room.lock:
            if token != self._token:
                return
            self.deadline = self.phase_total = None
            try:
                fn()
            except GameError:
                pass
            except Exception:
                log.exception("Lỗi hẹn giờ Hiểu Ý Nhau")
            await self.room.broadcast_state()

    def _stop_timer(self):
        self._token += 1
        self.deadline = self.phase_total = None

    def dispose(self):
        self._token += 1
        self._disposed = True

    # ------------------------------------------------------------------ core hooks
    def can_remove(self, pid):
        return self.phase != "play" or pid not in self.order

    def can_rename(self):
        return self.phase != "play"

    def status(self):
        if self.phase == "lobby":
            return {"label": "Đang chờ", "joinable": True}
        if self.phase == "end":
            return {"label": "Nghỉ giữa ván", "joinable": True}
        return {"label": f"Vòng {self.round_no}/{self.total_rounds}", "joinable": False}

    async def on_player_join(self, player):
        self._post_chat("system", f"👋 {player.name} đã vào phòng.")

    async def on_player_removed(self, player):
        self.names[player.id] = player.name
        self._post_chat("system", f"🚪 {player.name} đã rời phòng.")

    async def on_action(self, player, action, data):
        handler = getattr(self, "_act_" + action, None) if action.isidentifier() else None
        if handler is None:
            raise GameError("Hành động không hợp lệ.")
        handler(player.id, data)

    # ------------------------------------------------------------------ phòng chờ
    def _act_config(self, pid, data):
        self._require_host(pid)
        if self.phase == "play":
            raise GameError("Không thể đổi luật khi đang chơi.")
        if "rounds" in data:
            try:
                v = int(data["rounds"])
            except (TypeError, ValueError):
                v = None
            if v in ROUNDS:
                self.config["rounds"] = v
        if data.get("mode") in MODES:
            self.config["mode"] = data["mode"]

    def _start_error(self):
        if len(self.room.players) < self.min_players:
            return f"Cần ít nhất {self.min_players} người chơi (thêm bạn bè hoặc bot)."
        return None

    def _act_start(self, pid, data):
        self._require_host(pid)
        if self.phase == "play":
            raise GameError("Ván đang diễn ra.")
        err = self._start_error()
        if err:
            raise GameError(err)
        self._reset_game()
        self.game_no += 1
        self.phase = "play"
        self.order = self.participants()
        self.total_rounds = self.config["rounds"]
        for i, p in enumerate(self.order):
            self.names[p] = self._name(p)
            self.colors[p] = COLORS[i % len(COLORS)]
            self.score[p] = 0
            self.hot[p] = 0
            self.wins.setdefault(p, 0)
        self._post_chat("system", f"💞 Ván {self.game_no} bắt đầu — {self.total_rounds} vòng. Xem ai hiểu ai nhất nào!")
        self._add_log(f"💞 Ván {self.game_no} bắt đầu — {self.total_rounds} vòng.", "start")
        self._next_round()

    def _act_next_round(self, pid, data):
        self._act_start(pid, data)

    def _act_lobby(self, pid, data):
        self._require_host(pid)
        if self.phase != "end":
            raise GameError("Không thể làm việc này lúc này.")
        self._reset_game()
        self.phase = "lobby"
        self.wins = {}
        self.game_no = 0
        self._post_chat("system", "🔁 Quay lại phòng chờ.")

    def _act_stop(self, pid, data):
        self._require_host(pid)
        if self.phase != "play":
            raise GameError("Ván chưa bắt đầu.")
        self._finish()

    # ------------------------------------------------------------------ chọn câu hỏi
    def _pick_type(self, players):
        mode = self.config["mode"]
        if mode != "mix":
            return mode
        last = self.types[-2:]
        if len(last) == 2 and last[0] == last[1]:
            return "single" if last[0] == "pair" else "pair"
        return random.choice(["pair", "single"])

    def _pick_question(self, kind):
        pool = PAIR if kind == "pair" else SINGLE
        text = lambda q: norm(q.get("q") or q.get("you"))   # noqa: E731
        fresh = [i for i in range(len(pool)) if (kind, i) not in self._used and text(pool[i]) not in self.asked]
        if not fresh:
            fresh = [i for i in range(len(pool)) if (kind, i) not in self._used]
        if not fresh:
            self._used = {u for u in self._used if u[0] != kind}
            fresh = list(range(len(pool)))
        i = random.choice(fresh)
        self._used.add((kind, i))
        self.asked.add(text(pool[i]))
        return pool[i]

    def _least(self, cands, key):
        best = min(key(c) for c in cands)
        return random.choice([c for c in cands if key(c) == best])

    def _next_round(self):
        if self.round_no >= self.total_rounds:
            self._finish()
            return
        players = [p for p in self.order if self._connected(p)] or list(self.order)
        if len(players) < 2:
            self._finish()
            return
        kind = self._pick_type(players)
        q = self._pick_question(kind)
        if kind == "pair":
            pairs = [(a, b) for i, a in enumerate(players) for b in players[i + 1:]]
            who = list(self._least(pairs, lambda ab: (self.pair_count.get(frozenset(ab), 0), self.hot[ab[0]] + self.hot[ab[1]])))
            random.shuffle(who)
            self.pair_count[frozenset(who)] = self.pair_count.get(frozenset(who), 0) + 1
        else:
            who = [self._least(players, lambda p: self.hot[p])]
        for p in who:
            self.hot[p] += 1
        options = list(q.get("options") or [])
        option_ids = None
        if q.get("players"):
            option_ids = [p for p in self.order if not (q.get("exclude_self") and p == who[0])]
            options = [self.names[p] for p in option_ids]
        self.types.append(kind)
        self.round_no += 1
        self.rnd = {
            "type": kind, "who": who,
            "you": q["q"] if kind == "pair" else q["you"],
            "about": None if kind == "pair" else q["about"],
            "options": options or None, "optionIds": option_ids, "samples": q.get("samples", []),
            "answers": {}, "guesses": {}, "marks": {}, "agree": set(), "nope": set(),
            "matched": None, "points": {},
        }
        self.stage = "intro"
        self._event("intro", None, round=self.round_no, qtype=kind)
        self._set_timer(INTRO_TIME, self._begin_answer)

    def _begin_answer(self):
        self.stage = "answer"
        self._set_timer(ANSWER_TIME["options" if self.rnd["options"] else "text"], self._end_answer)

    # ------------------------------------------------------------------ trả lời
    def _clean_value(self, value):
        r = self.rnd
        if r["options"]:
            try:
                v = int(value)
            except (TypeError, ValueError):
                raise GameError("Lựa chọn không hợp lệ.")
            if not 0 <= v < len(r["options"]):
                raise GameError("Lựa chọn không hợp lệ.")
            return v
        text = " ".join(str(value or "").split())[:MAX_TEXT]
        if not norm(text):
            raise GameError("Hãy nhập câu trả lời.")
        return text

    def _check_round(self, pid, data):
        if self.phase != "play" or self.stage != "answer" or pid not in self.order:
            raise GameError("Chưa thể trả lời lúc này.")
        if data.get("round") != self.round_no:
            raise GameError("Vòng này đã qua.")

    def _act_answer(self, pid, data):
        self._check_round(pid, data)
        r = self.rnd
        value = self._clean_value(data.get("value"))
        if pid in r["who"]:
            r["answers"][pid] = value
        elif r["type"] == "single":
            r["guesses"][pid] = value
        else:
            raise GameError("Vòng này bạn đoán hai người giống hay khác nhé.")
        self._event("answered", pid)
        self._maybe_end_answer()

    def _act_predict(self, pid, data):
        self._check_round(pid, data)
        r = self.rnd
        if r["type"] != "pair" or pid in r["who"]:
            raise GameError("Không thể làm việc này lúc này.")
        r["guesses"][pid] = bool(data.get("same"))
        self._event("answered", pid)
        self._maybe_end_answer()

    def _waiting_for(self):
        r = self.rnd
        out = []
        for p in self.order:
            if not self._connected(p):
                continue
            if p in r["who"]:
                if p not in r["answers"]:
                    out.append(p)
            elif p not in r["guesses"]:
                out.append(p)
        return out

    def _maybe_end_answer(self):
        if not self._waiting_for():
            self._stop_timer()
            self._end_answer()

    def _end_answer(self):
        if self.stage != "answer":
            return
        r = self.rnd
        text = not r["options"]
        if r["type"] == "single":
            subj = r["who"][0]
            ans = r["answers"].get(subj)
            if ans is None:
                self._post_chat("system", f"⏱️ {self._name(subj)} chưa kịp trả lời — vòng này bỏ qua.")
                self._reveal()
                return
            for g, v in r["guesses"].items():
                r["marks"][g] = same(v, ans) if text else v == ans
            if text and r["guesses"]:
                self.stage = "judge"
                self._event("judge", subj)
                self._set_timer(JUDGE_TIME, self._reveal)
                return
        else:
            a, b = r["who"]
            va, vb = r["answers"].get(a), r["answers"].get(b)
            if va is None or vb is None:
                r["matched"] = False
            else:
                r["matched"] = same(va, vb) if text else va == vb
                if text and not r["matched"]:
                    self.stage = "judge"
                    self._event("judge", None)
                    self._set_timer(JUDGE_TIME * 0.6, self._reveal)
                    return
        self._reveal()

    # ------------------------------------------------------------------ chấm điểm
    def _act_mark(self, pid, data):
        r = self.rnd
        if self.phase != "play" or self.stage != "judge" or r["type"] != "single" or pid != r["who"][0]:
            raise GameError("Chỉ người được hỏi mới chấm được.")
        g = str(data.get("pid", ""))
        if g not in r["guesses"]:
            raise GameError("Không có câu đoán này.")
        r["marks"][g] = bool(data.get("ok"))

    def _act_judge_done(self, pid, data):
        r = self.rnd
        if self.phase != "play" or self.stage != "judge" or r["type"] != "single" or pid != r["who"][0]:
            raise GameError("Chỉ người được hỏi mới chấm được.")
        self._stop_timer()
        self._reveal()

    def _act_agree(self, pid, data):
        r = self.rnd
        if self.phase != "play" or self.stage != "judge" or r["type"] != "pair" or pid not in r["who"]:
            raise GameError("Không thể làm việc này lúc này.")
        if data.get("on", True):
            r["agree"].add(pid)
            r["nope"].discard(pid)
        else:
            r["agree"].discard(pid)
            if data.get("final"):
                r["nope"].add(pid)
        if r["agree"] >= set(r["who"]):
            r["matched"] = True
            self._stop_timer()
            self._reveal()
        elif all(p in r["agree"] or p in r["nope"] for p in r["who"]):
            self._stop_timer()   # cả hai đã quyết, ít nhất một người bảo khác
            self._reveal()

    def _reveal(self):
        if self.stage not in ("answer", "judge"):
            return
        r = self.rnd
        pts = r["points"]
        self.stage = "reveal"
        if r["type"] == "single":
            subj = r["who"][0]
            if subj in r["answers"]:
                right = [g for g, ok in r["marks"].items() if ok]
                for g in r["guesses"]:
                    key = (g, subj)
                    self.tries[key] = self.tries.get(key, 0) + 1
                for g in right:
                    pts[g] = pts.get(g, 0) + PTS_GUESS
                    self.know[(g, subj)] = self.know.get((g, subj), 0) + 1
                if right:
                    pts[subj] = pts.get(subj, 0) + PTS_KNOWN * len(right)
                n = len(r["guesses"])
                self._add_log(f"🎯 Vòng {self.round_no}: {len(right)}/{n} người đoán đúng về {self._name(subj)}.", "round")
        else:
            a, b = r["who"]
            if r["matched"]:
                pts[a] = pts.get(a, 0) + PTS_MATCH
                pts[b] = pts.get(b, 0) + PTS_MATCH
                key = tuple(sorted((a, b)))
                self.matches[key] = self.matches.get(key, 0) + 1
            for g, v in r["guesses"].items():
                if v == bool(r["matched"]):
                    pts[g] = pts.get(g, 0) + PTS_PREDICT
            self._add_log(f"🤝 Vòng {self.round_no}: {self._name(a)} & {self._name(b)} "
                          f"{'tâm đầu ý hợp!' if r['matched'] else 'mỗi người một ý.'}", "round")
        for p, v in pts.items():
            if p in self.score:
                self.score[p] += v
        self._event("reveal", None, round=self.round_no, matched=r["matched"])
        self._set_timer(REVEAL_TIME, self._next_round)

    def _best_pairs(self):
        """Bảng “ai hiểu ai nhất” và “cặp tâm đầu ý hợp”."""
        know = sorted(([g, s, c, self.tries.get((g, s), c)] for (g, s), c in self.know.items()),
                      key=lambda x: (-x[2], x[3]))[:5]
        match = sorted(([a, b, c] for (a, b), c in self.matches.items()), key=lambda x: -x[2])[:5]
        return {"know": know, "match": match}

    def _finish(self):
        self._stop_timer()
        self.phase = "end"
        self.stage = None
        self.ranking = sorted(self.order, key=lambda p: -self.score[p])
        self.winner = self.ranking[0] if self.ranking else None
        if self.winner:
            self.wins[self.winner] = self.wins.get(self.winner, 0) + 1
            text = f"🏆 {self._name(self.winner)} thắng ván {self.game_no} với {self.score[self.winner]} điểm!"
            self._add_log(text, "end")
            self._post_chat("system", text)
            self._event("win", self.winner)

    # ------------------------------------------------------------------ chat
    def _act_chat(self, pid, data):
        text = " ".join(str(data.get("text", "")).split())[:300]
        if text:
            self._post_chat("all", text, pid)

    # ------------------------------------------------------------------ trạng thái
    def _round_view(self, pid):
        r = self.rnd
        if not r or self.phase != "play":
            return None
        name = self._name(r["who"][0])
        open_ = self.stage in ("judge", "reveal")
        v = {
            "n": self.round_no, "total": self.total_rounds, "type": r["type"], "who": r["who"],
            "you": r["you"], "about": r["about"].replace("{name}", name) if r["about"] else None,
            "options": r["options"], "optionIds": r["optionIds"],
            "answered": list(r["answers"]) + list(r["guesses"]),
            "mine": r["answers"].get(pid, r["guesses"].get(pid)),
        }
        if open_:
            v["answers"] = r["answers"]
            v["guesses"] = r["guesses"]
            v["marks"] = r["marks"]
            v["agree"] = sorted(r["agree"])
            v["matched"] = r["matched"]
        if self.stage == "reveal":
            v["points"] = r["points"]
        return v

    def view(self, pid):
        playing = self.phase in ("play", "end")
        order = list(self.order) if playing else []
        order += [p for p in self.room.players if p not in order]
        players = []
        for p_id in order:
            p = self.room.players.get(p_id)
            players.append({
                "id": p_id,
                "name": p.name if p else self.names.get(p_id, "?"),
                "bot": bool(p and p.is_bot),
                "connected": bool(p and p.connected),
                "look": p.look if p else None,
                "host": p_id == self.room.host_id,
                "playing": p_id in self.order,
                "color": self.colors.get(p_id),
                "score": self.score.get(p_id, 0),
                "wins": self.wins.get(p_id, 0),
            })
        return {
            "phase": self.phase,
            "stage": self.stage,
            "gameNo": self.game_no,
            "me": {"id": pid, "host": pid == self.room.host_id, "playing": pid in self.order},
            "players": players,
            "round": self._round_view(pid),
            "best": self._best_pairs() if self.phase == "end" else None,
            "winner": self.winner,
            "ranking": self.ranking,
            "deadline": self.deadline,
            "total": self.phase_total,
            "now": time.time(),
            "events": self.events[-15:],
            "config": self.config,
            "choices": {"rounds": ROUNDS, "mode": MODES},
            "minPlayers": self.min_players,
            "maxPlayers": self.max_players,
            "startError": self._start_error() if self.phase != "play" else None,
            "chat": self.chat[-150:],
            "log": self.log[-100:],
        }
