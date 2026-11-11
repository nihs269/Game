"""Đá Bóng — đá 1 chọi 1 nhìn ngang kiểu Head Soccer, người thắng giữ sân.

Luật:
  • Mỗi trận đá theo thời gian (60 / 90 / 120 giây, đồng hồ dừng khi có bàn thắng). Hết giờ mà hoà thì đá
    “bàn thắng vàng”: ai ghi trước thắng. Chủ phòng có thể chọn thêm “ai ghi đủ N bàn trước thắng luôn”.
  • Ghi bàn khi bóng lọt hẳn vào khung thành đối thủ (dưới xà ngang). Sau mỗi bàn thả bóng lại giữa sân.
  • Phòng nhiều người: người thắng giữ sân, người thua xuống cuối hàng chờ.

Cách đồng bộ:
  • Trình duyệt tự mô phỏng người của mình (chạy, nhảy, vung chân — không trễ), ~30 lần/giây gửi vị trí lên.
  • Máy chủ mô phỏng quả bóng 120 lần/giây: trọng lực, nảy sân / tường / xà ngang, va vào đầu và thân hai người
    (theo vị trí mới nhất của họ). Bấm sút thì trình duyệt báo `kick`; trong khoảng vung chân, bóng chạm tầm chân là
    bóng bay đi. Máy chủ phát vị trí bóng + hai người 60 lần/giây; trình duyệt vẽ bóng nội suy giữa các gói tin.
"""
import asyncio
import logging
import math
import random
import time

from core.game_base import BaseGame, GameError
from .bots import BotPlayer
from .physics import KICKS, WORLD, collide, goal_side, kick, kick_reaches, step

log = logging.getLogger("gamehub.dabong")

COLORS = ["#ff6b6b", "#4d8df7"]   # bên trái đỏ, bên phải xanh
TICK = 1 / 60
SUB = 2                # số bước mô phỏng bóng mỗi nhịp
INTRO = 2.4            # màn giới thiệu trước trận
KICKOFF = 1.2          # bóng treo giữa sân trước khi rơi
GOAL_PAUSE = 2.6       # ăn mừng sau bàn thắng
OVER_PAUSE = 3.2       # trận xong → bảng kết quả
KICK_WINDOW = 0.18     # bấm sút: trong khoảng này bóng chạm tầm chân thì bay đi (bù độ trễ mạng)
SLACK = 12             # nới tầm chân khi kiểm tra cú sút của người chơi
DC_FORFEIT = 10.0
GOLDEN_MAX = 60.0      # bàn thắng vàng kéo dài quá lâu thì xử hoà
TIMES = (60, 90, 120)
GOALS = (0, 3, 5)      # 0 = không giới hạn bàn thắng
BOT_LEVELS = ("easy", "normal", "hard")
STATES = {"idle", "run", "jump", "kick"}


def _num(v, default=0.0):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return default
    return default if v != v or v in (math.inf, -math.inf) else v


