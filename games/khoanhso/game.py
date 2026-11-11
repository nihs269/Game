"""Khoanh Số — một tờ giấy in lộn xộn các số từ 1 đến N, mọi người cùng lúc thi nhau tìm và khoanh
số theo thứ tự 1 → 2 → 3 → … Ai khoanh được số đang cần trước thì số đó mang màu bút của người đó.
Hết số (hoặc hết giờ), ai khoanh được nhiều số nhất thì thắng.

Khoanh nhầm (bấm số chưa tới lượt) bị khoá bút một lúc. Bố cục tờ giấy do máy chủ tạo nên mọi người
thấy giống hệt nhau; tờ giấy chỉ được gửi xuống lúc bắt đầu để không ai dò trước.
"""
import asyncio
import logging
import math
import random
import time

from core.game_base import BaseGame, GameError
from .bots import KhoanhSoBotMixin

log = logging.getLogger("gamehub.khoanhso")

PENS = ["#e53935", "#1e63d6", "#16a34a", "#9c27b0", "#f57c00", "#00897b", "#d81b60", "#5d4037",
        "#3949ab", "#7cb342", "#00acc1", "#455a64"]
PEN_NAMES = ["Đỏ", "Xanh dương", "Xanh lá", "Tím", "Cam", "Xanh ngọc", "Hồng", "Nâu",
             "Chàm", "Xanh nõn", "Xanh trời", "Xám"]
SIZES = (20, 30, 50, 75, 100)
LIMITS = (0, 180, 300, 600)          # giây; 0 = không giới hạn
BOT_LEVELS = ("easy", "normal", "hard")
READY_TIME = 3.0
WRONG_LOCK = 1.5                     # khoanh nhầm → khoá bút (giây)
HINT_AFTER = 20                      # sau chừng này giây chưa ai tìm ra → số cần tìm phát sáng nhẹ
ASPECT = 4 / 3                       # tỉ lệ ngang/dọc của tờ giấy


def make_board(n):
    """Rải n số lên lưới hơi thừa ô, mỗi số lệch khỏi tâm ô, to nhỏ và nghiêng khác nhau.
    Trả về danh sách theo số: board[k-1] = {x, y (phần trăm), s (tỉ lệ cỡ chữ), r (độ nghiêng)}."""
    cells = math.ceil(n * 1.18)
    cols = max(4, round(math.sqrt(cells * ASPECT)))
    rows = math.ceil(cells / cols)
    spots = random.sample(range(cols * rows), n)
    board = []
    for spot in spots:
        cx, cy = spot % cols, spot // cols
        # Lệch ngang ít (số nằm cạnh nhau dễ đọc nhầm thành một số dài), chừa lề để số không bị cắt ở mép giấy.
        x = (cx + 0.5 + random.uniform(-0.12, 0.12)) / cols
        y = (cy + 0.5 + random.uniform(-0.22, 0.22)) / rows
        board.append({"x": round(5 + x * 90, 2), "y": round(5 + y * 90, 2), "s": round(random.uniform(0.85, 1.25), 2),
                      "r": random.randint(-30, 30)})
    return board, cols, rows


