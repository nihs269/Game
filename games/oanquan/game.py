"""Ô Ăn Quan — trò chơi dân gian 2–4 người: bốc quân trong ô của mình, rải lần lượt từng ô, ăn quân đối thủ.

Luật (kiểu phổ biến, một số điểm chủ phòng chỉnh được):
  • Mỗi người giữ 5 ô dân (mỗi ô 5 dân); giữa hai hàng liền nhau là một ô quan (1 quan). 2 người: bàn
    chữ nhật, 2 ô quan ở hai đầu; 3 người: bàn tam giác; 4 người: bàn vuông, ô quan nằm ở các góc.
  • Đến lượt: chọn một ô dân bên mình có quân, chọn chiều, bốc hết rải mỗi ô một quân (rải cả vào ô quan).
  • Rải xong: ô kế là ô dân có quân → bốc rải tiếp; ô kế là ô quan → mất lượt; ô kế trống → ăn ô sau nó,
    rồi cứ “một ô trống, một ô có quân” lại ăn tiếp; hai ô trống liền → hết lượt.
  • Đến lượt mà 5 ô bên mình trống trơn → lấy 5 dân trong kho rải lại (không đủ thì vay người nhiều dân nhất,
    cuối ván trả).
  • Hết quan, tàn dân: mọi ô quan đều trống thì hết ván, dân còn trên hàng ai về người đó. Quan = 10 dân (tuỳ chọn 5).
"""
import asyncio
import logging
import random
import time

from core.game_base import BaseGame, GameError
from .bots import OanQuanBotMixin
from .rules import SIDE, row, legal_moves, new_board, sow, finished

log = logging.getLogger("gamehub.oanquan")

TURN_TIMES = (0, 15, 20, 30, 45, 60)
BOT_LEVELS = ("easy", "normal", "hard")
QUAN_VALUES = (10, 5)
# Thời gian diễn từng bước rải (giây) — khớp với hoạt ảnh bên trình duyệt.
STEP_TIME = {"pick": 0.35, "drop": 0.18, "eat": 0.6, "stop": 0.3}
SPREAD_TIME = 1.2
OFFLINE_TIME = 5
MAX_TURNS = 400


def steps_time(steps):
    return sum(STEP_TIME[s[0]] for s in steps)


