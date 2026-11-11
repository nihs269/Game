"""Flappy Đại Chiến — mọi người cùng bay qua một dãy ống, ai sống sót lâu nhất thì thắng (chế độ Sinh tồn + Vật phẩm).

Cách đồng bộ:
  • Máy chủ chọn đường bay (dãy ống + hộp vật phẩm) và mốc bắt đầu; camera trôi theo thời gian nên mọi người gặp
    cùng một ống vào cùng một lúc.
  • Trình duyệt tự mô phỏng con chim của mình (mượt, không trễ), ~15 lần/giây gửi vị trí lên; máy chủ gom vị trí của
    mọi người (kể cả bot do máy chủ mô phỏng) rồi phát lại 15 lần/giây. Chim đâm ống thì trình duyệt báo “chết”.
  • Hộp vật phẩm: ai chạm trước thì được (máy chủ phân xử). Mỗi người giữ tối đa 1 vật phẩm, bấm E / nút để dùng.
  • Người đã rơi (và người xem) được ném 🍅 cà chua vào người còn bay để làm bẩn màn hình của họ.
"""
import asyncio
import logging
import random
import time

from core.game_base import BaseGame, GameError
from .bots import BotBird
from .world import COURSE_LEN, WORLD, box_x, dist, make_course, passed

log = logging.getLogger("gamehub.flappy")

COLORS = ["#ffd23f", "#ff6b6b", "#4d8df7", "#3cc47c", "#b07cff", "#ff8fc7", "#2fd0d0", "#ff9f43"]
# loại: (biểu tượng, tên, đối tượng, thời gian hiệu lực, mô tả)
ITEMS = {
    "fog": ("🌫️", "Sương mù", "one", 4.5, "Màn hình một đối thủ tối mịt, chỉ thấy quanh con chim."),
    "flip": ("🔄", "Đảo ngược", "one", 3.5, "Trọng lực của một đối thủ bị lộn ngược: bấm thì lao xuống!"),
    "heavy": ("🪨", "Tạ nặng", "one", 4.5, "Một đối thủ bị đeo tạ, rơi nhanh hơn hẳn."),
    "narrow": ("🧱", "Ống hẹp", "one", 5.0, "Khe ống của một đối thủ hẹp lại."),
    "zap": ("⚡", "Sét đánh", "all", 0.6, "Sét đánh MỌI đối thủ, hất họ chúi xuống."),
    "shield": ("🛡️", "Khiên", "self", 15.0, "Bản thân được đỡ một lần va chạm (trong 15 giây)."),
}
ITEM_WEIGHTS = {"fog": 20, "flip": 14, "heavy": 18, "narrow": 18, "zap": 10, "shield": 20}
SPLAT = ("🍅", "Cà chua", 3.0)
TOMATO_COOLDOWN = 6.0
COUNTDOWN = 3.5
END_DELAY = 1.6
TICK = 1 / 15
BOT_LEVELS = ("easy", "normal", "hard")


def _course_time():
    """Thời điểm con chim bay hết đường (gần như không ai tới được) — ván tự kết thúc."""
    target = WORLD["FIRST"] + COURSE_LEN * WORLD["SPACING"] - WORLD["BIRD_X"]
    lo, hi = 0.0, 3600.0
    for _ in range(40):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if dist(mid) < target else (lo, mid)
    return hi


COURSE_TIME = _course_time()


