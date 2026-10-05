"""Phản Xạ — chuỗi trò mini phản xạ nhanh & trí nhớ, mọi người chơi cùng lúc, đúng và nhanh thì nhiều điểm.

Mỗi vòng là một trò ngẫu nhiên:
  ⚡ reaction — chờ màn hình chuyển xanh rồi bấm thật nhanh (bấm sớm là hỏng).
  🎨 stroop   — chữ tên màu được tô bằng màu khác: chọn MÀU CHỮ (hoặc NGHĨA của chữ, tuỳ đề).
  🧮 math     — tính nhẩm, chọn đáp án đúng.
  🧠 sequence — nhớ dãy ô sáng lên theo thứ tự rồi bấm lại đúng thứ tự.
  🔢 count    — nhìn nhanh một lưới hình rồi trả lời có bao nhiêu hình X.
  👀 odd      — tìm hình khác biệt trong lưới.
  📍 position — nhớ vị trí các hình rồi chỉ ra hình X nằm ở ô nào.

Thời gian phản ứng do trình duyệt đo (tính từ lúc đề hiện ra / màn hình chuyển xanh) nên không phụ thuộc độ trễ mạng.
Đáp án được giữ ở máy chủ cho tới khi lật kết quả.
"""
import asyncio
import logging
import random
import time

from core.game_base import BaseGame, GameError
from .bots import PhanXaBotMixin

log = logging.getLogger("gamehub.phanxa")

COLORS = ["#ff6b6b", "#4d8df7", "#3cc47c", "#ffc23c", "#b07cff", "#ff8fc7", "#2fd0d0", "#ff9f43", "#9be15d", "#e0e0e0"]
INK = [("ĐỎ", "#ef4444"), ("XANH", "#3b82f6"), ("LỤC", "#22c55e"), ("VÀNG", "#facc15"), ("TÍM", "#a855f7"), ("CAM", "#f97316")]
PADS = 4
COUNT_SETS = [["🍎", "🍌", "🍇"], ["🐶", "🐱", "🐭"], ["⭐", "❤️", "🔷"], ["🚗", "🚲", "🚌"], ["🌸", "🍀", "🍄"]]
ODD_PAIRS = [("😀", "😃"), ("😐", "😑"), ("🙂", "😊"), ("🕐", "🕑"), ("🌕", "🌖"), ("🍊", "🍑"),
             ("💙", "💜"), ("🔵", "🟣"), ("🐻", "🐨"), ("😴", "😪"), ("🌲", "🌳")]
POS_ICONS = ["🐱", "🐶", "🐸", "🦊", "🐼", "🐵", "🐯", "🐰", "🐷", "🐮", "🦁", "🐔", "🐧", "🐙", "🦄", "🐝"]
TYPES = ["reaction", "stroop", "math", "sequence", "count", "odd", "position"]
TYPE_INFO = {
    "reaction": ("⚡", "Bấm nhanh", "Chờ màn hình chuyển XANH rồi bấm ngay! Bấm sớm là hỏng."),
    "stroop": ("🎨", "Đúng màu", "Đọc kỹ đề: chọn MÀU CỦA CHỮ hoặc NGHĨA của chữ."),
    "math": ("🧮", "Tính nhẩm", "Chọn đáp án đúng, càng nhanh càng nhiều điểm."),
    "sequence": ("🧠", "Nhớ dãy", "Nhớ thứ tự các ô sáng lên rồi bấm lại đúng thứ tự."),
    "count": ("🔢", "Đếm nhanh", "Lưới hình chỉ hiện chốc lát — đếm xem có bao nhiêu hình được hỏi."),
    "odd": ("👀", "Tìm điểm khác", "Có đúng một hình khác các hình còn lại — bấm vào nó."),
    "position": ("📍", "Nhớ vị trí", "Nhớ vị trí các con vật, chúng sẽ bị úp lại."),
}
ROUNDS = (7, 10, 15, 20)
SPEEDS = ("normal", "fast")
BOT_LEVELS = ("easy", "normal", "hard")
INTRO_TIME = 2.6
REVEAL_TIME = 4.0
GRACE = 1.2


