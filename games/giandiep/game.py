"""Gián Điệp (kiểu “Ai là kẻ lạc loài” / Undercover) — mỗi người nhận một từ khoá; tất cả cùng một từ, riêng
MỘT gián điệp nhận một từ gần giống (VD: cà phê ↔ trà sữa). Không ai biết mình thuộc phe nào.

Mỗi vòng:
  1. Mô tả — lần lượt từng người nói một câu ngắn về từ của mình (không được nói thẳng từ khoá).
  2. Bỏ phiếu — mọi người (vẫn trò chuyện được) chọn một người để loại; nhiều phiếu nhất bị loại và lộ vai.
     Hoà phiếu thì không ai bị loại.
Gián điệp bị loại → được đoán từ của dân: đúng thì gián điệp thắng, sai thì dân thắng.
Dân bị loại → chơi tiếp; còn lại 1 dân và gián điệp (1 – 1) thì gián điệp thắng.
"""
import asyncio
import logging
import random
import re
import time
import unicodedata

from core.game_base import BaseGame, GameError
from .bots import GianDiepBotMixin
from .words import PAIRS

log = logging.getLogger("gamehub.giandiep")

COLORS = ["#ff6b6b", "#4d8df7", "#3cc47c", "#ffc23c", "#b07cff", "#ff8fc7", "#2fd0d0", "#ff9f43", "#9be15d", "#e0e0e0"]
TURN_TIMES = (20, 30, 45, 60)
VOTE_TIMES = (30, 45, 60, 90)
RESULT_TIME = 6
GUESS_TIME = 25
ROLE_NAMES = {"civ": "Dân", "spy": "Gián điệp"}
POINTS = {"civ": 2, "spy": 5}


def norm(s):
    t = unicodedata.normalize("NFC", str(s or "")).lower()
    t = re.sub(r"[^\w\s]", " ", t)
    return " ".join(t.split())


def plain(s):
    d = unicodedata.normalize("NFD", norm(s))
    return "".join(c for c in d if unicodedata.category(c) != "Mn").replace("đ", "d")