class FlappyGame(BaseGame):
    id = "flappy"
    name = "Flappy Đại Chiến"
    icon = "🐦"
    description = "Cả phòng cùng bay qua một dãy ống: nhặt vật phẩm phá nhau (sương mù, đảo trọng lực, sét…), ai trụ lâu nhất thắng!"
    min_players = 1
    max_players = 8
    supports_bots = True
    guide = [
        ("🎯 Mục tiêu", "Mọi người cùng bay qua **một dãy ống giống nhau**. Đâm ống hoặc rơi xuống đất là bị loại — "
                       "**người sống sót cuối cùng** thắng. Càng về sau ống càng hẹp, bay càng nhanh."),
        ("🕹️ Điều khiển", [
            "**Vỗ cánh**: bấm chuột / chạm màn hình / phím **Space**, **↑** hoặc **W**.",
            "**Dùng vật phẩm**: phím **E** (hoặc **Shift**) / nút vật phẩm ở góc màn hình.",
        ]),
        ("🎁 Vật phẩm", [
            "Hộp **?** nằm giữa các ống — bay chạm vào để nhặt (ai chạm trước được). Mỗi người giữ **tối đa 1** vật phẩm.",
            *[f"{v[0]} **{v[1]}** — {v[4]}" for v in ITEMS.values()],
            "Vật phẩm đánh **một** đối thủ sẽ trúng ngẫu nhiên một người còn đang bay.",
        ]),
        ("🍅 Đã rơi rồi?", "Đừng buồn — bấm vào một người còn bay (trên màn hình hoặc danh sách) để **ném cà chua** "
                          "làm bẩn màn hình của họ (6 giây một quả)."),
        ("⚙️ Tuỳ chọn (chủ phòng)", "Bật/tắt vật phẩm, bật/tắt cà chua, độ khó của bot. Chơi một mình để luyện cũng được!"),
    ]

    def __init__(self, room):
        super().__init__(room)
        self.config = {"items": True, "tomato": True, "bot_level": "normal"}
        self.chat = []
        self.log = []
        self.events = []
        self._msg_id = 0
        self._seq = 0
        self._eff_id = 0
        self._token = 0
        self._disposed = False
        self.wins = {}
        self.best = {}
        self.game_no = 0
        self._reset_game()
        self.phase = "lobby"

    def _reset_game(self):
        self._token += 1
        self.order = []
        self.names = {}
        self.colors = {}
        self.seed = 0
        self.pipes = []
        self.boxes = {}
        self.taken = set()
        self.start_at = None
        self.end_at = None
        self.alive = set()
        self.death = {}           # pid -> thời điểm rơi (giây kể từ lúc xuất phát)
        self.score = {}           # pid -> số ống bay qua
        self.pos = {}             # pid -> [t, y, vy] mới nhất
        self.held = {}            # pid -> vật phẩm đang giữ
        self.effects = []
        self.bots = {}
        self.tomato_at = {}
        self.hits_given = {}
        self.winner = None
        self.ranking = []

    # ------------------------------------------------------------------ tiện ích
    def _name(self, pid):
        p = self.room.players.get(pid)
        return p.name if p else self.names.get(pid, "?")

    def _now_t(self):
        return time.time() - self.start_at if self.start_at else 0.0

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
        return {"label": "Đang bay", "joinable": False}

    async def on_player_join(self, player):
        self._post_chat("system", f"👋 {player.name} đã vào phòng.")

    async def on_player_connect(self, player):
        if self.pipes:
            await self.room.send(player, self._course_msg())

    async def on_player_disconnect(self, player):
        if self.phase == "play" and player.id in self.alive:
            self._kill(player.id, max(0.0, self._now_t()), "📴")

    async def on_player_removed(self, player):
        self.names[player.id] = player.name
        self._post_chat("system", f"🚪 {player.name} đã rời phòng.")

    async def on_action(self, player, action, data):
        handler = getattr(self, "_act_" + action, None) if action.isidentifier() else None
        if handler is None:
            raise GameError("Hành động không hợp lệ.")
        result = handler(player.id, data)
        if action in ("start", "next_round"):
            await self.room.broadcast(self._course_msg())
        return result

    def _course_msg(self):
        return {"type": "course", "g": self.game_no, "pipes": self.pipes,
                "boxes": [[i, y] for i, y in self.boxes.items()]}

    # ------------------------------------------------------------------ phòng chờ
    def _act_config(self, pid, data):
        self._require_host(pid)
        if self.phase == "play":
            raise GameError("Không thể đổi luật khi đang chơi.")
        for key in ("items", "tomato"):
            if isinstance(data.get(key), bool):
                self.config[key] = data[key]
        if data.get("bot_level") in BOT_LEVELS:
            self.config["bot_level"] = data["bot_level"]

    def _act_start(self, pid, data):
        self._require_host(pid)
        if self.phase == "play":
            raise GameError("Ván đang diễn ra.")
        if len(self.room.players) < self.min_players:
            raise GameError("Chưa có ai để chơi.")
        self._reset_game()
        self.game_no += 1
        self.phase = "play"
        self.order = self.participants()
        self.seed = random.getrandbits(31)
        self.pipes, self.boxes = make_course(self.seed)
        if not self.config["items"]:
            self.boxes = {}
        self.start_at = time.time() + COUNTDOWN
        for i, p in enumerate(self.order):
            self.names[p] = self._name(p)
            self.colors[p] = COLORS[i % len(COLORS)]
            self.alive.add(p)
            self.score[p] = 0
            self.hits_given[p] = 0
            self.pos[p] = [0.0, WORLD["GROUND"] / 2, 0.0]
            self.wins.setdefault(p, 0)
            player = self.room.players.get(p)
            if player and player.is_bot:
                self.bots[p] = BotBird(self.config["bot_level"])
        self._post_chat("system", f"🐦 Ván {self.game_no} — {len(self.order)} chú chim cất cánh!")
        self._add_log(f"🐦 Ván {self.game_no} bắt đầu với {len(self.order)} người.", "start")
        self._event("start", None)
        self._token += 1
        asyncio.ensure_future(self._tick_loop(self._token))

    def _act_next_round(self, pid, data):
        self._act_start(pid, data)

    def _act_lobby(self, pid, data):
        self._require_host(pid)
        if self.phase != "end":
            raise GameError("Không thể làm việc này lúc này.")
        self._reset_game()
        self.phase = "lobby"
        self.wins = {}
        self.best = {}
        self.game_no = 0
        self._post_chat("system", "🔁 Quay lại phòng chờ.")

    def _act_stop(self, pid, data):
        self._require_host(pid)
        if self.phase != "play":
            raise GameError("Ván chưa bắt đầu.")
        self._finish()

    # ------------------------------------------------------------------ vòng lặp ván chơi
    async def _tick_loop(self, token):
        while token == self._token and not self._disposed:
            await asyncio.sleep(TICK)
            async with self.room.lock:
                if token != self._token or self._disposed or self.phase != "play":
                    return
                try:
                    changed = self._tick()
                except Exception:
                    log.exception("Lỗi vòng lặp Flappy")
                    changed = False
                birds = {p: [round(v[0], 3), round(v[1], 1), round(v[2])] for p, v in self.pos.items() if p in self.alive}
                await self.room.broadcast({"type": "birds", "g": self.game_no, "t": round(self._now_t(), 3), "b": birds})
                if changed:
                    await self.room.broadcast_state()

    def _tick(self):
        t = self._now_t()
        changed = False
        if self.end_at and time.time() >= self.end_at:
            self._finish()
            return True
        if t > COURSE_TIME:
            self._finish()
            return True
        for pid, bot in list(self.bots.items()):
            if pid not in self.alive:
                continue
            if t <= 0:
                self.pos[pid] = [t, bot.y, 0.0]
                continue
            if bot.t == 0:
                bot.vy = WORLD["FLAP"]
            dead = bot.step(self.pipes, t, lambda kind, at, consume=False, _p=pid: self._active(_p, kind, at, consume))
            self.pos[pid] = [bot.t, bot.y, bot.vy]
            if dead:
                self._kill(pid, bot.t)
                changed = True
                continue
            # Nhặt hộp vật phẩm khi bay qua; dùng sau vài giây.
            if pid not in self.held:
                n = passed(t)
                for i in (n - 1, n):
                    if i in self.boxes and i not in self.taken and bot.touches_box(t, i, self.boxes[i]):
                        self._grant(pid, i)
                        bot.use_at = t + random.uniform(0.8, 4.0)
                        changed = True
                        break
            elif bot.use_at is not None and t >= bot.use_at:
                bot.use_at = None
                try:
                    self._use(pid)
                    changed = True
                except GameError:
                    bot.use_at = t + 1.5
        return changed

    def _active(self, pid, kind, at, consume=False):
        for e in self.effects:
            if e["pid"] == pid and e["kind"] == kind and e["at"] <= at < e["until"]:
                if consume:
                    e["until"] = at
                    self._event("shield", pid)
                return True
        return False

    def _kill(self, pid, t, icon="💥"):
        if pid not in self.alive:
            return
        now_t = self._now_t()
        t = max(0.0, min(float(t), now_t + 0.5))
        self.alive.discard(pid)
        self.death[pid] = t
        self.score[pid] = passed(t)
        self.held.pop(pid, None)
        left = len(self.alive)
        self._event("die", pid, score=self.score[pid])
        self._add_log(f"{icon} {self._name(pid)} rơi sau {self.score[pid]} ống — còn {left} chú chim.", "die")
        multi = len(self.order) > 1
        if not self.end_at and ((multi and left <= 1) or left == 0):
            self.end_at = time.time() + END_DELAY

    def _finish(self):
        self._token += 1
        t = self._now_t()
        for pid in self.order:
            if pid in self.alive:
                self.score[pid] = passed(t)
        self.phase = "end"
        self.end_at = None
        self.ranking = sorted(self.order, key=lambda p: (p not in self.alive, -self.death.get(p, t), -self.score.get(p, 0)))
        for pid in self.order:
            self.best[pid] = max(self.best.get(pid, 0), self.score.get(pid, 0))
        if len(self.order) > 1 and self.ranking:
            self.winner = self.ranking[0]
            self.wins[self.winner] = self.wins.get(self.winner, 0) + 1
            text = f"🏆 {self._name(self.winner)} trụ lại cuối cùng — {self.score.get(self.winner, 0)} ống!"
            self._event("win", self.winner)
        else:
            self.winner = None
            pid = self.order[0] if self.order else None
            text = f"🏁 {self._name(pid)} bay được {self.score.get(pid, 0)} ống." if pid else "🏁 Ván kết thúc."
            self._event("win", None)
        self._add_log(text, "end")
        self._post_chat("system", text)

    # ------------------------------------------------------------------ hành động khi bay
    def _flying(self, pid):
        return self.phase == "play" and pid in self.alive

    def _act_pos(self, pid, data):
        if not self._flying(pid) or pid in self.bots:
            return False
        try:
            t, y, vy = float(data.get("t")), float(data.get("y")), float(data.get("vy"))
        except (TypeError, ValueError):
            return False
        if t != t or y != y or vy != vy:  # NaN
            return False
        self.pos[pid] = [min(t, self._now_t() + 0.5), max(-100.0, min(700.0, y)), max(-2000.0, min(2000.0, vy))]
        return False

    def _act_die(self, pid, data):
        if not self._flying(pid) or pid in self.bots:
            return False
        try:
            t = float(data.get("t"))
        except (TypeError, ValueError):
            t = self._now_t()
        self._kill(pid, t if t == t else self._now_t())

    def _grant(self, pid, i):
        self.taken.add(i)
        kind = random.choices(list(ITEM_WEIGHTS), weights=list(ITEM_WEIGHTS.values()))[0]
        self.held[pid] = kind
        self._event("pick", pid, item=kind, box=i)

    def _act_claim(self, pid, data):
        if not self._flying(pid) or pid in self.bots:
            return False
        try:
            i = int(data.get("i"))
        except (TypeError, ValueError):
            return False
        if i not in self.boxes or i in self.taken or pid in self.held:
            return False
        # Chống gian: lúc này camera phải đang ở gần hộp.
        if abs(dist(self._now_t()) + WORLD["BIRD_X"] - box_x(i)) > 160:
            return False
        self._grant(pid, i)

    def _use(self, pid):
        kind = self.held.get(pid)
        if not kind:
            raise GameError("Bạn chưa có vật phẩm.")
        icon, name, target, dur, _ = ITEMS[kind]
        others = [p for p in self.alive if p != pid]
        if target == "self":
            victims = [pid]
        elif not others:
            raise GameError("Không còn đối thủ nào để dùng vật phẩm này.")
        elif target == "all":
            victims = others
        else:
            victims = [random.choice(others)]
        t = max(0.0, self._now_t())
        for v in victims:
            if kind != "shield":
                self.effects = [e for e in self.effects if not (e["pid"] == v and e["kind"] == kind)]
            self._eff_id += 1
            self.effects.append({"id": self._eff_id, "pid": v, "kind": kind, "at": round(t, 3),
                                 "until": round(t + dur, 3), "from": pid})
        del self.held[pid]
        if target != "self":
            self.hits_given[pid] = self.hits_given.get(pid, 0) + len(victims)
        self._event("use", pid, item=kind, victims=victims)
        if target == "self":
            self._add_log(f"{icon} {self._name(pid)} bật {name}.", "item")
        else:
            whom = "tất cả đối thủ" if target == "all" else self._name(victims[0])
            self._add_log(f"{icon} {self._name(pid)} dùng {name} lên {whom}!", "item")

    def _act_use(self, pid, data):
        if not self._flying(pid):
            raise GameError("Bạn không còn bay.")
        self._use(pid)

    def _act_shield_pop(self, pid, data):
        if not self._flying(pid) or pid in self.bots:
            return False
        if not self._active(pid, "shield", max(0.0, self._now_t()) + 0.3, consume=True):
            return False

    def _act_tomato(self, pid, data):
        if self.phase != "play" or not self.config["tomato"]:
            raise GameError("Không ném cà chua được lúc này.")
        if pid in self.alive:
            raise GameError("Đang bay thì lo mà bay đi! 😄")
        target = str(data.get("target", ""))
        if target not in self.alive:
            raise GameError("Người này không còn bay.")
        now = time.time()
        wait = self.tomato_at.get(pid, 0) + TOMATO_COOLDOWN - now
        if wait > 0:
            raise GameError(f"Chờ {wait:.0f} giây nữa mới ném tiếp được.")
        self.tomato_at[pid] = now
        t = max(0.0, self._now_t())
        self._eff_id += 1
        self.effects.append({"id": self._eff_id, "pid": target, "kind": "splat", "at": round(t, 3),
                             "until": round(t + SPLAT[2], 3), "from": pid})
        self._event("tomato", pid, target=target)

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
        t = self._now_t()
        live = passed(t) if self.phase == "play" and t > 0 else 0
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
                "alive": p_id in self.alive,
                "color": self.colors.get(p_id),
                "score": live if p_id in self.alive else self.score.get(p_id, 0),
                "deathT": self.death.get(p_id),
                "held": self.held.get(p_id),
                "hits": self.hits_given.get(p_id, 0),
                "best": self.best.get(p_id, 0),
                "wins": self.wins.get(p_id, 0),
            })
        effects = [e for e in self.effects if e["until"] > t - 1] if self.phase == "play" else []
        return {
            "phase": self.phase,
            "gameNo": self.game_no,
            "me": {"id": pid, "host": pid == self.room.host_id, "playing": pid in self.order,
                   "alive": pid in self.alive, "held": self.held.get(pid),
                   "tomatoReady": self.tomato_at.get(pid, 0) + TOMATO_COOLDOWN},
            "players": players,
            "startAt": self.start_at,
            "ending": bool(self.end_at),
            "taken": sorted(self.taken),
            "effects": effects,
            "winner": self.winner,
            "ranking": self.ranking,
            "now": time.time(),
            "events": self.events[-20:],
            "config": self.config,
            "world": WORLD,
            "items": {k: {"icon": v[0], "name": v[1], "target": v[2], "dur": v[3], "desc": v[4]} for k, v in ITEMS.items()},
            "botLevels": BOT_LEVELS,
            "maxPlayers": self.max_players,
            "chat": self.chat[-150:],
            "log": self.log[-100:],
        }