class OanQuanGame(OanQuanBotMixin, BaseGame):
    id = "oanquan"
    name = "Ô Ăn Quan"
    icon = "🪨"
    description = "Trò chơi dân gian 2–4 người: bốc sỏi rải từng ô, ăn dân, ăn quan — hết quan tàn dân ai nhiều điểm hơn thì thắng!"
    min_players = 2
    max_players = 4
    guide = [
        ("🎯 Mục tiêu", "Ăn được nhiều quân hơn đối thủ. Mỗi **dân** (sỏi nhỏ) được 1 điểm, mỗi **quan** (viên to ở ô hai đầu) được **10 điểm** (tuỳ phòng: 5)."),
        ("🪨 Bàn chơi", [
            "Mỗi người giữ **5 ô dân** ở hàng gần mình (luôn là cạnh dưới màn hình), mỗi ô có 5 dân. Giữa hai hàng liền nhau là một **ô quan** có 1 quan.",
            "**2 người**: bàn chữ nhật, 2 ô quan bán nguyệt ở hai đầu. **3 người**: bàn tam giác. **4 người**: bàn vuông — ô quan nằm ở các góc.",
        ]),
        ("👆 Đến lượt", [
            "Bấm vào một ô bên mình còn quân, rồi chọn mũi tên **◀ / ▶** để rải sang trái hoặc phải (phím **1–5** rồi **← / →**).",
            "Bốc hết quân trong ô, rải lần lượt mỗi ô một quân theo chiều đã chọn — rải cả qua ô quan và hàng đối thủ.",
            "Nhiều người thì đi lần lượt theo vòng: người giữ cạnh nằm sau ô quan bên phải bạn đi kế tiếp.",
        ]),
        ("🔁 Rải xong quân cuối", [
            "Ô kế tiếp là **ô dân có quân** → bốc ô đó lên rải tiếp.",
            "Ô kế tiếp là **ô quan** còn quân → mất lượt.",
            "Ô kế tiếp **trống** → **ăn** hết quân ở ô ngay sau nó. Sau đó nếu lại là một ô trống rồi một ô có quân thì ăn tiếp (ăn dây chuyền).",
            "Gặp **hai ô trống liền** → hết lượt.",
        ]),
        ("🧺 Rải quân", "Đến lượt mà 5 ô bên mình đều trống thì phải lấy **5 dân trong kho** rải mỗi ô một quân. Kho không đủ thì **vay** người có nhiều dân nhất, hết ván trả lại."),
        ("🏁 Hết ván", "**Hết quan, tàn dân**: khi mọi ô quan đều trống thì ván kết thúc, dân còn trên hàng của ai thuộc về người đó. Ai nhiều điểm hơn thắng."),
        ("⚙️ Tuỳ chọn (chủ phòng)", "Giá trị quan (10 hoặc 5 dân), luật **quan non** (ô quan còn ít hơn 5 dân thì chưa được ăn), thời gian mỗi lượt (hết giờ máy tự đi), độ khó bot."),
    ]

    def __init__(self, room):
        super().__init__(room)
        self.config = {"quan_value": 10, "quan_non": False, "turn_time": 30, "bot": "normal"}
        self.chat = []
        self.log = []
        self.events = []
        self._msg_id = 0
        self._seq = 0
        self._token = 0
        self.wins = {}
        self.draws = 0
        self.game_no = 0
        self._reset_game()
        self.phase = "lobby"

    def _reset_game(self):
        self._token += 1
        self.deadline = self.phase_total = None
        self.seats = []
        self.names = {}
        self.dan, self.quan = new_board(2)
        self.got_dan = [0, 0]
        self.got_quan = [0, 0]
        self.debt = [[0, 0], [0, 0]]  # debt[i][j]: số dân ghế i đã vay của ghế j
        self.cur = 0
        self.first = None
        self.turns = 0
        self.stage = None           # pick · sowing · spread
        self.last_move = None
        self.winner = None
        self.final = None
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
    def current(self):
        return self.seats[self.cur] if self.phase == "play" and self.seats else None

    def _score(self, seat):
        return self.got_dan[seat] + self.got_quan[seat] * self.config["quan_value"]

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
                log.exception("Lỗi hẹn giờ Ô Ăn Quan")
            await self.room.broadcast_state()

    def _stop_timer(self):
        self._token += 1
        self.deadline = self.phase_total = None

    def _decision_timer(self):
        pid = self.current
        if pid is None or self.stage != "pick":
            return
        if not self._connected(pid):
            self._set_timer(OFFLINE_TIME, self._auto)
        elif self.config["turn_time"]:
            self._set_timer(self.config["turn_time"], self._auto)
        else:
            self._stop_timer()

    def _auto(self):
        pid = self.current
        if pid is None or self.stage != "pick":
            return
        cell, d = self._best_move(pid, "normal")
        self._act_move(pid, {"cell": cell, "dir": d})

    def dispose(self):
        self._token += 1
        self._disposed = True

    # ------------------------------------------------------------------ core hooks
    def can_remove(self, pid):
        return self.phase != "play" or pid not in self.seats

    def can_rename(self):
        return self.phase != "play"

    def status(self):
        if self.phase == "lobby":
            return {"label": "Đang chờ", "joinable": True}
        if self.phase == "end":
            return {"label": "Nghỉ giữa ván", "joinable": True}
        return {"label": "Đang chơi", "joinable": False}

    async def on_player_join(self, player):
        self._post_chat("system", f"👋 {player.name} đã vào phòng.")

    async def on_player_removed(self, player):
        self.names[player.id] = player.name
        self._post_chat("system", f"🚪 {player.name} đã rời phòng.")

    async def on_player_disconnect(self, player):
        if player.id == self.current:
            self._decision_timer()

    async def on_player_connect(self, player):
        if player.id == self.current:
            self._decision_timer()

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
        if "quan_non" in data:
            self.config["quan_non"] = bool(data["quan_non"])
        if data.get("bot") in BOT_LEVELS:
            self.config["bot"] = data["bot"]
        for key, allowed in (("turn_time", TURN_TIMES), ("quan_value", QUAN_VALUES)):
            if key in data:
                try:
                    v = int(data[key])
                except (TypeError, ValueError):
                    continue
                if v in allowed:
                    self.config[key] = v

    def _start_error(self):
        n = len(self.room.players)
        if n < self.min_players:
            return "Cần ít nhất 2 người chơi — mời bạn bè hoặc thêm bot."
        return None

    def _act_start(self, pid, data):
        self._require_host(pid)
        if self.phase == "play":
            raise GameError("Ván đang diễn ra.")
        err = self._start_error()
        if err:
            raise GameError(err)
        prev, prev_final = self.seats, self.final
        self._reset_game()
        self.game_no += 1
        self.phase = "play"
        seats = self.participants()
        # Ván đầu bốc thăm chỗ ngồi; các ván sau cùng người thì giữ chỗ, người đi trước xoay vòng cho công bằng.
        same = bool(prev_final) and set(prev) == set(seats)
        if same:
            seats = list(prev)
        else:
            random.shuffle(seats)
        self.seats = seats
        n = len(seats)
        self.dan, self.quan = new_board(n)
        self.got_dan = [0] * n
        self.got_quan = [0] * n
        self.debt = [[0] * n for _ in range(n)]
        for p in self.seats:
            self.names[p] = self._name(p)
            self.wins.setdefault(p, 0)
        first = self.seats[0]
        if same:
            first = self.seats[(self.seats.index(prev_final["first"]) + 1) % n]
        self.first = first
        self.cur = self.seats.index(first)
        self._post_chat("system", f"🪨 Ván {self.game_no} bắt đầu! {self._name(first)} đi trước.")
        self._add_log(f"🪨 Ván {self.game_no} bắt đầu — {self._name(first)} đi trước.", "start")
        self._begin_turn()

    def _act_next_round(self, pid, data):
        self._act_start(pid, data)

    def _act_lobby(self, pid, data):
        self._require_host(pid)
        if self.phase != "end":
            raise GameError("Không thể làm việc này lúc này.")
        self._reset_game()
        self.phase = "lobby"
        self.wins = {}
        self.draws = 0
        self.game_no = 0
        self._post_chat("system", "🔁 Quay lại phòng chờ.")

    # ------------------------------------------------------------------ lượt chơi
    def _begin_turn(self):
        seat = self.cur
        pid = self.current
        if not any(self.dan[c] for c in row(seat)):
            # Hàng nhà trống trơn: lấy 5 dân trong kho rải lại, thiếu thì vay người nhiều dân nhất.
            own = min(5, self.got_dan[seat])
            need = 5 - own
            others = sorted((s for s in range(len(self.seats)) if s != seat), key=lambda s: -self.got_dan[s])
            if need > sum(max(0, self.got_dan[s]) for s in others):
                self._add_log(f"🧺 {self._name(pid)} hết quân để rải — kết thúc ván.", "end")
                self._finish()
                return
            self.got_dan[seat] -= own
            loans = []
            for s in others:
                take = min(need, max(0, self.got_dan[s]))
                if take:
                    self.got_dan[s] -= take
                    self.debt[seat][s] += take
                    loans.append(f"{take} dân của {self._name(self.seats[s])}")
                    need -= take
                if not need:
                    break
            for c in row(seat):
                self.dan[c] = 1
            text = f"🧺 {self._name(pid)} hết quân trên hàng — lấy 5 dân trong kho ra rải."
            if loans:
                text = f"🧺 {self._name(pid)} hết quân trên hàng — rải {own} dân trong kho, vay {', '.join(loans)}."
            self._add_log(text, "spread")
            self._event("spread", pid, seat=seat, own=own, borrow=5 - own)
            self.stage = "spread"
            self._set_timer(SPREAD_TIME, self._ready)
            return
        self._ready()

    def _ready(self):
        self.stage = "pick"
        self._event("turn", self.current)
        self._decision_timer()

    def _act_move(self, pid, data):
        if self.phase != "play" or pid != self.current or self.stage != "pick":
            raise GameError("Chưa đến lượt của bạn.")
        try:
            cell, d = int(data.get("cell")), int(data.get("dir"))
        except (TypeError, ValueError):
            raise GameError("Hãy chọn một ô và chiều rải.")
        seat = self.cur
        if (cell, d) not in legal_moves(self.dan, seat):
            raise GameError("Chọn một ô bên bạn còn quân, rải sang trái hoặc phải.")
        dan, quan, gd, gq, steps = sow(self.dan, self.quan, cell, d, self.config["quan_non"])
        self.dan, self.quan = dan, quan
        self.got_dan[seat] += gd
        self.got_quan[seat] += gq
        self.turns += 1
        self.last_move = {"seat": seat, "cell": cell, "dir": d}
        self.stage = "sowing"
        self._stop_timer()
        victims = [st[1] // SIDE for st in steps if st[0] == "eat" and st[3]]
        self._event("move", pid, seat=seat, cell=cell, dir=d, steps=steps, dan=gd, quan=gq, victims=victims)
        name = self._name(pid)
        if gd or gq:
            parts = ([f"{gq} quan"] if gq else []) + ([f"{gd} dân"] if gd else [])
            self._add_log(f"😋 {name} ăn {' và '.join(parts)} (+{gd + gq * self.config['quan_value']} điểm).", "eat" if not gq else "quan")
        else:
            self._add_log(f"🪨 {name} rải quân, không ăn được gì.", "move")
        self._set_timer(steps_time(steps) + 0.3, self._after_sow)

    def _after_sow(self):
        if finished(self.dan, self.quan) or self.turns >= MAX_TURNS:
            self._finish()
            return
        self.cur = (self.cur + 1) % len(self.seats)
        self._begin_turn()

    def _finish(self):
        self._stop_timer()
        n = len(self.seats)
        # Hết quan, tàn dân: dân còn trên hàng ai về người đó; ai vay thì trả.
        swept = [0] * n
        for seat in range(n):
            for c in row(seat):
                swept[seat] += self.dan[c]
                self.dan[c] = 0
            self.got_dan[seat] += swept[seat]
            self.dan[SIDE * seat] = 0
        borrowed = [sum(self.debt[s]) for s in range(n)]
        lent = [sum(self.debt[o][s] for o in range(n)) for s in range(n)]
        for seat in range(n):
            self.got_dan[seat] += lent[seat] - borrowed[seat]
        scores = [self._score(s) for s in range(n)]
        top = max(scores)
        leaders = [s for s in range(n) if scores[s] == top]
        ranking = sorted(range(n), key=lambda s: -scores[s])
        self.phase = "end"
        self.stage = None
        self.winner = self.seats[leaders[0]] if len(leaders) == 1 else None
        self.final = {"scores": scores, "swept": swept, "borrowed": borrowed, "lent": lent,
                      "ranking": ranking, "leaders": leaders, "first": self.first}
        self._event("end", self.winner, swept=swept)
        board = " : ".join(str(scores[s]) for s in ranking)
        if self.winner:
            self.wins[self.winner] = self.wins.get(self.winner, 0) + 1
            if n == 2:
                loser = self.seats[1 - leaders[0]]
                text = f"🏆 {self._name(self.winner)} thắng ván {self.game_no} — {board} trước {self._name(loser)}!"
            else:
                text = f"🏆 {self._name(self.winner)} thắng ván {self.game_no} với {top} điểm ({board})!"
        else:
            self.draws += 1
            names = ", ".join(self._name(self.seats[s]) for s in leaders)
            text = f"🤝 Ván {self.game_no} hoà — {names} cùng {top} điểm ({board})!"
        if any(swept):
            parts = ", ".join(f"{self._name(self.seats[s])} +{swept[s]}" for s in range(n))
            self._add_log(f"🧹 Hết quan, tàn dân — thu dân trên hàng: {parts}.", "info")
        self._add_log(text, "end")
        self._post_chat("system", text)

    # ------------------------------------------------------------------ chat
    def _act_chat(self, pid, data):
        text = " ".join(str(data.get("text", "")).split())[:300]
        if text:
            self._post_chat("all", text, pid)

    # ------------------------------------------------------------------ trạng thái
    def view(self, pid):
        playing = self.phase in ("play", "end")
        order = list(self.seats) if playing else []
        order += [p for p in self.room.players if p not in order]
        players = []
        for p_id in order:
            p = self.room.players.get(p_id)
            seat = self.seats.index(p_id) if p_id in self.seats else None
            players.append({
                "id": p_id,
                "name": p.name if p else self.names.get(p_id, "?"),
                "bot": bool(p and p.is_bot),
                "connected": bool(p and p.connected),
                "look": p.look if p else None,
                "host": p_id == self.room.host_id,
                "playing": seat is not None,
                "seat": seat,
                "wins": self.wins.get(p_id, 0),
            })
        mine = self.phase == "play" and self.current == pid and self.stage == "pick"
        n = len(self.seats) if playing else max(2, min(4, len(self.room.players)))
        dan, quan = (self.dan, self.quan) if playing else new_board(n)
        return {
            "phase": self.phase,
            "stage": self.stage,
            "gameNo": self.game_no,
            "me": {"id": pid, "host": pid == self.room.host_id, "playing": pid in self.seats,
                   "seat": self.seats.index(pid) if pid in self.seats else None},
            "players": players,
            "seats": self.seats,
            "turn": self.current,
            "dan": dan,
            "quan": quan,
            "gotDan": self.got_dan,
            "gotQuan": self.got_quan,
            "n": n,
            "debt": [sum(d) for d in self.debt],
            "scores": [self._score(s) for s in range(len(self.seats))],
            "legal": sorted({c for c, _ in legal_moves(self.dan, self.cur)}) if mine else None,
            "lastMove": self.last_move,
            "winner": self.winner,
            "final": self.final,
            "draws": self.draws,
            "deadline": self.deadline,
            "total": self.phase_total,
            "now": time.time(),
            "events": self.events[-15:],
            "config": self.config,
            "turnTimes": TURN_TIMES,
            "stepTime": STEP_TIME,
            "minPlayers": self.min_players,
            "maxPlayers": self.max_players,
            "startError": self._start_error() if self.phase != "play" else None,
            "chat": self.chat[-150:],
            "log": self.log[-100:],
        }