class GianDiepGame(GianDiepBotMixin, BaseGame):
    id = "giandiep"
    name = "Gián Điệp"
    icon = "🕵️"
    description = "Ai cũng có từ khoá, riêng 1 gián điệp nhận từ hơi khác (cà phê ↔ trà sữa). Mô tả khéo, nghe kỹ, bỏ phiếu bắt gián điệp!"
    min_players = 3
    max_players = 10
    guide = [
        ("🎯 Mục tiêu", [
            "Mỗi người nhận một **từ khoá**. Tất cả cùng một từ, riêng **1 gián điệp** nhận một từ **gần giống** (VD: *cà phê* ↔ *trà sữa*).",
            "**Không ai biết mình là dân hay gián điệp** — kể cả gián điệp! Nghe người khác mô tả để tự đoán.",
        ]),
        ("🗣️ Mỗi vòng", [
            "**Mô tả**: lần lượt mỗi người nói **một câu ngắn** về từ của mình. Không được nói thẳng từ khoá.",
            "Mô tả đủ để đồng đội nhận ra mình, nhưng đừng lộ quá — gián điệp sẽ đoán ra từ của các bạn!",
            "**Bỏ phiếu**: vừa trò chuyện vừa chọn người đáng ngờ nhất. Nhiều phiếu nhất bị loại và **lộ vai**; hoà phiếu thì không ai bị loại.",
        ]),
        ("🏁 Thắng thua", [
            "Loại nhầm **dân** → chơi tiếp vòng sau.",
            "**Gián điệp bị loại** → được **đoán từ của dân**: đoán **đúng** thì gián điệp **thắng**, đoán **sai** thì dân thắng.",
            "Nếu chỉ còn **1 dân và gián điệp** (1 – 1) → **gián điệp thắng**.",
        ]),
        ("🏅 Điểm", "Dân thắng: +2 mỗi người · gián điệp thắng: +5. Cộng dồn qua các ván."),
        ("⚙️ Tuỳ chọn (chủ phòng)", "Thời gian mô tả và bỏ phiếu, độ khó bot. Nên chơi từ 4 người trở lên."),
    ]

    def __init__(self, room):
        super().__init__(room)
        self.config = {"turn_time": 30, "vote_time": 45, "bot_level": "normal"}
        self.chat = []
        self.log = []
        self.events = []
        self._msg_id = 0
        self._seq = 0
        self._token = 0
        self.deadline = None
        self.phase_total = None
        self.wins = {}
        self.points = {}
        self.game_no = 0
        self.used_pairs = set()
        self._reset_game()
        self.phase = "lobby"

    def _reset_game(self):
        self._token += 1
        self.deadline = self.phase_total = None
        self.order = []
        self.names = {}
        self.colors = {}
        self.role = {}
        self.word = {}
        self.words = None          # (từ phe thường, từ gián điệp)
        self.alive = []
        self.round_no = 0
        self.stage = None          # describe · vote · result · guess
        self.speakers = []         # thứ tự nói trong vòng
        self.speaker_i = 0
        self.clues = {}            # pid → [câu mô tả theo vòng]
        self.votes = {}
        self.history = []          # [{"round", "out", "role", "tally"}]
        self.last = None           # kết quả bỏ phiếu gần nhất
        self.guess = None
        self.winner_team = None
        self.win_reason = ""
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

    @property
    def speaker(self):
        if self.stage == "describe" and self.speaker_i < len(self.speakers):
            return self.speakers[self.speaker_i]
        return None

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
                log.exception("Lỗi hẹn giờ Gián Điệp")
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
        return {"label": "Đang truy tìm gián điệp", "joinable": False}

    async def on_player_join(self, player):
        self._post_chat("system", f"👋 {player.name} đã vào phòng.")

    async def on_player_removed(self, player):
        self.names[player.id] = player.name
        self._post_chat("system", f"🚪 {player.name} đã rời phòng.")

    async def on_player_disconnect(self, player):
        if self.phase == "play" and player.id == self.speaker:
            self._set_timer(6, lambda: self._say(player.id, None))

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
        for key, allowed in (("turn_time", TURN_TIMES), ("vote_time", VOTE_TIMES)):
            if key in data:
                try:
                    v = int(data[key])
                except (TypeError, ValueError):
                    continue
                if v in allowed:
                    self.config[key] = v
        if data.get("bot_level") in ("easy", "normal", "hard"):
            self.config["bot_level"] = data["bot_level"]

    def _start_error(self):
        n = len(self.room.players)
        if n < self.min_players:
            return f"Cần ít nhất {self.min_players} người chơi (nên từ 4 người)."
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
        random.shuffle(self.order)
        n = len(self.order)
        pool = [i for i in range(len(PAIRS)) if i not in self.used_pairs] or list(range(len(PAIRS)))
        k = random.choice(pool)
        self.used_pairs.add(k)
        a, b = PAIRS[k]
        if random.random() < 0.5:
            a, b = b, a
        self.words = (a, b)
        shuffled = self.order[:]
        random.shuffle(shuffled)
        for i, p in enumerate(shuffled):
            self.role[p] = "spy" if i == 0 else "civ"
            self.word[p] = b[0] if self.role[p] == "spy" else a[0]
        for i, p in enumerate(self.order):
            self.names[p] = self._name(p)
            self.colors[p] = COLORS[i % len(COLORS)]
            self.clues[p] = []
            self.wins.setdefault(p, 0)
            self.points.setdefault(p, 0)
        self.alive = list(self.order)
        self._post_chat("system", f"🕵️ Ván {self.game_no} bắt đầu — trong {n} người có 1 gián điệp. Xem từ khoá của bạn!")
        self._add_log(f"🕵️ Ván {self.game_no}: {n} người, 1 gián điệp.", "start")
        self._begin_round()

    def _act_next_round(self, pid, data):
        self._act_start(pid, data)

    def _act_lobby(self, pid, data):
        self._require_host(pid)
        if self.phase != "end":
            raise GameError("Không thể làm việc này lúc này.")
        self._reset_game()
        self.phase = "lobby"
        self.wins = {}
        self.points = {}
        self.game_no = 0
        self._post_chat("system", "🔁 Quay lại phòng chờ.")

    def _act_stop(self, pid, data):
        self._require_host(pid)
        if self.phase != "play":
            raise GameError("Ván chưa bắt đầu.")
        self._finish(None, "Chủ phòng kết thúc ván")

    # ------------------------------------------------------------------ vòng chơi
    def _begin_round(self):
        self.round_no += 1
        start = (self.round_no - 1) % len(self.alive)
        self.speakers = self.alive[start:] + self.alive[:start]
        self.speaker_i = 0
        self.stage = "describe"
        self.votes = {}
        self.last = None
        self._event("round", None, round=self.round_no)
        self._add_log(f"🗣️ Vòng {self.round_no}: lần lượt mô tả từ khoá.", "round")
        self._next_speaker(first=True)

    def _next_speaker(self, first=False):
        if not first:
            self.speaker_i += 1
        if self.speaker_i >= len(self.speakers):
            self._begin_vote()
            return
        pid = self.speakers[self.speaker_i]
        self._event("speak", pid)
        secs = self.config["turn_time"] if self._connected(pid) else 6
        self._set_timer(secs, lambda: self._say(pid, None))

    def _act_say(self, pid, data):
        if self.phase != "play" or pid != self.speaker:
            raise GameError("Chưa tới lượt bạn mô tả.")
        text = " ".join(str(data.get("text", "")).split())[:60]
        if not text:
            raise GameError("Hãy nhập một câu mô tả.")
        w = self.word.get(pid)
        if w and f" {norm(w)} " in f" {norm(text)} ":
            raise GameError("Không được nói thẳng từ khoá của bạn!")
        self._say(pid, text)

    def _say(self, pid, text):
        if self.stage != "describe" or pid != self.speaker:
            return
        self._stop_timer()
        while len(self.clues[pid]) < self.round_no - 1:
            self.clues[pid].append(None)
        self.clues[pid].append(text)
        self._event("said", pid, text=text)
        self._add_log(f"💬 {self._name(pid)}: {text if text else '(im lặng)'}", "clue")
        self._next_speaker()

    def _begin_vote(self):
        self.stage = "vote"
        self.votes = {}
        self._event("vote", None)
        self._set_timer(self.config["vote_time"], self._close_vote)

    def _act_vote(self, pid, data):
        if self.phase != "play" or self.stage != "vote" or pid not in self.alive:
            raise GameError("Chưa phải lúc bỏ phiếu.")
        target = str(data.get("target", ""))
        if target == "":
            self.votes.pop(pid, None)
            return
        if target not in self.alive or target == pid:
            raise GameError("Hãy chọn một người khác còn trong ván.")
        self.votes[pid] = target
        voters = [p for p in self.alive if self._connected(p)]
        if all(p in self.votes for p in voters):
            self._close_vote()

    def _close_vote(self):
        if self.stage != "vote":
            return
        self._stop_timer()
        tally = {}
        for t in self.votes.values():
            tally[t] = tally.get(t, 0) + 1
        top = max(tally.values()) if tally else 0
        leaders = [p for p, c in tally.items() if c == top]
        out = leaders[0] if len(leaders) == 1 else None
        rec = {"round": self.round_no, "out": out, "role": self.role[out] if out else None,
               "tally": tally, "votes": dict(self.votes)}
        self.history.append(rec)
        self.last = rec
        self.stage = "result"
        if out:
            self.alive.remove(out)
            role = self.role[out]
            self._event("out", out, role=role)
            self._add_log(f"🗳️ {self._name(out)} bị loại ({top} phiếu) — là {ROLE_NAMES[role]}!", "out")
            if role == "spy":
                self.stage = "guess"
                self.guess = {"pid": out, "text": None}
                self._set_timer(GUESS_TIME, lambda: self._spy_guess(out, None))
                return
        else:
            self._event("tie", None)
            self._add_log("🗳️ Hoà phiếu (hoặc không ai bỏ phiếu) — không ai bị loại.", "out")
        self._set_timer(RESULT_TIME, self._after_result)

    def _act_guess(self, pid, data):
        if self.phase != "play" or self.stage != "guess" or not self.guess or self.guess["pid"] != pid:
            raise GameError("Chưa phải lúc đoán từ.")
        self._spy_guess(pid, str(data.get("text", ""))[:40])

    def _spy_guess(self, pid, text):
        """Gián điệp bị loại đoán từ của dân: đúng → gián điệp thắng, sai (hoặc hết giờ) → dân thắng."""
        if self.stage != "guess":
            return
        self._stop_timer()
        self.guess["text"] = text
        ok = bool(text) and plain(text) == plain(self.words[0][0])
        self._event("guessed", pid, ok=ok, text=text)
        if ok:
            self._add_log(f"🎯 {self._name(pid)} đoán đúng từ của dân «{self.words[0][0]}»!", "out")
            self._finish("spy", f"Gián điệp {self._name(pid)} bị lộ nhưng đoán đúng từ của dân")
        else:
            self._add_log(f"❌ {self._name(pid)} đoán «{text or '…'}» — sai rồi.", "out")
            self._finish("civ", "Đã bắt được gián điệp" + (f" (đoán sai «{text}»)" if text else " (không đoán kịp)"))

    def _after_result(self):
        civ = [p for p in self.alive if self.role[p] == "civ"]
        if not any(self.role[p] == "spy" for p in self.alive):
            self._finish("civ", "Đã bắt được gián điệp")
        elif len(civ) <= 1:
            self._finish("spy", "Còn 1 – 1, gián điệp thắng")
        else:
            self._begin_round()

    def _finish(self, team, reason):
        self._stop_timer()
        self.phase = "end"
        self.stage = None
        self.winner_team = team
        self.win_reason = reason
        if team:
            for p in self.order:
                if self.role[p] == team:
                    self.points[p] = self.points.get(p, 0) + POINTS[team]
                    self.wins[p] = self.wins.get(p, 0) + 1
        label = {"civ": "🙂 Dân thắng", "spy": "🕵️ Gián điệp thắng", None: "🏁 Ván dừng"}[team]
        text = f"{label}! ({reason}) — từ của dân «{self.words[0][0]}», từ gián điệp «{self.words[1][0]}»."
        self._add_log(text, "end")
        self._post_chat("system", text)
        self._event("win", None, team=team)

    # ------------------------------------------------------------------ chat
    def _act_chat(self, pid, data):
        text = " ".join(str(data.get("text", "")).split())[:300]
        if text:
            self._post_chat("all", text, pid)

    # ------------------------------------------------------------------ trạng thái
    def view(self, pid):
        playing = self.phase in ("play", "end")
        order = list(self.order) if playing else []
        order += [p for p in self.room.players if p not in order]
        ended = self.phase == "end"
        players = []
        for p_id in order:
            p = self.room.players.get(p_id)
            in_game = p_id in self.order
            out_rec = next((h for h in self.history if h["out"] == p_id), None)
            players.append({
                "id": p_id,
                "name": p.name if p else self.names.get(p_id, "?"),
                "bot": bool(p and p.is_bot),
                "connected": bool(p and p.connected),
                "look": p.look if p else None,
                "host": p_id == self.room.host_id,
                "playing": in_game,
                "alive": p_id in self.alive,
                "color": self.colors.get(p_id),
                "clues": self.clues.get(p_id, []),
                # Vai chỉ lộ khi bị loại hoặc hết ván; từ khoá của người khác chỉ lộ khi hết ván.
                "role": self.role.get(p_id) if (ended or out_rec) else None,
                "word": self.word.get(p_id) if ended else None,
                "voted": p_id in self.votes if self.stage == "vote" else None,
                "wins": self.wins.get(p_id, 0),
                "points": self.points.get(p_id, 0),
            })
        me_in = pid in self.order
        last = None
        if self.last:
            last = {k: v for k, v in self.last.items()}
        return {
            "phase": self.phase,
            "stage": self.stage,
            "gameNo": self.game_no,
            "me": {"id": pid, "host": pid == self.room.host_id, "playing": me_in,
                   "word": self.word.get(pid) if me_in else None,
                   "vote": self.votes.get(pid) if self.stage == "vote" else None},
            "players": players,
            "round": self.round_no,
            "speaker": self.speaker,
            "speakers": self.speakers if self.stage == "describe" else [],
            "last": last,
            "guess": self.guess,
            "aliveCount": len(self.alive),
            "words": {"civ": self.words[0][0], "spy": self.words[1][0]} if ended and self.words else None,
            "winnerTeam": self.winner_team,
            "winReason": self.win_reason,
            "deadline": self.deadline,
            "total": self.phase_total,
            "now": time.time(),
            "events": self.events[-15:],
            "config": self.config,
            "choices": {"turn_time": TURN_TIMES, "vote_time": VOTE_TIMES},
            "pairCount": len(PAIRS),
            "minPlayers": self.min_players,
            "maxPlayers": self.max_players,
            "startError": self._start_error() if self.phase != "play" else None,
            "chat": self.chat[-150:],
            "log": self.log[-100:],
        }
