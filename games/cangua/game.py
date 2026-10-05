"""Cờ Cá Ngựa — mỗi người 4 ngựa, đổ xúc xắc ra quân, chạy một vòng bàn cờ rồi lên chuồng.

Luật (kiểu phổ biến ở Việt Nam, một số điểm chủ phòng chỉnh được):
  • Đổ 1 xúc xắc. Ra quân khi đổ 1 hoặc 6 (hoặc chỉ 6). Đổ 6 được đổ thêm lượt.
  • Đi đúng vào ô có ngựa đối thủ → đá nó về chuồng. Không được dừng lên ngựa nhà mình.
  • Cản đường: không được nhảy qua đầu bất kỳ con ngựa nào trên đường đi (có thể tắt).
  • Đi hết 58 ô phải dừng đúng ở cửa chuồng, sau đó lên chuồng 6 bậc:
      “nhảy bậc”  — đổ số nào lên bậc đó (phải cao hơn bậc đang đứng, không vượt ngựa nhà trong chuồng);
      “từng bậc”  — muốn lên bậc k phải đổ đúng k, lên lần lượt từng bậc.
  • Ai đưa đủ 4 ngựa lên chuồng trước thì thắng.

Toạ độ ngựa: -1 = trong chuồng xuất phát; 0..58 = số ô đã đi trên đường (0 là ô xuất quân, 58 là cửa
chuồng); 101..106 = bậc 1..6 trên chuồng đích. Đường đi chung có 60 ô, màu c xuất quân ở ô 15c + 1.
"""
import asyncio
import logging
import random
import time

from core.game_base import BaseGame, GameError
from .bots import CaNguaBotMixin

log = logging.getLogger("gamehub.cangua")

TRACK = 60
GATE = 58            # số ô từ ô xuất quân tới cửa chuồng
HOME = 100           # bậc s trên chuồng = HOME + s
STEPS = 6
HORSES = 4
COLORS = [
    {"key": "red", "name": "Đỏ", "hex": "#e84a4f"},
    {"key": "green", "name": "Xanh lá", "hex": "#2fb35f"},
    {"key": "yellow", "name": "Vàng", "hex": "#f2b82b"},
    {"key": "blue", "name": "Xanh dương", "hex": "#3a7df0"},
]
SEATS = {2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3]}
TURN_TIMES = (0, 10, 15, 20, 30, 45)
HORSE_CHOICES = (2, 3, 4)
ROLL_TIME = 1.1                   # khớp với hoạt ảnh tung xúc xắc 3D (~1 giây)
STEP_TIME = 0.16
PASS_TIME = 1.0
OFFLINE_TIME = 5


def start_of(color):
    return 15 * color + 1


def abs_of(color, pos):
    """Ô tuyệt đối trên đường đi chung (0..59) của một ngựa đang ở trên đường."""
    return (start_of(color) + pos) % TRACK