class DaBongGame(BaseGame):
    id = "dabong"
    name = "Đá Bóng"
    icon = "⚽"
    description = "Đá bóng 1 chọi 1 nhìn ngang: chạy, nhảy đánh đầu, sút căng, lốp bóng qua đầu đối thủ. Thắng thì giữ sân!"
    min_players = 1
    max_players = 8
    supports_bots = True
    guide = [
        ("🎯 Mục tiêu", "Hai người đá **1 chọi 1**, mỗi người giữ một khung thành. Đưa bóng lọt hẳn vào **khung thành đối thủ** "
                       "(dưới xà ngang) để ghi bàn. Hết giờ ai nhiều bàn hơn thắng; hoà thì đá **bàn thắng vàng** — ai ghi "
                       "trước thắng. Phòng đông người: **người thắng giữ sân**, người thua xuống cuối hàng chờ."),
        ("🕹️ Điều khiển", [
            "**Chạy**: A / D (hoặc ← →) · **Nhảy**: W / ↑ / Space — nhảy lên **đánh đầu**!",
            "**Sút căng**: J (hoặc Z) — bóng đi thấp và mạnh.",
            "**Lốp bóng**: K (hoặc X) — bóng vồng cao qua đầu đối thủ.",
            "Bóng chạm vào **đầu và người** cũng bật ra: chạy tới đẩy bóng, nhảy lên chặn bóng.",
            "Điện thoại: dùng các nút trên màn hình (nên xoay ngang).",
        ]),
        ("⚽ Mẹo", [
            "Đứng **sau quả bóng** (về phía khung thành nhà) thì mới sút về phía đối thủ được.",
            "Đối thủ dâng cao thì **lốp bóng** qua đầu; đối thủ đứng sát khung thành thì **sút căng**.",
            "Bóng bổng tới thì nhảy lên đánh đầu cho bóng bật ngược lại.",
        ]),
        ("⚙️ Tuỳ chọn (chủ phòng)", "Thời gian trận (60 / 90 / 120 giây), ghi đủ 3 / 5 bàn là thắng luôn, độ khó của bot. "
                                    "Chơi một mình thì thêm bot làm đối thủ."),
    ]

    def __init__(self, room):
        super().__init__(room)
        self.config = {"time": 90, "goals": 0, "bot_level": "normal"}
        self.chat = []
        self.log = []
        self.events = []
        self._dirty = False
        self._msg_id = 0
        self._seq = 0
        self._token = 0
        self._disposed = False
        self.names = {}
        self.queue = []
        self.stats = {}         # pid -> {"w", "l", "streak", "best", "goals"}
        self.match_no = 0
        self.last = None
        self._reset_match()
        self.phase = "lobby"

    def _reset_match(self):
        self._token += 1
        self.pair = []
        self.p = {}
        self.bots = {}
        self.score = {}
        self.kick_no = 0        # số lần giao bóng (đổi mỗi lần thả bóng — trình duyệt đặt lại vị trí theo đó)
        self.rstate = None      # kickoff | play | goal | over
        self.r_at = 0.0
        self.r_until = 0.0
        self.time_left = 0.0
        self.golden = False
        self.ball = [600.0, 400.0, 0.0, 0.0]
        self.last_kick = None
        self.taker = None
        self.scorer = None
        self.shots = {}
        self.winner = None
        self.loser = None
        self.goal_log = []

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
        self._dirty = True

    def _post_chat(self, channel, text, pid=None):
        self._msg_id += 1
        self.chat.append({"id": self._msg_id, "t": time.time(), "channel": channel, "text": text,
                          "pid": pid, "name": self._name(pid) if pid else None})
        if len(self.chat) > 300:
            self.chat = self.chat[-300:]

    def _require_host(self, pid):
        if pid != self.room.host_id:
            raise GameError("Chỉ chủ phòng mới làm được việc này.")

    def _other(self, pid):
        a, b = self.pair
        return b if pid == a else a

    def _stat(self, pid):
        return self.stats.setdefault(pid, {"w": 0, "l": 0, "streak": 0, "best": 0, "goals": 0})

    def _sync_queue(self):
        self.queue = [p for p in self.queue if p in self.room.players]
        self.queue += [p for p in self.room.players if p not in self.queue]

    def dispose(self):
        self._token += 1
        self._disposed = True

    # ------------------------------------------------------------------ core hooks
    def can_remove(self, pid):
        return self.phase != "play" or pid not in self.pair

    def can_rename(self):
        return self.phase != "play"

    def status(self):
        if self.phase == "lobby":
            return {"label": "Đang chờ", "joinable": True}
        if self.phase == "end":
            return {"label": "Nghỉ giữa trận", "joinable": True}
        return {"label": "Đang đá", "joinable": False}

    async def on_player_join(self, player):
        self._sync_queue()
        self._post_chat("system", f"👋 {player.name} đã vào phòng.")

    async def on_player_connect(self, player):
        st = self.p.get(player.id)
        if st:
            st["dc_at"] = None

    async def on_player_disconnect(self, player):
        st = self.p.get(player.id)
        if self.phase == "play" and st is not None:
            st["dc_at"] = time.time()

    async def on_player_removed(self, player):
        self.names[player.id] = player.name
        self._post_chat("system", f"🚪 {player.name} đã rời phòng.")
        if player.id in self.queue:
            self.queue.remove(player.id)

    async def on_action(self, player, action, data):
        handler = getattr(self, "_act_" + action, None) if action.isidentifier() else None
        if handler is None:
            raise GameError("Hành động không hợp lệ.")
        result = handler(player.id, data)
        if self._dirty:
            self._dirty = False
            return None
        return result

    # ------------------------------------------------------------------ phòng chờ
    def _act_config(self, pid, data):
        self._require_host(pid)
        if self.phase == "play":
            raise GameError("Không thể đổi luật khi đang đá.")
        try:
            if "time" in data and int(data["time"]) in TIMES:
                self.config["time"] = int(data["time"])
            if "goals" in data and int(data["goals"]) in GOALS:
                self.config["goals"] = int(data["goals"])
        except (TypeError, ValueError):
            pass
        if data.get("bot_level") in BOT_LEVELS:
            self.config["bot_level"] = data["bot_level"]

    def _act_start(self, pid, data):
        self._require_host(pid)
        if self.phase == "play":
            raise GameError("Trận đấu đang diễn ra.")
        self._sync_queue()
        if len(self.queue) < 2:
            raise GameError("Cần 2 người để đá — thêm bot nhé!")
        self._reset_match()
        self.match_no += 1
        self.phase = "play"
        self.pair = list(self.queue[:2])
        self.time_left = float(self.config["time"])
        now = time.time()
        for i, p in enumerate(self.pair):
            self.names[p] = self._name(p)
            self.score[p] = 0
            self.shots[p] = 0
            self._stat(p)
            self.p[p] = {"x": 0.0, "y": 0.0, "vx": 0.0, "vy": 0.0, "face": 1 if i == 0 else -1, "s": "idle",
                         "k": "", "e": 0.0, "t": now, "dc_at": None, "kick_until": 0.0, "kind": ""}
            player = self.room.players.get(p)
            if player and player.is_bot:
                self.bots[p] = BotPlayer(self.config["bot_level"], i)
        a, b = self.pair
        self._post_chat("system", f"⚽ Trận {self.match_no}: {self._name(a)} ⚔️ {self._name(b)}!")
        self._add_log(f"⚽ Trận {self.match_no}: {self._name(a)} ⚔️ {self._name(b)}", "start")
        self._kickoff(random.choice(self.pair), INTRO)
        self._token += 1
        asyncio.ensure_future(self._tick_loop(self._token))

    def _act_next_match(self, pid, data):
        self._act_start(pid, data)

    def _act_lobby(self, pid, data):
        self._require_host(pid)
        if self.phase != "end":
            raise GameError("Không thể làm việc này lúc này.")
        self._reset_match()
        self.phase = "lobby"
        self.stats = {}
        self.match_no = 0
        self.last = None
        self._post_chat("system", "🔁 Quay lại phòng chờ.")

    def _act_stop(self, pid, data):
        self._require_host(pid)
        if self.phase != "play":
            raise GameError("Trận đấu chưa bắt đầu.")
        self._end_match(aborted=True)

    # ------------------------------------------------------------------ giao bóng / bàn thắng
    def _kickoff(self, taker, delay=0.0):
        """Giao bóng: bóng đặt giữa sân, người giao đứng ngay sau bóng, đối thủ đứng ở phần sân nhà."""
        now = time.time()
        self.kick_no += 1
        self.taker = taker
        self.rstate = "kickoff"
        self.r_at = now
        self.r_until = now + delay + KICKOFF
        mid = WORLD["W"] / 2
        self.ball = [mid, float(WORLD["R"]), 0.0, 0.0]
        self.last_kick = None
        for i, p in enumerate(self.pair):
            st = self.p[p]
            face = 1 if i == 0 else -1
            x = mid - face * 70 if p == taker else mid - face * 330
            st.update(x=x, y=0.0, vx=0.0, vy=0.0, s="idle", k="", e=0.0, t=now, kick_until=0.0)
            if p in self.bots:
                self.bots[p].reset(st["x"])
        self._event("kickoff", None, n=self.kick_no)

    def _goal(self, side):
        """Bóng lọt khung thành bên `side` → người bên kia ghi bàn."""
        now = time.time()
        scorer = self.pair[1 - side]
        self.score[scorer] += 1
        self.scorer = scorer
        self.rstate, self.r_at, self.r_until = "goal", now, now + GOAL_PAUSE
        sa, sb = (self.score[p] for p in self.pair)
        minute = self.config["time"] - max(0, int(self.time_left))
        self.goal_log.append({"by": scorer, "at": minute, "golden": self.golden})
        self._event("goal", scorer, score=[sa, sb], golden=self.golden)
        self._add_log(f"⚽ {self._name(scorer)} ghi bàn! {sa}–{sb}" + (" — BÀN THẮNG VÀNG!" if self.golden else ""), "goal")
        target = self.config["goals"]
        if self.golden or (target and self.score[scorer] >= target):
            self.winner, self.loser = scorer, self._other(scorer)
            self.r_until = now + OVER_PAUSE
            self.rstate = "over"

    def _draw(self):
        now = time.time()
        self.winner = self.loser = None
        self.rstate, self.r_at, self.r_until = "over", now, now + OVER_PAUSE
        self._event("fulltime", None)
        self._add_log("🤝 Bàn thắng vàng mãi không có — trận đấu hoà.", "goal")

    def _time_up(self):
        now = time.time()
        a, b = self.pair
        if self.score[a] == self.score[b]:
            self.golden = True
            self._event("golden", None)
            self._add_log("⏱ Hết giờ, hoà — đá bàn thắng vàng: ai ghi trước thắng!", "goal")
            return
        self.winner, self.loser = (a, b) if self.score[a] > self.score[b] else (b, a)
        self.rstate, self.r_at, self.r_until = "over", now, now + OVER_PAUSE
        self._event("fulltime", self.winner)

    async def _tick_loop(self, token):
        nxt = time.perf_counter()
        while token == self._token and not self._disposed:
            nxt += TICK
            delay = nxt - time.perf_counter()
            if delay < -0.1:
                nxt = time.perf_counter()
            await asyncio.sleep(max(0.0, delay))
            async with self.room.lock:
                if token != self._token or self._disposed or self.phase != "play":
                    return
                try:
                    self._tick()
                except Exception:
                    log.exception("Lỗi vòng lặp Đá Bóng")
                if self.phase == "play":
                    await self.room.broadcast(self._pitch_msg())
                if self._dirty:
                    self._dirty = False
                    await self.room.broadcast_state()

    def _tick(self):
        now = time.time()
        st = self.rstate
        if st == "kickoff" and now >= self.r_until:
            self.rstate = "play"
            self._event("play", None)
        elif st == "goal" and now >= self.r_until:
            self._kickoff(self._other(self.scorer))
        elif st == "over" and now >= self.r_until:
            self._end_match()
            return
        if self.rstate == "play":
            self.time_left -= TICK
            if self.golden and self.time_left <= -GOLDEN_MAX:
                self._draw()
            elif not self.golden and self.time_left <= 0:
                self._time_up()
        self._step_bots(now)
        if self.rstate in ("play", "goal", "over"):
            self._step_ball(now)
        if self.rstate in ("kickoff", "play"):
            for p in self.pair:
                dc = self.p[p]["dc_at"]
                if dc and now - dc > DC_FORFEIT:
                    self._forfeit(p)
                    break

    def _body(self, pid, now):
        """Vị trí + vận tốc hiện tại của người (người thật: đoán thêm một chút theo vận tốc vì gói tin đến trễ)."""
        st = self.p[pid]
        if pid in self.bots:
            return st["x"], st["y"], st["vx"], st["vy"]
        lag = max(0.0, min(0.06, now - st["t"]))
        x = max(WORLD["PX_MIN"], min(WORLD["PX_MAX"], st["x"] + st["vx"] * lag))
        y = max(0.0, st["y"] + st["vy"] * lag)
        return x, y, st["vx"], st["vy"]

    def _step_ball(self, now):
        b = self.ball
        dt = TICK / SUB
        playing = self.rstate == "play"
        bodies = {p: self._body(p, now) for p in self.pair}
        order = random.sample(self.pair, 2)    # ai chạm bóng trước trong cùng một nhịp: ngẫu nhiên, không thiên vị bên nào
        for _ in range(SUB):
            if step(b, dt):
                self._event("bar", None)
            if not playing:
                continue
            for p in order:
                x, y, vx, vy = bodies[p]
                st = self.p[p]
                if now < st["kick_until"] and kick_reaches(b, x, y, st["face"], slack=0 if p in self.bots else SLACK):
                    kick(b, st["kind"], st["face"], vx, vy)
                    st["kick_until"] = 0.0
                    self.last_kick = p
                    self.shots[p] = self.shots.get(p, 0) + 1
                    self._event("kick", p, shot=st["kind"])
                    break
                collide(b, x, y + WORLD["HEAD_Y"], WORLD["HEAD_R"], vx, vy)
                collide(b, x, y + WORLD["BODY_Y"], WORLD["BODY_R"], vx, vy)
            side = goal_side(b)
            if side is not None:
                self._goal(side)
                playing = False

    def _forfeit(self, pid):
        now = time.time()
        self.winner, self.loser = self._other(pid), pid
        self.rstate, self.r_at, self.r_until = "over", now, now + OVER_PAUSE
        self._event("forfeit", pid)
        self._add_log(f"📴 {self._name(pid)} mất kết nối quá lâu — xử thua.", "goal")

    def _end_match(self, aborted=False):
        self._token += 1
        self.phase = "end"
        a, b = self.pair
        if aborted:
            self.winner = self.loser = None
        w, lo = self.winner, self.loser
        if w:
            sw, sl = self._stat(w), self._stat(lo)
            sw["w"] += 1
            sw["streak"] += 1
            sw["best"] = max(sw["best"], sw["streak"])
            sl["l"] += 1
            sl["streak"] = 0
            self._sync_queue()
            self.queue = [w] + [p for p in self.queue if p not in (w, lo)] + ([lo] if lo in self.room.players else [])
            text = f"🏆 {self._name(w)} thắng {self._name(lo)} {self.score[w]}–{self.score[lo]}!"
            if sw["streak"] >= 2:
                text += f" Giữ sân {sw['streak']} trận liền 🔥"
        else:
            self._sync_queue()
            self.queue = [p for p in self.queue if p not in (a, b)] + [p for p in (a, b) if p in self.room.players]
            text = "🛑 Trận đấu bị dừng." if aborted else f"🤝 Hoà {self.score[a]}–{self.score[b]}."
        for p in (a, b):
            self._stat(p)["goals"] += self.score.get(p, 0)
        self.last = {"no": self.match_no, "a": a, "b": b, "winner": w, "loser": lo, "score": dict(self.score), "aborted": aborted,
                     "shots": dict(self.shots), "goals": self.goal_log}
        self._event("win", w)
        self._add_log(text, "end")
        self._post_chat("system", text)

    def _step_bots(self, now):
        active = self.rstate == "play"
        for pid, bot in self.bots.items():
            opp = self.p[self._other(pid)]
            bot.step(now, TICK, self.ball, (opp["x"], opp["y"]), active)
            st = self.p[pid]
            st.update(x=bot.x, y=bot.y, vx=bot.vx, vy=bot.vy, s=bot.state, k=bot.kind if bot.kick_at else "",
                      e=bot.elapsed, t=now)
            # Mỗi cú vung chân mới của bot mở một khoảng chân chạm bóng (vung trượt thì khoảng này đã qua).
            if bot.kick_at is not None and st.get("kick_at") != bot.kick_at:
                st["kick_at"] = bot.kick_at
                st["kick_until"], st["kind"] = bot.kick_at + WORLD["KICK_TO"], bot.kind

    # ------------------------------------------------------------------ hành động khi đá
    def _playing(self, pid):
        return self.phase == "play" and pid in self.p and pid not in self.bots

    def _act_pos(self, pid, data):
        if not self._playing(pid):
            return False
        if int(_num(data.get("kn"), -1)) != self.kick_no:
            return False
        st = self.p[pid]
        now = time.time()
        ts = _num(data.get("ts"), now)
        ts = max(now - 0.3, min(now, ts))
        if ts <= st["t"]:
            return False
        s = str(data.get("s") or "idle")
        k = str(data.get("k") or "")
        st.update(x=max(WORLD["PX_MIN"], min(WORLD["PX_MAX"], _num(data.get("x"), st["x"]))),
                  y=max(0.0, min(400.0, _num(data.get("y")))),
                  vx=max(-1000.0, min(1000.0, _num(data.get("vx")))), vy=max(-2000.0, min(2000.0, _num(data.get("vy")))),
                  s=s if s in STATES else "idle", k=k if k in KICKS else "", e=max(0.0, min(1.0, _num(data.get("e")))),
                  t=ts, dc_at=None)
        return False

    def _act_boot(self, pid, data):
        """Bấm sút (không đặt tên `kick`: nền tảng đã dùng tên đó cho việc mời người chơi ra khỏi phòng)."""
        if not self._playing(pid) or self.rstate != "play":
            return False
        kind = data.get("kind")
        st = self.p[pid]
        st["kick_until"] = time.time() + KICK_WINDOW
        st["kind"] = kind if kind in KICKS else "shoot"
        return False

    # ------------------------------------------------------------------ chat
    def _act_chat(self, pid, data):
        text = " ".join(str(data.get("text", "")).split())[:300]
        if text:
            self._post_chat("all", text, pid)

    # ------------------------------------------------------------------ trạng thái
    def _pitch_msg(self):
        ps = {}
        for p in self.pair:
            st = self.p[p]
            ps[p] = [round(st["x"], 1), round(st["y"], 1), st["s"], st["k"], round(st["e"], 3), round(st["t"], 3)]
        b = self.ball
        return {"type": "pitch", "g": self.match_no, "kn": self.kick_no, "ts": round(time.time(), 3),
                "b": [round(b[0], 2), round(b[1], 2), round(b[2], 1), round(b[3], 1)],
                "tl": round(self.time_left, 2), "p": ps}

    def view(self, pid):
        queue = [p for p in self.queue if p in self.room.players]
        queue += [p for p in self.room.players if p not in queue]
        order = list(self.pair) + [p for p in queue if p not in self.pair]
        order += [p for p in self.room.players if p not in order]
        players = []
        for p_id in order:
            p = self.room.players.get(p_id)
            if p is None and p_id not in self.pair:
                continue
            st = self.stats.get(p_id, {})
            players.append({
                "id": p_id,
                "name": p.name if p else self.names.get(p_id, "?"),
                "bot": bool(p and p.is_bot),
                "connected": bool(p and p.connected),
                "look": p.look if p else None,
                "host": p_id == self.room.host_id,
                "court": p_id in self.pair,
                "side": self.pair.index(p_id) if p_id in self.pair else None,
                "w": st.get("w", 0), "l": st.get("l", 0), "streak": st.get("streak", 0),
                "best": st.get("best", 0), "goals": st.get("goals", 0),
            })
        spawn = {p: [self.p[p]["x"], self.p[p]["face"]] for p in self.pair} if self.p else {}
        return {
            "phase": self.phase,
            "matchNo": self.match_no,
            "me": {"id": pid, "host": pid == self.room.host_id, "court": pid in self.pair,
                   "side": self.pair.index(pid) if pid in self.pair else None},
            "players": players,
            "pair": self.pair,
            "colors": COLORS,
            "queue": queue,
            "kickNo": self.kick_no,
            "taker": self.taker,
            "rstate": self.rstate,
            "rAt": self.r_at,
            "rUntil": self.r_until,
            "timeLeft": self.time_left,
            "golden": self.golden,
            "spawn": spawn,
            "ball": self.ball,
            "score": self.score,
            "scorer": self.scorer,
            "winner": self.winner,
            "loser": self.loser,
            "last": self.last,
            "now": time.time(),
            "events": self.events[-20:],
            "config": self.config,
            "world": WORLD,
            "kicks": KICKS,
            "timesOpt": TIMES,
            "goalsOpt": GOALS,
            "botLevels": BOT_LEVELS,
            "maxPlayers": self.max_players,
            "chat": self.chat[-150:],
            "log": self.log[-100:],
        }