class PhanXaGame(PhanXaBotMixin, BaseGame):
    id = "phanxa"
    name = "Phản Xạ"
    icon = "⚡"
    description = "Chuỗi trò mini phản xạ nhanh & trí nhớ: bấm nhanh, đúng màu, tính nhẩm, nhớ dãy, tìm điểm khác… Mọi người chơi cùng lúc!"
    min_players = 1
    max_players = 10
    guide = [
        ("🎯 Mục tiêu", "Qua nhiều vòng trò mini, ai **đúng và nhanh** nhất thì được nhiều điểm. Hết các vòng, **tổng điểm cao nhất** thắng."),
        ("🕹️ Các trò mini", [
            "⚡ **Bấm nhanh** — chờ màn hình chuyển **xanh** rồi bấm. Bấm sớm là hỏng!",
            "🎨 **Đúng màu** — chữ tên màu được tô màu khác: đọc kỹ đề để chọn **màu của chữ** hay **nghĩa của chữ**.",
            "🧮 **Tính nhẩm** — chọn đáp án đúng.",
            "🧠 **Nhớ dãy** — các ô sáng lên theo thứ tự, bấm lại đúng thứ tự.",
            "🔢 **Đếm nhanh** — lưới hình hiện chốc lát, đếm số hình được hỏi.",
            "👀 **Tìm điểm khác** — bấm vào hình duy nhất khác các hình còn lại.",
            "📍 **Nhớ vị trí** — nhớ chỗ các con vật trước khi bị úp lại.",
        ]),
        ("🏅 Tính điểm", [
            "Đúng: **400–1000 điểm** tuỳ tốc độ. Người đúng **nhanh nhất** vòng được thưởng **+200**.",
            "Sai hoặc hết giờ: 0 điểm. Mỗi người chỉ được trả lời **một lần** mỗi vòng.",
            "Thời gian tính từ lúc đề hiện trên máy bạn, nên mạng chậm không bị thiệt.",
        ]),
        ("⚙️ Tuỳ chọn (chủ phòng)", "Số vòng, tốc độ (thường / nhanh), độ khó của bot. Chơi một mình cũng được để luyện!"),
    ]

    def __init__(self, room):
        super().__init__(room)
        self.config = {"rounds": 10, "speed": "normal", "bot_level": "normal"}
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
        self._reset_game()
        self.phase = "lobby"

    def _reset_game(self):
        self._token += 1
        self.deadline = self.phase_total = None
        self.order = []
        self.names = {}
        self.colors = {}
        self.score = {}
        self.best_ms = {}          # phản xạ nhanh nhất (vòng ⚡) của mỗi người
        self.correct = {}
        self.stage = None          # intro · play · reveal
        self.round_no = 0
        self.plan = []
        self.rnd = None            # vòng hiện tại (đề công khai + đáp án bí mật)
        self.answers = {}
        self.started_at = None     # thời điểm (máy chủ) bắt đầu giai đoạn chơi
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
                log.exception("Lỗi hẹn giờ Phản Xạ")
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
        return {"label": "Đang thi phản xạ", "joinable": False}

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
        if data.get("speed") in SPEEDS:
            self.config["speed"] = data["speed"]
        if data.get("bot_level") in BOT_LEVELS:
            self.config["bot_level"] = data["bot_level"]

    def _start_error(self):
        n = len(self.room.players)
        if n < self.min_players:
            return f"Cần ít nhất {self.min_players} người chơi."
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
        for i, p in enumerate(self.order):
            self.names[p] = self._name(p)
            self.colors[p] = COLORS[i % len(COLORS)]
            self.score[p] = 0
            self.correct[p] = 0
            self.wins.setdefault(p, 0)
        # Lần lượt đủ các trò rồi mới lặp lại, không trò nào ra hai vòng liền.
        plan = []
        while len(plan) < self.config["rounds"]:
            bag = TYPES[:]
            random.shuffle(bag)
            if plan and bag[0] == plan[-1]:
                bag.append(bag.pop(0))
            plan += bag
        self.plan = plan[:self.config["rounds"]]
        self._post_chat("system", f"⚡ Ván {self.game_no} bắt đầu — {len(self.plan)} vòng!")
        self._add_log(f"⚡ Ván {self.game_no} bắt đầu — {len(self.plan)} vòng.", "start")
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

    # ------------------------------------------------------------------ tạo đề
    def _make_round(self, kind):
        """(đề công khai, đáp án, thời gian xem đề ms, thời gian trả lời ms)."""
        lv = self.round_no / max(1, len(self.plan))     # 0 → 1: càng về sau càng khó
        fast = self.config["speed"] == "fast"
        k = 0.8 if fast else 1.0
        if kind == "reaction":
            wait = random.randint(1500, 5000)
            return {"wait": wait}, "go", wait, 2500
        if kind == "stroop":
            word, ink = random.sample(range(len(INK)), 2)
            rule = random.choice(["ink", "word"])
            opts = random.sample([i for i in range(len(INK)) if i not in (word, ink)], 2) + [word, ink]
            random.shuffle(opts)
            target = ink if rule == "ink" else word
            content = {"word": INK[word][0], "ink": INK[ink][1], "rule": rule,
                       "options": [{"label": INK[i][0], "color": INK[i][1]} for i in opts]}
            return content, opts.index(target), 0, int(5000 * k)
        if kind == "math":
            if lv < 0.35:
                a, b = random.randint(5, 49), random.randint(5, 49)
                op = random.choice("+-")
            elif lv < 0.7:
                op = random.choice("+-×")
                a, b = (random.randint(3, 12), random.randint(3, 12)) if op == "×" else (random.randint(20, 99), random.randint(10, 79))
            else:
                op = random.choice("+-×")
                a, b = (random.randint(6, 19), random.randint(3, 12)) if op == "×" else (random.randint(50, 199), random.randint(20, 99))
            if op == "-" and b > a:
                a, b = b, a
            ans = a + b if op == "+" else a - b if op == "-" else a * b
            opts = {ans}
            while len(opts) < 4:
                d = random.choice([1, 2, 3, 10, 9, 11, 5])
                opts.add(ans + random.choice([-1, 1]) * d)
            opts = list(opts)
            random.shuffle(opts)
            return {"expr": f"{a} {op} {b}", "options": opts}, opts.index(ans), 0, int(7000 * k)
        if kind == "sequence":
            n = 4 + round(lv * 3)
            seq = [random.randrange(PADS)]
            while len(seq) < n:
                x = random.randrange(PADS)
                if x != seq[-1] or random.random() < 0.2:
                    seq.append(x)
            step = 420 if fast else 560
            return {"seq": seq, "step": step}, seq, n * step + 500, 3500 + n * 700
        if kind == "count":
            icons = random.choice(COUNT_SETS)
            size = 5 if lv < 0.5 else 6
            weights = [random.uniform(0.6, 1.4) for _ in icons]
            grid = random.choices(range(len(icons)), weights=weights, k=size * size)
            ask = random.randrange(len(icons))
            ans = grid.count(ask)
            opts = {ans}
            while len(opts) < 4:
                v = ans + random.choice([-3, -2, -1, 1, 2, 3])
                if v >= 0:
                    opts.add(v)
            opts = list(opts)
            random.shuffle(opts)
            show = int((2600 if size == 5 else 3000) * k)
            return ({"icons": icons, "grid": grid, "size": size, "ask": ask, "options": opts},
                    opts.index(ans), show, 6000)
        if kind == "odd":
            a, b = random.choice(ODD_PAIRS)
            if random.random() < 0.5:
                a, b = b, a
            size = 6 if lv < 0.5 else 7
            odd = random.randrange(size * size)
            return {"base": a, "odd": b, "size": size, "cell": odd}, odd, 0, int(9000 * k)
        if kind == "position":
            size = 3 if lv < 0.5 else 4
            n = size * size
            icons = random.sample(POS_ICONS, n)
            ask = random.randrange(n)
            show = int((3000 if size == 3 else 4200) * k)
            return {"size": size, "icons": icons, "askIcon": icons[ask]}, ask, show, 6000
        raise ValueError(kind)

    # ------------------------------------------------------------------ vòng chơi
    def _next_round(self):
        if self.round_no >= len(self.plan):
            self._finish()
            return
        kind = self.plan[self.round_no]
        self.round_no += 1
        content, key, show_ms, answer_ms = self._make_round(kind)
        self.rnd = {"type": kind, "content": content, "key": key, "show": show_ms, "limit": answer_ms}
        self.answers = {}
        self.stage = "intro"
        self._event("intro", None, round=self.round_no, game=kind)
        self._set_timer(INTRO_TIME, self._begin_play)

    def _begin_play(self):
        self.stage = "play"
        self.started_at = time.time()
        self._event("play", None, round=self.round_no)
        total = (self.rnd["show"] + self.rnd["limit"]) / 1000 + GRACE
        self._set_timer(total, self._reveal)

    def _act_answer(self, pid, data):
        if self.phase != "play" or self.stage != "play" or pid not in self.order:
            raise GameError("Chưa thể trả lời lúc này.")
        if data.get("round") != self.round_no:
            raise GameError("Vòng này đã qua.")
        if pid in self.answers:
            raise GameError("Bạn đã trả lời vòng này rồi.")
        r = self.rnd
        value = data.get("value")
        try:
            ms = int(data.get("ms", 0))
        except (TypeError, ValueError):
            ms = r["limit"]
        ms = max(80, min(ms, r["limit"]))
        if r["type"] == "reaction":
            ok = value == "go"
        elif r["type"] == "sequence":
            ok = isinstance(value, list) and [int(x) for x in value if isinstance(x, (int, float))] == r["key"]
        else:
            try:
                ok = int(value) == r["key"]
            except (TypeError, ValueError):
                ok = False
        self.answers[pid] = {"value": value, "ms": ms, "ok": ok, "pts": 0, "early": value == "early"}
        self._event("answered", pid)
        players = [p for p in self.order if self._connected(p)]
        if all(p in self.answers for p in players):
            self._stop_timer()
            self._reveal()

    def _points(self, a):
        r = self.rnd
        if not a["ok"]:
            return 0
        if r["type"] == "reaction":
            return max(250, min(1000, int(1100 - a["ms"] * 1.2)))
        return int(1000 - 600 * min(1.0, a["ms"] / r["limit"]))

    def _reveal(self):
        if self.stage != "play":
            return
        self.stage = "reveal"
        fastest = None
        for pid, a in self.answers.items():
            a["pts"] = self._points(a)
            if a["ok"] and (fastest is None or a["ms"] < self.answers[fastest]["ms"]):
                fastest = pid
        if fastest:
            self.answers[fastest]["pts"] += 200
            self.answers[fastest]["fastest"] = True
        for pid, a in self.answers.items():
            self.score[pid] += a["pts"]
            if a["ok"]:
                self.correct[pid] += 1
                if self.rnd["type"] == "reaction":
                    self.best_ms[pid] = min(self.best_ms.get(pid, 10 ** 6), a["ms"])
        icon, title, _ = TYPE_INFO[self.rnd["type"]]
        if fastest:
            self._add_log(f"{icon} Vòng {self.round_no} ({title}): {self._name(fastest)} nhanh nhất — {self.answers[fastest]['ms']} ms.", "round")
        else:
            self._add_log(f"{icon} Vòng {self.round_no} ({title}): không ai đúng!", "round")
        self._event("reveal", fastest, round=self.round_no)
        self._set_timer(REVEAL_TIME, self._next_round)

    def _finish(self):
        self._stop_timer()
        self.phase = "end"
        self.stage = None
        self.ranking = sorted(self.order, key=lambda p: -self.score[p])
        self.winner = self.ranking[0] if self.ranking else None
        if self.winner:
            self.wins[self.winner] = self.wins.get(self.winner, 0) + 1
            text = f"🏆 {self._name(self.winner)} thắng ván {self.game_no} với {self.score[self.winner]:,} điểm!".replace(",", ".")
            self._add_log(text, "end")
            self._post_chat("system", text)
            self._event("win", self.winner)

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
                "correct": self.correct.get(p_id, 0),
                "best": self.best_ms.get(p_id),
                "wins": self.wins.get(p_id, 0),
                "answered": p_id in self.answers if self.stage == "play" else None,
            })
        rnd = None
        if self.rnd and self.phase == "play":
            icon, title, hint = TYPE_INFO[self.rnd["type"]]
            rnd = {"n": self.round_no, "total": len(self.plan), "type": self.rnd["type"], "icon": icon, "title": title,
                   "hint": hint, "show": self.rnd["show"], "limit": self.rnd["limit"],
                   "content": self.rnd["content"] if self.stage in ("play", "reveal") else None,
                   "startedAt": self.started_at if self.stage != "intro" else None}
            if self.stage == "reveal":
                rnd["key"] = self.rnd["key"]
                rnd["results"] = {p: {k: v for k, v in a.items() if k != "value"} for p, a in self.answers.items()}
            mine = self.answers.get(pid)
            rnd["mine"] = {"value": mine["value"], "ms": mine["ms"]} if mine else None
        return {
            "phase": self.phase,
            "stage": self.stage,
            "gameNo": self.game_no,
            "me": {"id": pid, "host": pid == self.room.host_id, "playing": pid in self.order},
            "players": players,
            "round": rnd,
            "winner": self.winner,
            "ranking": self.ranking,
            "deadline": self.deadline,
            "total": self.phase_total,
            "now": time.time(),
            "events": self.events[-15:],
            "config": self.config,
            "choices": {"rounds": ROUNDS, "speed": SPEEDS, "bot_level": BOT_LEVELS},
            "types": {k: {"icon": v[0], "title": v[1]} for k, v in TYPE_INFO.items()},
            "minPlayers": self.min_players,
            "maxPlayers": self.max_players,
            "startError": self._start_error() if self.phase != "play" else None,
            "chat": self.chat[-150:],
            "log": self.log[-100:],
        }