class CaNguaGame(CaNguaBotMixin, BaseGame):
    id = "cangua"
    name = "Cờ Cá Ngựa"
    icon = "🐴"
    description = "Đổ xúc xắc ra quân, đua 4 chú ngựa quanh bàn cờ, đá ngựa đối thủ về chuồng và lên chuồng trước để thắng!"
    min_players = 2
    max_players = 4
    guide = [
        ("🎯 Mục tiêu", "Là người đầu tiên đưa đủ ngựa của mình (mặc định **4 con**) chạy hết một vòng bàn cờ và **lên chuồng** đích (6 bậc ở giữa)."),
        ("🎲 Đến lượt", [
            "Bấm **Đổ xúc xắc**, rồi bấm vào con ngựa muốn đi (những con đi được sẽ sáng lên). Chỉ có một nước đi thì máy tự đi.",
            "Ngựa trong chuồng chỉ **ra quân** được khi đổ **1 hoặc 6** (tuỳ luật phòng: chỉ 6).",
            "Đổ được **6** thì được **đổ thêm** một lần. Không có nước đi nào thì mất lượt.",
        ]),
        ("🐎 Đá ngựa & cản đường", [
            "Đi **đúng vào ô** có ngựa đối thủ → **đá** con đó về chuồng xuất phát.",
            "Không được dừng lên ô có ngựa nhà mình.",
            "**Cản đường**: không được nhảy qua đầu bất kỳ con ngựa nào đang đứng trên đường đi (chủ phòng có thể tắt).",
        ]),
        ("🏠 Lên chuồng", [
            "Đi hết vòng, ngựa phải dừng **đúng ở cửa chuồng** (ô cùng màu trước lối lên chuồng) — đổ dư thì không đi được con đó.",
            "**Nhảy bậc** (mặc định): đổ số nào lên bậc đó, miễn cao hơn bậc đang đứng và không vượt qua ngựa nhà trên chuồng.",
            "**Từng bậc** (luật khó): muốn lên bậc k phải đổ đúng k, lên lần lượt 1 → 2 → … → 6.",
        ]),
        ("⚙️ Tuỳ chọn (chủ phòng)", "Số ngựa mỗi người (2 / 3 / 4 — chọn 2 cho ván nhanh), luật ra quân (1 hoặc 6 / chỉ 6), cách lên chuồng, bật/tắt cản đường, thời gian mỗi lượt (hết giờ máy tự đổ và tự đi nước tốt nhất)."),
        ("💡 Mẹo", "Đừng để ngựa đứng ngay trước mặt đối thủ trong tầm 1–6 ô. Ngựa đứng ở ô xuất quân dễ bị đá khi đối thủ ra quân!"),
    ]

    def __init__(self, room):
        super().__init__(room)
        self.config = {"out": "16", "home": "jump", "block": True, "turn_time": 20, "horses": 4}
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
        self.color = {}
        self.names = {}
        self.horses = {}
        self.cur = 0
        self.stage = None       # roll · rolling · move · moving · pass
        self.dice = None
        self.moves = {}         # ngựa đi được -> vị trí mới (cho người đang đến lượt)
        self.sixes = 0
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

    @property
    def current(self):
        return self.order[self.cur] if self.phase == "play" and self.order else None

    def _cname(self, pid):
        return COLORS[self.color[pid]]["name"]

    def _occupant(self, absq):
        """(pid, số ngựa) đang đứng ở ô tuyệt đối `absq` trên đường đi, hoặc None."""
        for pid in self.order:
            c = self.color[pid]
            for h, pos in enumerate(self.horses[pid]):
                if 0 <= pos <= GATE and abs_of(c, pos) == absq:
                    return pid, h
        return None

    # ------------------------------------------------------------------ luật đi
    def _target(self, pid, h, d):
        """Vị trí mới nếu ngựa `h` đi `d` bước, hoặc None nếu không hợp lệ."""
        c = self.color[pid]
        pos = self.horses[pid][h]
        mine = self.horses[pid]
        if pos == -1:
            if str(d) not in self.config["out"]:
                return None
            occ = self._occupant(abs_of(c, 0))
            if occ and occ[0] == pid:
                return None
            return 0
        if pos >= HOME:
            step = pos - HOME
            if self.config["home"] == "step":
                new = step + 1
                if d != new:
                    return None
            else:
                new = d
                if new <= step:
                    return None
            if any(HOME + s in mine for s in range(step + 1, new + 1)):
                return None
            return HOME + new
        if pos == GATE:
            if self.config["home"] == "step" and d != 1:
                return None
            if any(HOME + s in mine for s in range(1, d + 1)):
                return None
            return HOME + d
        new = pos + d
        if new > GATE:
            return None
        if self.config["block"]:
            for k in range(pos + 1, new):
                if self._occupant(abs_of(c, k)):
                    return None
        occ = self._occupant(abs_of(c, new))
        if occ and occ[0] == pid:
            return None
        return new

    def _legal(self, pid, d):
        out = {}
        for h in range(len(self.horses[pid])):
            t = self._target(pid, h, d)
            if t is not None:
                out[h] = t
        return out

    def _path_ids(self, pid, frm, to):
        """Danh sách ô (mã cho giao diện) mà ngựa đi qua, để vẽ hoạt ảnh từng bước."""
        c = self.color[pid]
        ids = []
        if frm == -1:
            return [f"t{abs_of(c, 0)}"]
        if frm <= GATE:
            end = min(to, GATE)
            ids += [f"t{abs_of(c, k)}" for k in range(frm + 1, end + 1)]
            if to >= HOME:
                ids += [f"h{c}-{s}" for s in range(1, to - HOME + 1)]
        else:
            ids += [f"h{c}-{s}" for s in range(frm - HOME + 1, to - HOME + 1)]
        return ids

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
                log.exception("Lỗi hẹn giờ Cờ Cá Ngựa")
            await self.room.broadcast_state()

    def _stop_timer(self):
        self._token += 1
        self.deadline = self.phase_total = None

    def _decision_timer(self):
        pid = self.current
        if pid is None or self.stage not in ("roll", "move"):
            return
        if not self._connected(pid):
            self._set_timer(OFFLINE_TIME, self._auto)
        elif self.config["turn_time"]:
            self._set_timer(self.config["turn_time"], self._auto)
        else:
            self._stop_timer()

    def _auto(self):
        pid = self.current
        if pid is None:
            return
        if self.stage == "roll":
            self._act_roll(pid, {})
        elif self.stage == "move":
            self._act_move(pid, {"horse": self._best_move(pid)})

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
        return {"label": "Đang đua ngựa", "joinable": False}

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
        if data.get("out") in ("16", "6"):
            self.config["out"] = data["out"]
        if data.get("home") in ("jump", "step"):
            self.config["home"] = data["home"]
        if "block" in data:
            self.config["block"] = bool(data["block"])
        for key, allowed in (("turn_time", TURN_TIMES), ("horses", HORSE_CHOICES)):
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
            return f"Cần ít nhất {self.min_players} người chơi (hiện có {n})."
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
        seats = SEATS[len(self.order)]
        for i, p in enumerate(self.order):
            self.color[p] = seats[i]
            self.names[p] = self._name(p)
            self.horses[p] = [-1] * self.config["horses"]
            self.wins.setdefault(p, 0)
        self._post_chat("system", f"🐴 Ván {self.game_no} bắt đầu! {self._name(self.order[0])} ({self._cname(self.order[0])}) đổ trước.")
        self._add_log(f"🐴 Ván {self.game_no} bắt đầu.", "start")
        self.cur = 0
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
        self.game_no = 0
        self._post_chat("system", "🔁 Quay lại phòng chờ.")

    # ------------------------------------------------------------------ lượt chơi
    def _begin_turn(self, again=False):
        self.stage = "roll"
        self.moves = {}
        if not again:
            self.sixes = 0
        self._event("turn", self.current, again=again)
        self._decision_timer()

    def _next_turn(self):
        self.cur = (self.cur + 1) % len(self.order)
        self._begin_turn()

    def _act_roll(self, pid, data):
        if self.phase != "play" or pid != self.current or self.stage != "roll":
            raise GameError("Chưa đến lượt đổ của bạn.")
        d = random.randint(1, 6)
        self.dice = d
        self.stage = "rolling"
        self._event("roll", pid, dice=d)
        self._set_timer(ROLL_TIME, lambda: self._after_roll(pid, d))

    def _after_roll(self, pid, d):
        self.moves = self._legal(pid, d)
        name = self._name(pid)
        if not self.moves:
            self.stage = "pass"
            self._add_log(f"🎲 {name} đổ {d} — không có nước đi.", "pass")
            self._event("pass", pid, dice=d)
            self._set_timer(PASS_TIME, lambda: self._end_move(pid, d))
            return
        self._add_log(f"🎲 {name} đổ {d}.", "roll")
        self.stage = "move"
        if len(set(self.moves.values())) == 1 or len(self.moves) == 1:
            # chỉ có một nước (hoặc mọi nước như nhau, VD nhiều ngựa trong chuồng cùng ra quân) → tự đi
            h = next(iter(self.moves))
            self._set_timer(0.5, lambda: self._act_move(pid, {"horse": h}))
            return
        self._decision_timer()

    def _act_move(self, pid, data):
        if self.phase != "play" or pid != self.current or self.stage != "move":
            raise GameError("Chưa thể đi lúc này.")
        try:
            h = int(data.get("horse"))
        except (TypeError, ValueError):
            raise GameError("Hãy chọn một con ngựa.")
        if h not in self.moves:
            raise GameError("Con ngựa này không đi được với số vừa đổ.")
        d = self.dice
        c = self.color[pid]
        frm = self.horses[pid][h]
        to = self.moves[h]
        kicked = None
        if to <= GATE:
            occ = self._occupant(abs_of(c, to))
            if occ and occ[0] != pid:
                kicked = {"pid": occ[0], "horse": occ[1]}
        path = self._path_ids(pid, frm, to)
        self.horses[pid][h] = to
        if kicked:
            self.horses[kicked["pid"]][kicked["horse"]] = -1
        self.moves = {}
        self.stage = "moving"
        self._event("move", pid, horse=h, path=path, kicked=kicked, home=to >= HOME)
        name = self._name(pid)
        if frm == -1:
            text = f"🐎 {name} ra quân."
        elif to >= HOME:
            text = f"🏠 {name} đưa ngựa lên bậc {to - HOME} của chuồng."
        else:
            text = f"🐎 {name} đi {d} bước."
        if kicked:
            text += f" 💥 Đá ngựa của {self._name(kicked['pid'])} về chuồng!"
        self._add_log(text, "kick" if kicked else ("home" if to >= HOME else "move"))
        self._set_timer(0.2 + len(path) * STEP_TIME, lambda: self._end_move(pid, d))

    def _end_move(self, pid, d):
        if all(pos >= HOME for pos in self.horses[pid]):
            self._finish(pid)
            return
        if d == 6:
            self.sixes += 1
            self._add_log(f"🎲 {self._name(pid)} đổ được 6 — được đổ thêm!", "roll")
            self._begin_turn(again=True)
            return
        self._next_turn()

    def _progress(self, pid):
        total = 0
        for pos in self.horses[pid]:
            total += 0 if pos == -1 else (GATE + 1 + pos - HOME if pos >= HOME else pos + 1)
        return total

    def _finish(self, pid):
        self._stop_timer()
        self.phase = "end"
        self.stage = None
        self.winner = pid
        self.wins[pid] = self.wins.get(pid, 0) + 1
        self.ranking = sorted(self.order, key=lambda p: (p != pid, -self._progress(p)))
        text = f"🏆 {self._name(pid)} ({self._cname(pid)}) đưa đủ {len(self.horses[pid])} ngựa lên chuồng và thắng ván {self.game_no}!"
        self._add_log(text, "end")
        self._post_chat("system", text)
        self._event("win", pid)

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
            in_game = p_id in self.order
            players.append({
                "id": p_id,
                "name": p.name if p else self.names.get(p_id, "?"),
                "bot": bool(p and p.is_bot),
                "connected": bool(p and p.connected),
                "look": p.look if p else None,
                "host": p_id == self.room.host_id,
                "playing": in_game,
                "color": self.color.get(p_id),
                "horses": self.horses.get(p_id),
                "home": sum(1 for x in self.horses.get(p_id, []) if x >= HOME),
                "wins": self.wins.get(p_id, 0),
            })
        mine = self.phase == "play" and self.current == pid and self.stage == "move"
        return {
            "phase": self.phase,
            "stage": self.stage,
            "gameNo": self.game_no,
            "me": {"id": pid, "host": pid == self.room.host_id, "playing": pid in self.order},
            "players": players,
            "turn": self.current,
            "dice": self.dice,
            "moves": {str(h): t for h, t in self.moves.items()} if mine else None,
            "winner": self.winner,
            "ranking": self.ranking,
            "colors": COLORS,
            "deadline": self.deadline,
            "total": self.phase_total,
            "now": time.time(),
            "events": self.events[-15:],
            "config": self.config,
            "turnTimes": TURN_TIMES,
            "horseChoices": HORSE_CHOICES,
            "minPlayers": self.min_players,
            "maxPlayers": self.max_players,
            "startError": self._start_error() if self.phase != "play" else None,
            "chat": self.chat[-150:],
            "log": self.log[-100:],
        }