class KhoanhSoGame(KhoanhSoBotMixin, BaseGame):
    id = "khoanhso"
    name = "Khoanh Số"
    icon = "⭕"
    description = "Tờ giấy đầy số lộn xộn — mỗi người một màu bút, thi nhau khoanh số theo thứ tự 1, 2, 3… Ai khoanh nhiều nhất thắng!"
    min_players = 1
    max_players = 12
    guide = [
        ("🎯 Mục tiêu", "Tờ giấy có các số từ **1 đến N** (chủ phòng chọn 20–100) nằm lộn xộn. Mọi người **cùng lúc** tìm và khoanh số "
                       "**theo thứ tự**: 1, rồi 2, rồi 3… Hết số, ai khoanh được **nhiều số nhất** thì thắng."),
        ("✍️ Cách khoanh", [
            "Số cần tìm hiện to ở phía trên tờ giấy. Thấy nó thì **bấm vào** — ai bấm trước thì số đó được khoanh bằng **màu bút của người đó**.",
            "Mỗi người một màu bút riêng, nhìn tờ giấy là biết ai khoanh số nào.",
            "Bấm nhầm số chưa tới lượt bị **khoá bút 1,5 giây** — đừng bấm bừa!",
            f"Quá {HINT_AFTER} giây chưa ai tìm ra thì số cần tìm sẽ **phát sáng nhẹ** để gợi ý.",
        ]),
        ("⚙️ Tuỳ chọn (chủ phòng)", "Số lượng số (20–100), giới hạn thời gian, độ khó của bot. Chơi một mình để luyện mắt cũng được!"),
    ]

    def __init__(self, room):
        super().__init__(room)
        self.config = {"size": 50, "limit": 0, "bot_level": "normal"}
        self.chat = []
        self.log = []
        self.events = []
        self._msg_id = 0
        self._seq = 0
        self._token = 0
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
        self.pen = {}
        self.count = {}
        self.misses = {}
        self.lock_until = {}
        self.stage = None            # ready · play
        self.size = self.config["size"]
        self.board = []
        self.grid = (0, 0)
        self.owner = []              # owner[k-1] = pid đã khoanh số k
        self.target = 1
        self.target_at = None
        self.started_at = None
        self.winners = []
        self.ranking = []
        self.end_reason = None
        self._bots_reset()

    # ------------------------------------------------------------------ tiện ích
    def _name(self, pid):
        p = self.room.players.get(pid)
        return p.name if p else self.names.get(pid, "?")

    def _add_log(self, text, kind="info"):
        self.log.append({"t": time.time(), "text": text, "kind": kind})
        if len(self.log) > 200:
            self.log = self.log[-200:]

    def _event(self, kind, pid=None, **extra):
        self._seq += 1
        self.events.append({"seq": self._seq, "type": kind, "pid": pid, **extra})
        if len(self.events) > 40:
            self.events = self.events[-40:]

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
                log.exception("Lỗi hẹn giờ Khoanh Số")
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
        return {"label": "Đang khoanh số", "joinable": False}

    async def on_player_join(self, player):
        self._post_chat("system", f"👋 {player.name} đã vào phòng.")

    async def on_player_removed(self, player):
        self.names[player.id] = player.name
        self._post_chat("system", f"🚪 {player.name} đã rời phòng.")

    async def on_action(self, player, action, data):
        handler = getattr(self, "_act_" + action, None) if action.isidentifier() else None
        if handler is None:
            raise GameError("Hành động không hợp lệ.")
        handler(player.id, data if isinstance(data, dict) else {})

    # ------------------------------------------------------------------ phòng chờ
    def _act_config(self, pid, data):
        self._require_host(pid)
        if self.phase == "play":
            raise GameError("Không thể đổi luật khi đang chơi.")
        for key, allowed in (("size", SIZES), ("limit", LIMITS)):
            if key in data:
                try:
                    v = int(data[key])
                except (TypeError, ValueError):
                    v = None
                if v in allowed:
                    self.config[key] = v
        if data.get("bot_level") in BOT_LEVELS:
            self.config["bot_level"] = data["bot_level"]

    def _start_error(self):
        if len(self.room.players) < self.min_players:
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
            self.colors[p] = PENS[i % len(PENS)]
            self.pen[p] = PEN_NAMES[i % len(PEN_NAMES)]
            self.count[p] = 0
            self.misses[p] = 0
            self.wins.setdefault(p, 0)
        self.size = self.config["size"]
        self.board, cols, rows = make_board(self.size)
        self.grid = (cols, rows)
        self.owner = [None] * self.size
        self.stage = "ready"
        self._post_chat("system", f"⭕ Ván {self.game_no} bắt đầu — khoanh các số từ 1 đến {self.size}!")
        self._add_log(f"⭕ Ván {self.game_no}: tờ giấy có {self.size} số.", "start")
        self._event("ready")
        self._set_timer(READY_TIME, self._begin_play)

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
        self._finish("stop")

    # ------------------------------------------------------------------ chơi
    def _begin_play(self):
        self.stage = "play"
        self.started_at = self.target_at = time.time()
        self._event("go")
        if self.config["limit"]:
            self._set_timer(self.config["limit"], lambda: self._finish("time"))

    def _act_circle(self, pid, data):
        if self.phase != "play" or self.stage != "play" or pid not in self.order:
            raise GameError("Chưa thể khoanh lúc này.")
        try:
            n = int(data.get("n"))
        except (TypeError, ValueError):
            return
        if not 1 <= n <= self.size or self.owner[n - 1] is not None:
            return    # số đã có người khoanh (bấm chậm hơn người khác một chút) → bỏ qua, không phạt
        now = time.time()
        if self.lock_until.get(pid, 0) > now:
            return
        if n != self.target:
            self.lock_until[pid] = now + WRONG_LOCK
            self.misses[pid] += 1
            self._event("miss", pid, n=n)
            return
        self.owner[n - 1] = pid
        self.count[pid] += 1
        self._event("circle", pid, n=n)
        self.target += 1
        self.target_at = now
        if self.target > self.size:
            self._finish("done")

    def _finish(self, reason):
        self._stop_timer()
        self.phase = "end"
        self.stage = None
        self.end_reason = reason
        self.ranking = sorted(self.order, key=lambda p: (-self.count[p], self.misses[p]))
        best = self.count[self.ranking[0]] if self.ranking else 0
        self.winners = [p for p in self.ranking if self.count[p] == best] if best > 0 else []
        for w in self.winners:
            self.wins[w] = self.wins.get(w, 0) + 1
        if not self.winners:
            text = "🤷 Không ai khoanh được số nào!"
        elif len(self.winners) == 1:
            text = f"🏆 {self._name(self.winners[0])} thắng ván {self.game_no} với {best} số!"
        else:
            text = f"🤝 Hoà! {', '.join(self._name(w) for w in self.winners)} cùng khoanh {best} số."
        if reason == "time":
            text = "⏰ Hết giờ! " + text
        self._add_log(text, "end")
        self._post_chat("system", text)
        self._event("win", self.winners[0] if self.winners else None, winners=self.winners)

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
                "pen": self.pen.get(p_id),
                "count": self.count.get(p_id, 0),
                "misses": self.misses.get(p_id, 0),
                "wins": self.wins.get(p_id, 0),
            })
        show_board = self.phase == "end" or (self.phase == "play" and self.stage == "play")
        return {
            "phase": self.phase,
            "stage": self.stage,
            "gameNo": self.game_no,
            "me": {"id": pid, "host": pid == self.room.host_id, "playing": pid in self.order,
                   "lockUntil": self.lock_until.get(pid, 0)},
            "players": players,
            "size": self.size,
            "board": self.board if show_board else None,
            "grid": list(self.grid),
            "owner": self.owner if show_board else None,
            "target": self.target,
            "targetAt": self.target_at,
            "hintAfter": HINT_AFTER,
            "lockTime": WRONG_LOCK,
            "winners": self.winners,
            "ranking": self.ranking,
            "endReason": self.end_reason,
            "deadline": self.deadline,
            "total": self.phase_total,
            "now": time.time(),
            "events": self.events[-20:],
            "config": self.config,
            "choices": {"size": SIZES, "limit": LIMITS, "bot_level": BOT_LEVELS},
            "minPlayers": self.min_players,
            "maxPlayers": self.max_players,
            "startError": self._start_error() if self.phase != "play" else None,
            "chat": self.chat[-150:],
            "log": self.log[-100:],
        }
