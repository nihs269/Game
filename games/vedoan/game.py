"""Vẽ Đoán — mỗi lượt một người vẽ, những người còn lại đoán từ qua ô đoán; đoán đúng càng sớm càng nhiều điểm.

Luật:
  • Người vẽ chọn 1 trong 3 từ (dễ / vừa / khó) rồi vẽ trong thời gian giới hạn. Không được viết chữ.
  • Người đoán gõ đáp án; đúng thì được điểm theo thời gian còn lại (+ thưởng cho người đoán đúng sớm nhất),
    người vẽ được điểm cho mỗi người đoán ra. Gõ gần đúng sẽ được nhắc riêng.
  • Hết nửa thời gian sẽ lộ dần vài chữ cái gợi ý. Mọi người đoán ra hết thì lượt kết thúc sớm.
  • Mỗi vòng ai cũng được vẽ một lần (bot chỉ đoán, không vẽ). Hết số vòng, nhiều điểm nhất thắng.

Nét vẽ được gửi riêng bằng tin nhắn nhẹ {"type": "draw", ...} (không gửi lại toàn bộ trạng thái mỗi nét):
on_action trả về False để máy chủ không phát lại trạng thái. Mỗi thao tác tăng `canvas_ver`; giao diện thấy
lệch phiên bản thì xin đồng bộ lại toàn bộ bức vẽ (action "sync").
"""
import asyncio
import logging
import random
import re
import time
import unicodedata

from core.game_base import BaseGame, GameError
from .bots import VeDoanBotMixin
from .words import TOPICS, WORDS

log = logging.getLogger("gamehub.vedoan")

COLORS = ["#ff6b6b", "#4d8df7", "#3cc47c", "#ffc23c", "#b07cff", "#ff8fc7", "#2fd0d0", "#ff9f43",
          "#9be15d", "#e0e0e0", "#f472b6", "#60a5fa"]
ROUNDS = (1, 2, 3)
DRAW_TIMES = (60, 80, 100, 120)
CHOOSE_TIME = 15
REVEAL_TIME = 6
W, H = 800, 600                   # kích thước khung vẽ chuẩn (mọi máy vẽ lại trên cùng toạ độ)
MAX_POINTS = 60000                # giới hạn tổng số toạ độ của một bức vẽ
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def norm(s):
    t = unicodedata.normalize("NFC", str(s or "")).lower()
    t = re.sub(r"[^\w\s]", " ", t)
    return " ".join(t.split())


def strip_accents(s):
    d = unicodedata.normalize("NFD", s)
    return unicodedata.normalize("NFC", "".join(c for c in d if unicodedata.category(c) != "Mn")).replace("đ", "d")


def close(a, b):
    """Khoảng cách sửa ≤ 1 (thêm / bớt / thay một chữ)."""
    if abs(len(a) - len(b)) > 1 or a == b:
        return False
    if len(a) > len(b):
        a, b = b, a
    i = j = diff = 0
    while i < len(a) and j < len(b):
        if a[i] != b[j]:
            diff += 1
            if diff > 1:
                return False
            if len(a) == len(b):
                i += 1
            j += 1
        else:
            i += 1
            j += 1
    return diff + (len(b) - j) <= 1


class VeDoanGame(VeDoanBotMixin, BaseGame):
    id = "vedoan"
    name = "Vẽ Đoán"
    icon = "🎨"
    description = "Một người vẽ, cả phòng đoán! Chọn từ, vẽ thật nhanh, đoán đúng càng sớm càng nhiều điểm."
    min_players = 2
    max_players = 12
    guide = [
        ("🎯 Mục tiêu", "Lần lượt từng người **vẽ**, những người còn lại **đoán** từ. Hết các vòng, ai **nhiều điểm nhất** thắng."),
        ("✏️ Khi bạn vẽ", [
            "Chọn **1 trong 3 từ** (dễ · vừa · khó — từ càng khó càng được nhiều điểm khi có người đoán ra).",
            "Vẽ bằng bút, tẩy, đổ màu; có **hoàn tác** và **xoá hết**. **Không được viết chữ** hay số!",
            "Mỗi người đoán ra, bạn được **+50**; cả phòng đoán ra hết được thưởng thêm.",
        ]),
        ("🔍 Khi bạn đoán", [
            "Gõ đáp án vào ô **Đoán** rồi Enter, đoán bao nhiêu lần cũng được.",
            "Gõ **không dấu** cũng được (con meo = con mèo). Gõ **gần đúng** thì được nhắc riêng.",
            "Đoán đúng càng sớm càng nhiều điểm; người đoán ra **đầu tiên** được thưởng thêm.",
            "Đoán ra rồi thì tin nhắn của bạn chỉ người vẽ và những người đã đoán ra thấy — đừng lộ đáp án nhé!",
        ]),
        ("💡 Gợi ý", "Ô đáp án hiện số chữ và chủ đề. Qua nửa thời gian sẽ **lộ dần vài chữ cái**."),
        ("⚙️ Tuỳ chọn (chủ phòng)", "Số vòng, thời gian vẽ, chủ đề từ, độ khó bot (bot chỉ đoán, không vẽ)."),
    ]

    def __init__(self, room):
        super().__init__(room)
        self.config = {"rounds": 2, "draw_time": 80, "topic": "all", "bot_level": "normal"}
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
        self.canvas_ver = 0
        self.ops = []
        self._reset_game()
        self.phase = "lobby"

    def _reset_game(self):
        self._token += 1
        self.deadline = self.phase_total = None
        self.order = []
        self.names = {}
        self.colors = {}
        self.score = {}
        self.drawers = []
        self.turn_no = 0           # số lượt đã bắt đầu
        self.turn_id = 0
        self.round_no = 0
        self.drawer = None
        self.stage = None          # choose · draw · reveal
        self.choices = []
        self.word = None           # (từ, chủ đề, độ khó)
        self.revealed = set()      # vị trí chữ cái đã lộ
        self.guessed = {}          # pid → điểm lượt này
        self.turn_pts = {}
        self.feed = []             # tin đoán: {"id","pid","text","kind","vis"}
        self.used_words = set()
        self.started_at = None
        self.winner = None
        self.ranking = []
        self._clear_canvas(relay=False)
        self._bots_reset()

    # ------------------------------------------------------------------ tiện ích
    def _name(self, pid):
        p = self.room.players.get(pid)
        return p.name if p else self.names.get(pid, "?")

    def _connected(self, pid):
        p = self.room.players.get(pid)
        return bool(p and p.connected)

    def _is_bot(self, pid):
        p = self.room.players.get(pid)
        return bool(p and p.is_bot)

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

    def _feed(self, pid, text, kind, vis="all"):
        self._msg_id += 1
        self.feed.append({"id": self._msg_id, "pid": pid, "text": text, "kind": kind, "vis": vis})
        if len(self.feed) > 120:
            self.feed = self.feed[-120:]

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
                log.exception("Lỗi hẹn giờ Vẽ Đoán")
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
        return {"label": "Đang vẽ đoán", "joinable": False}

    async def on_player_join(self, player):
        self._post_chat("system", f"👋 {player.name} đã vào phòng.")

    async def on_player_removed(self, player):
        self.names[player.id] = player.name
        self._post_chat("system", f"🚪 {player.name} đã rời phòng.")

    async def on_player_connect(self, player):
        await self.room.send(player, {"type": "draw", "op": "full", "ops": self.ops, "v": self.canvas_ver})

    async def on_player_disconnect(self, player):
        if self.phase == "play" and player.id == self.drawer and self.stage == "draw":
            self._feed(None, f"{player.name} mất kết nối — bỏ qua lượt vẽ.", "system")
            self._end_turn()

    async def on_action(self, player, action, data):
        handler = getattr(self, "_act_" + action, None) if action.isidentifier() else None
        if handler is None:
            raise GameError("Hành động không hợp lệ.")
        res = handler(player.id, data)
        if asyncio.iscoroutine(res):
            res = await res
        return res

    # ------------------------------------------------------------------ phòng chờ
    def _act_config(self, pid, data):
        self._require_host(pid)
        if self.phase == "play":
            raise GameError("Không thể đổi luật khi đang chơi.")
        for key, allowed in (("rounds", ROUNDS), ("draw_time", DRAW_TIMES)):
            if key in data:
                try:
                    v = int(data[key])
                except (TypeError, ValueError):
                    continue
                if v in allowed:
                    self.config[key] = v
        if data.get("topic") == "all" or data.get("topic") in TOPICS:
            self.config["topic"] = data["topic"]
        if data.get("bot_level") in ("easy", "normal", "hard"):
            self.config["bot_level"] = data["bot_level"]

    def _start_error(self):
        n = len(self.room.players)
        if n < self.min_players:
            return f"Cần ít nhất {self.min_players} người (có thể thêm bot để đoán)."
        if not any(not p.is_bot for p in self.room.players.values()):
            return "Cần ít nhất một người thật để vẽ."
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
        for i, p in enumerate(self.order):
            self.names[p] = self._name(p)
            self.colors[p] = COLORS[i % len(COLORS)]
            self.score[p] = 0
            self.wins.setdefault(p, 0)
        self.drawers = [p for p in self.order if not self._is_bot(p)]
        self._post_chat("system", f"🎨 Ván {self.game_no} bắt đầu — {self.config['rounds']} vòng!")
        self._add_log(f"🎨 Ván {self.game_no} bắt đầu.", "start")
        self._next_turn()

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

    # ------------------------------------------------------------------ bức vẽ
    async def _relay(self, msg, exclude=None):
        for p in list(self.room.players.values()):
            if p.id != exclude and p.connected and not p.is_bot:
                await self.room.send(p, msg)

    def _clear_canvas(self, relay=True):
        self.ops = []
        self.points = 0
        self.canvas_ver += 1
        if relay:
            asyncio.ensure_future(self._relay({"type": "draw", "op": "clear", "v": self.canvas_ver}))

    def _require_drawer(self, pid):
        if self.phase != "play" or self.stage != "draw" or pid != self.drawer:
            raise GameError("Bạn không phải người vẽ lúc này.")

    async def _act_draw(self, pid, data):
        self._require_drawer(pid)
        sid = str(data.get("id", ""))[:24]
        c = data.get("c") if HEX.match(str(data.get("c", ""))) else "#000000"
        try:
            w = max(1, min(80, int(data.get("w", 6))))
            raw = data.get("pts") or []
            pts = [int(v) for v in raw[:800]]
        except (TypeError, ValueError):
            return False
        if len(pts) % 2:
            pts = pts[:-1]
        pts = [max(0, min(W if i % 2 == 0 else H, v)) for i, v in enumerate(pts)]
        if self.points + len(pts) > MAX_POINTS or not sid:
            return False
        last = self.ops[-1] if self.ops else None
        if not last or last.get("k") != "s" or last["id"] != sid:
            last = {"k": "s", "id": sid, "c": c, "w": w, "pts": []}
            self.ops.append(last)
        last["pts"] += pts
        self.points += len(pts)
        self.canvas_ver += 1
        await self._relay({"type": "draw", "op": "seg", "id": sid, "c": c, "w": w, "pts": pts, "v": self.canvas_ver}, exclude=pid)
        return False

    async def _act_fill(self, pid, data):
        self._require_drawer(pid)
        try:
            x = max(0, min(W - 1, int(data.get("x"))))
            y = max(0, min(H - 1, int(data.get("y"))))
        except (TypeError, ValueError):
            return False
        c = data.get("c") if HEX.match(str(data.get("c", ""))) else "#000000"
        self.ops.append({"k": "f", "x": x, "y": y, "c": c})
        self.canvas_ver += 1
        await self._relay({"type": "draw", "op": "fill", "x": x, "y": y, "c": c, "v": self.canvas_ver}, exclude=pid)
        return False

    async def _act_undo(self, pid, data):
        self._require_drawer(pid)
        if self.ops:
            op = self.ops.pop()
            if op.get("k") == "s":
                self.points -= len(op["pts"])
        self.canvas_ver += 1
        await self._relay({"type": "draw", "op": "undo", "v": self.canvas_ver}, exclude=pid)
        return False

    async def _act_clear(self, pid, data):
        self._require_drawer(pid)
        self.ops = []
        self.points = 0
        self.canvas_ver += 1
        await self._relay({"type": "draw", "op": "clear", "v": self.canvas_ver}, exclude=pid)
        return False

    async def _act_sync(self, pid, data):
        p = self.room.players.get(pid)
        if p:
            await self.room.send(p, {"type": "draw", "op": "full", "ops": self.ops, "v": self.canvas_ver})
        return False

    # ------------------------------------------------------------------ lượt chơi
    def _pick_choices(self):
        pool = [w for w in WORDS if w[0] not in self.used_words and (self.config["topic"] == "all" or w[1] == self.config["topic"])]
        if len(pool) < 3:
            self.used_words.clear()
            pool = [w for w in WORDS if self.config["topic"] == "all" or w[1] == self.config["topic"]]
        out = []
        for lv in (1, 2, 3):
            lvl = [w for w in pool if w[2] == lv and w not in out]
            out.append(random.choice(lvl) if lvl else random.choice([w for w in pool if w not in out]))
        return out

    def _next_turn(self):
        drawers = [p for p in self.drawers if p in self.room.players]
        total = len(drawers) * self.config["rounds"]
        if not drawers or self.turn_no >= total:
            self._finish()
            return
        self.drawer = drawers[self.turn_no % len(drawers)]
        self.round_no = self.turn_no // len(drawers) + 1
        self.turn_no += 1
        self.turn_id += 1
        self.stage = "choose"
        self.choices = self._pick_choices()
        self.word = None
        self.revealed = set()
        self.guessed = {}
        self.turn_pts = {}
        self.feed = []
        self._clear_canvas()
        self._feed(None, f"✏️ {self._name(self.drawer)} đang chọn từ để vẽ…", "system")
        self._event("choose", self.drawer)
        self._set_timer(CHOOSE_TIME, lambda: self._choose(self.drawer, random.randrange(3)))

    def _act_choose(self, pid, data):
        if self.phase != "play" or self.stage != "choose" or pid != self.drawer:
            raise GameError("Chưa tới lượt bạn chọn từ.")
        try:
            i = int(data.get("i"))
        except (TypeError, ValueError):
            raise GameError("Lựa chọn không hợp lệ.")
        if not 0 <= i < len(self.choices):
            raise GameError("Lựa chọn không hợp lệ.")
        self._choose(pid, i)

    def _choose(self, pid, i):
        if self.stage != "choose":
            return
        self.word = self.choices[i]
        self.used_words.add(self.word[0])
        self.stage = "draw"
        self.started_at = time.time()
        self._feed(None, f"🎨 {self._name(pid)} bắt đầu vẽ!", "system")
        self._event("draw", pid)
        total = self.config["draw_time"]
        self._set_timer(total, self._end_turn)
        tid = self.turn_id
        for frac in (0.5, 0.75):
            asyncio.ensure_future(self._hint_later(tid, total * frac))

    async def _hint_later(self, tid, delay):
        await asyncio.sleep(delay)
        async with self.room.lock:
            if getattr(self, "_disposed", False) or tid != self.turn_id or self.stage != "draw":
                return
            letters = [i for i, ch in enumerate(self.word[0]) if ch != " " and i not in self.revealed]
            if len(letters) <= 3 or len(self.revealed) >= len(self.word[0].replace(" ", "")) // 3:
                return
            self.revealed.add(random.choice(letters))
            self._event("hint", None)
            await self.room.broadcast_state()

    def _mask(self):
        w = self.word[0]
        return "".join(ch if ch == " " or i in self.revealed else "_" for i, ch in enumerate(w))

    def _check(self, text):
        """'ok' · 'close' · None."""
        ans = norm(self.word[0])
        g = norm(text)
        if not g:
            return None
        if g == ans or strip_accents(g) == strip_accents(ans):
            return "ok"
        if close(strip_accents(g), strip_accents(ans)):
            return "close"
        return None

    def _act_guess(self, pid, data):
        text = " ".join(str(data.get("text", "")).split())[:80]
        if not text:
            return
        if self.phase != "play" or self.stage != "draw":
            raise GameError("Chưa phải lúc đoán.")
        if pid not in self.order:
            raise GameError("Bạn đang xem — ván sau mới được đoán.")
        inner = pid == self.drawer or pid in self.guessed
        res = self._check(text)
        if inner:
            if res:
                raise GameError("Không được để lộ đáp án nhé! 🤫")
            self._feed(pid, text, "inner", vis="inner")
            return
        if res == "ok":
            left = max(0.0, (self.deadline or time.time()) - time.time()) / self.config["draw_time"]
            bonus = [100, 50, 25][len(self.guessed)] if len(self.guessed) < 3 else 0
            pts = 100 + int(300 * left) + bonus + (self.word[2] - 1) * 25
            self.guessed[pid] = pts
            self.score[pid] += pts
            self.score[self.drawer] += 50
            self.turn_pts[self.drawer] = self.turn_pts.get(self.drawer, 0) + 50
            self._feed(pid, f"đã đoán ra! (+{pts})", "correct")
            self._event("correct", pid, pts=pts)
            guessers = [p for p in self.order if p != self.drawer and (self._connected(p) or self._is_bot(p))]
            if all(p in self.guessed for p in guessers):
                self.score[self.drawer] += 50
                self.turn_pts[self.drawer] += 50
                self._end_turn()
            return
        self._feed(pid, text, "guess")
        if res == "close":
            self._feed(pid, f"«{text}» gần đúng rồi!", "close", vis=pid)

    def _end_turn(self):
        if self.stage != "draw":
            return
        self._stop_timer()
        self.stage = "reveal"
        w = self.word[0]
        n = len(self.guessed)
        self._feed(None, f"Đáp án: «{w}» — {n} người đoán ra.", "answer")
        self._add_log(f"🎨 {self._name(self.drawer)} vẽ «{w}» — {n} người đoán ra.", "turn")
        self._event("reveal", self.drawer, word=w)
        self._set_timer(REVEAL_TIME, self._next_turn)

    def _finish(self):
        self._stop_timer()
        self.phase = "end"
        self.stage = None
        self.drawer = None
        self.ranking = sorted(self.order, key=lambda p: -self.score[p])
        self.winner = self.ranking[0] if self.ranking else None
        if self.winner:
            self.wins[self.winner] = self.wins.get(self.winner, 0) + 1
            text = f"🏆 {self._name(self.winner)} thắng ván {self.game_no} với {self.score[self.winner]} điểm!"
            self._add_log(text, "end")
            self._post_chat("system", text)
            self._event("win", self.winner)

    # ------------------------------------------------------------------ chat chung
    def _act_chat(self, pid, data):
        text = " ".join(str(data.get("text", "")).split())[:300]
        if not text:
            return
        if self.phase == "play" and self.stage == "draw" and self.word and pid in self.order:
            # Chat chung cũng là một cách đoán — và không được lộ đáp án ra kênh chung.
            res = self._check(text) or (norm(self.word[0]) in norm(text) and "ok")
            if res == "ok":
                if pid == self.drawer or pid in self.guessed:
                    raise GameError("Không được để lộ đáp án nhé! 🤫")
                self._act_guess(pid, {"text": self.word[0]})
                return
        self._post_chat("all", text, pid)

    # ------------------------------------------------------------------ trạng thái
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
                "guessed": p_id in self.guessed,
                "gained": self.guessed.get(p_id) or self.turn_pts.get(p_id, 0),
            })
        inner = pid == self.drawer or pid in self.guessed
        word = None
        if self.word:
            topic = TOPICS[self.word[1]]
            word = {"topic": topic[0], "topicIcon": topic[1], "level": self.word[2],
                    "lens": [len(x) for x in self.word[0].split()]}
            if inner or self.stage == "reveal":
                word["text"] = self.word[0]
            else:
                word["mask"] = self._mask()
        feed = [f for f in self.feed if f["vis"] == "all" or (f["vis"] == "inner" and inner) or f["vis"] == pid]
        return {
            "phase": self.phase,
            "stage": self.stage,
            "gameNo": self.game_no,
            "me": {"id": pid, "host": pid == self.room.host_id, "playing": pid in self.order},
            "players": players,
            "drawer": self.drawer,
            "round": self.round_no,
            "rounds": self.config["rounds"],
            "turnId": self.turn_id,
            "choices": [{"w": c[0], "level": c[2], "topic": TOPICS[c[1]][0]} for c in self.choices]
            if self.stage == "choose" and pid == self.drawer else None,
            "word": word,
            "feed": [{k: v for k, v in f.items() if k != "vis"} for f in feed[-60:]],
            "canvasVer": self.canvas_ver,
            "winner": self.winner,
            "ranking": self.ranking,
            "deadline": self.deadline,
            "total": self.phase_total,
            "now": time.time(),
            "events": self.events[-15:],
            "config": self.config,
            "choicesCfg": {"rounds": ROUNDS, "draw_time": DRAW_TIMES,
                           "topics": [{"key": k, "name": v[0], "icon": v[1]} for k, v in TOPICS.items()]},
            "wordCount": len(WORDS),
            "minPlayers": self.min_players,
            "maxPlayers": self.max_players,
            "startError": self._start_error() if self.phase != "play" else None,
            "chat": self.chat[-150:],
            "log": self.log[-100:],
        }
