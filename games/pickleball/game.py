"""Pickleball — đánh đơn 1 chọi 1 hoặc đánh đôi 2 chọi 2 nhìn ngang, người (đội) thắng giữ sân.

Luật (rút gọn cho nhìn ngang):
  • Giao bóng thấp tay; bóng giao phải nảy ở sân đối thủ, qua khỏi vùng bếp (kitchen).
  • Luật 2 lần nảy: bên đỡ giao bóng phải để bóng nảy rồi mới đánh, bên giao cũng phải để cú trả giao nảy rồi mới
    đánh. Sau đó được đánh vô lê (đánh khi bóng chưa nảy).
  • Không được vô lê khi đang đứng trong bếp (sát lưới). Đánh bóng chạm đất ở bếp thì được.
  • Mất pha bóng khi: bóng nảy hai lần bên mình, đánh bóng ra ngoài, mắc lưới, phạm luật 2 lần nảy / vô lê trong bếp.
  • Tính điểm: kiểu rally (pha nào cũng tính điểm) hoặc kiểu truyền thống (chỉ bên giao bóng được điểm; bên đỡ thắng
    pha bóng thì giành quyền giao — đánh đôi thì mỗi đội có hai lượt giao, riêng lượt đầu ván chỉ một). Chạm 11 / 15
    / 21 điểm, hơn 2 điểm là thắng ván.
  • Phòng nhiều người: người (đội) thắng giữ sân, người (đội) thua xuống cuối hàng chờ.

Cách đồng bộ giống Cầu Lông: trình duyệt tự mô phỏng người của mình và báo `hit`; mỗi cú đánh là một đường bay xác
định (physics.trajectory, có nảy) nên mọi máy tự vẽ bóng giống hệt nhau. Bot do máy chủ mô phỏng hoàn toàn.
"""
import asyncio
import logging
import math
import random
import time

from core.game_base import BaseGame, GameError
from .bots import BotPlayer
from .physics import SHOTS, WORLD, in_kitchen, judge, pos_at, reach_center, shot_kind, solve, trajectory

log = logging.getLogger("gamehub.pickleball")

COLORS = ["#ff6b6b", "#4d8df7"]   # bên trái đỏ, bên phải xanh
TICK = 1 / 60
INTRO = 2.2            # màn giới thiệu trước ván
POINT_PAUSE = 1.6      # nghỉ sau mỗi pha bóng
GAME_PAUSE = 3.0       # nghỉ giữa hai ván
OVER_PAUSE = 3.2       # trận xong → bảng kết quả
GRACE = 0.18           # bóng đã nảy lần hai / ra ngoài rồi vẫn chờ thêm chừng này (cú đánh có thể đang trên đường tới)
AUTO_SERVE = 8.0       # quá lâu không giao bóng thì tự giao
SLACK = 90             # độ lệch vị trí cho phép khi kiểm tra cú đánh (do độ trễ mạng)
DC_FORFEIT = 10.0
POINTS = (11, 15, 21)
GAMES = (1, 3)
MODES = (1, 2)         # số người mỗi đội: đánh đơn / đánh đôi
SCORINGS = ("rally", "sideout")
FRONT, BACK = 230, 420   # đánh đôi: chỗ đứng chờ của người lên sát bếp / người cuối sân (khoảng cách tới lưới)
BOT_LEVELS = ("easy", "normal", "hard")
STATES = {"idle", "run", "jump", "swing"}
KINDS = ("drive", "lob", "dink")
REASONS = {"in": "Bóng nảy hai lần", "out": "Bóng ra ngoài", "net": "Bóng mắc lưới", "short": "Bóng không qua lưới",
           "kitchen": "Giao bóng rơi vào bếp", "volley": "Vô lê trong bếp", "bounce": "Chưa để bóng nảy (luật 2 lần nảy)",
           "forfeit": "Bỏ cuộc"}


def _num(v, default=0.0):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return default
    return default if v != v or v in (math.inf, -math.inf) else v


class PickleballGame(BaseGame):
    id = "pickleball"
    name = "Pickleball"
    icon = "🏓"
    description = "Đánh đơn hoặc đánh đôi: để bóng nảy, bỏ nhỏ vào bếp, lốp bóng qua đầu và đập bóng. Thắng thì giữ sân!"
    min_players = 1
    max_players = 8
    supports_bots = True
    guide = [
        ("🎯 Mục tiêu", "Đánh **đơn 1 chọi 1** hoặc **đôi 2 chọi 2**. Đánh bóng sang sân đối thủ sao cho họ không đỡ được. "
                       "Bóng được **nảy một lần** bên mình rồi mới phải đánh. Thua pha bóng khi bóng **nảy hai lần** bên "
                       "mình, khi mình đánh bóng **ra ngoài** hoặc **mắc lưới**. Phòng đông người: **người (đội) thắng giữ "
                       "sân**, người (đội) thua xuống cuối hàng chờ."),
        ("🕹️ Điều khiển", [
            "**Chạy**: A / D (hoặc ← →) · **Nhảy**: W / ↑ / Space",
            "**Đánh mạnh** (bóng đi thẳng, nhanh): J (hoặc Z) — bóng **trên cao** thì thành cú **đập**",
            "**Lốp bóng** (bổng qua đầu đối thủ, rơi cuối sân): K (hoặc X)",
            "**Bỏ nhỏ** (dink — nhẹ, rơi vào bếp đối thủ): L (hoặc C)",
            "Giữ phím **tiến** khi đánh để bóng đi **sâu** hơn, giữ phím **lùi** để bóng đi **ngắn** hơn.",
            "Điện thoại: dùng các nút trên màn hình (nên xoay ngang).",
        ]),
        ("🥒 Luật riêng của pickleball", [
            "**Bếp** (kitchen) là vùng tô màu sát lưới. **Không được vô lê** (đánh bóng chưa nảy) khi đang đứng trong bếp. "
            "Bóng đã nảy thì vào bếp đánh thoải mái.",
            "**Luật 2 lần nảy**: bóng giao phải nảy rồi mới được đánh, cú trả giao cũng phải nảy rồi mới được đánh. "
            "Từ cú thứ ba trở đi mới được vô lê.",
            "Giao bóng thấp tay, bóng phải nảy **qua khỏi bếp** bên đối thủ.",
        ]),
        ("👥 Đánh đôi", "Hai người một đội chung một nửa sân, mỗi đội chỉ được **chạm bóng một lần** rồi phải đưa sang "
                       "bên kia. Nên chia nhau một người lên sát bếp, một người ở cuối sân."),
        ("🎾 Giao bóng", "Người giao bấm **J** (giao sâu) hoặc **L** (giao ngắn). Không giao trong 8 giây thì tự giao."),
        ("🧮 Tính điểm", "**Rally**: pha bóng nào cũng tính điểm. **Truyền thống**: chỉ bên giao bóng được điểm; bên đỡ "
                        "thắng pha bóng thì giành quyền giao. Đánh đôi kiểu truyền thống mỗi đội có hai lượt giao (hai "
                        "người), riêng lượt đầu ván chỉ một — bảng điểm ghi thêm người giao thứ mấy."),
        ("⚙️ Tuỳ chọn (chủ phòng)", "Đánh đơn hay đánh đôi, cách tính điểm, số điểm mỗi ván, đánh 1 ván hay thắng 2 "
                                    "trong 3 ván, độ khó của bot. Thiếu người thì thêm bot làm đối thủ / đồng đội."),
    ]

    def __init__(self, room):
        super().__init__(room)
        self.config = {"mode": 1, "scoring": "rally", "points": 11, "games": 1, "bot_level": "normal"}
        self.chat = []
        self.log = []
        self.events = []
        self._out = []
        self._dirty = False
        self._msg_id = 0
        self._seq = 0
        self._token = 0
        self._disposed = False
        self._bcast = 0
        self.names = {}
        self.queue = []
        self.stats = {}         # pid -> {"w", "l", "streak", "best", "smash"}
        self.match_no = 0
        self.last = None
        self._reset_match()
        self.phase = "lobby"

    def _reset_match(self):
        self._token += 1
        self.pair = []          # mọi người trên sân
        self.teams = [[], []]   # đội bên trái, đội bên phải
        self.p = {}
        self.bots = {}
        self.score = [0, 0]     # theo bên sân
        self.games_won = [0, 0]
        self.serve_idx = [0, 0]   # đánh đôi: người giao bóng tiếp theo của mỗi đội
        self.server_no = 1      # tính điểm truyền thống, đánh đôi: lượt giao thứ 1 hay 2 của đội đang giao
        self.next_srv = None
        self.set_no = 0
        self.pt_no = 0          # số thứ tự pha bóng (đổi mỗi lần bắt đầu pha mới — trình duyệt đặt lại vị trí theo đó)
        self.rstate = None      # intro | serve | rally | point | game | over
        self.r_at = 0.0
        self.r_until = 0.0
        self.server = None
        self.shot = None
        self.point_winner = None   # bên sân thắng pha bóng (0 / 1)
        self.point_reason = None
        self.scored = False     # pha bóng vừa rồi có được tính điểm không (kiểu truyền thống: bên đỡ thắng thì không)
        self.land = None
        self.rally = 0
        self.longest = 0
        self.smashes = {}
        self.winner = None      # bên sân thắng / thua trận
        self.loser = None
        self.set_scores = []

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

    def _side(self, pid):
        return 0 if pid in self.teams[0] else 1

    def _team_name(self, side):
        return " & ".join(self._name(p) for p in self.teams[side])

    def _stat(self, pid):
        return self.stats.setdefault(pid, {"w": 0, "l": 0, "streak": 0, "best": 0, "smash": 0})

    def _sync_queue(self):
        self.queue = [p for p in self.queue if p in self.room.players]
        self.queue += [p for p in self.room.players if p not in self.queue]

    def dispose(self):
        self._token += 1
        self._disposed = True

    async def _flush(self):
        out, self._out = self._out, []
        for m in out:
            await self.room.broadcast(m)

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
        return {"label": "Đang đánh", "joinable": False}

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
        await self._flush()
        if self._dirty:
            self._dirty = False
            return None
        return result

    # ------------------------------------------------------------------ phòng chờ
    def _act_config(self, pid, data):
        self._require_host(pid)
        if self.phase == "play":
            raise GameError("Không thể đổi luật khi đang đánh.")
        try:
            if "mode" in data and int(data["mode"]) in MODES:
                self.config["mode"] = int(data["mode"])
            if "points" in data and int(data["points"]) in POINTS:
                self.config["points"] = int(data["points"])
            if "games" in data and int(data["games"]) in GAMES:
                self.config["games"] = int(data["games"])
        except (TypeError, ValueError):
            pass
        if data.get("scoring") in SCORINGS:
            self.config["scoring"] = data["scoring"]
        if data.get("bot_level") in BOT_LEVELS:
            self.config["bot_level"] = data["bot_level"]

    def _act_start(self, pid, data):
        self._require_host(pid)
        if self.phase == "play":
            raise GameError("Trận đấu đang diễn ra.")
        self._sync_queue()
        n = self.config["mode"]
        if len(self.queue) < 2 * n:
            raise GameError("Cần 4 người để đánh đôi — thêm bot nhé!" if n == 2 else "Cần 2 người để đánh — thêm bot nhé!")
        self._reset_match()
        self.match_no += 1
        self.phase = "play"
        self.pair = list(self.queue[:2 * n])
        self.teams = [self.pair[:n], self.pair[n:]]
        now = time.time()
        for p in self.pair:
            i = self._side(p)
            self.names[p] = self._name(p)
            self.smashes[p] = 0
            self._stat(p)
            self.p[p] = {"x": 0.0, "y": 0.0, "face": 1 if i == 0 else -1, "s": "idle", "k": "", "e": 0.0,
                         "t": now, "dc_at": None}
            player = self.room.players.get(p)
            if player and player.is_bot:
                self.bots[p] = BotPlayer(self.config["bot_level"], i)
        vs = f"{self._team_name(0)} ⚔️ {self._team_name(1)}"
        self._post_chat("system", f"🏓 Trận {self.match_no}: {vs}!")
        self._add_log(f"🏓 Trận {self.match_no}: {vs}", "start")
        first = random.choice(self.pair)
        self.serve_idx[self._side(first)] = self.teams[self._side(first)].index(first)
        self._start_set(first)
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

    # ------------------------------------------------------------------ ván / pha bóng
    def _sideout(self):
        return self.config["scoring"] == "sideout"

    def _start_set(self, server):
        self.set_no += 1
        self.score = [0, 0]
        # Truyền thống, đánh đôi: lượt giao đầu ván chỉ có một người giao (“0–0–2”).
        self.server_no = 2
        self._event("set", None, n=self.set_no)
        self._start_point(server, INTRO)

    def _home(self, pid, server):
        """Chỗ đứng đầu mỗi pha: người giao / đỡ giao đứng cuối sân (luật 2 lần nảy), đồng đội đứng gần bếp."""
        side = self._side(pid)
        team = self.teams[side]
        if len(team) == 1 or pid == team[self.serve_idx[side]]:
            dist = 440 + (20 if pid == server else 0)
        else:
            dist = FRONT + 20
        return WORLD["NET_X"] + (-1 if side == 0 else 1) * dist

    def _next_server(self, win):
        """Ai giao pha bóng tiếp theo, sau khi bên `win` thắng pha bóng."""
        srv_side = self._side(self.server)
        team = self.teams[win]
        if win == srv_side:
            return self.server
        if self._sideout():
            other = self.teams[srv_side]
            if len(other) > 1 and self.server_no == 1:
                # Người giao thứ nhất mất pha bóng: đồng đội giao tiếp.
                self.server_no = 2
                self.serve_idx[srv_side] = 1 - other.index(self.server)
                return other[self.serve_idx[srv_side]]
            self.server_no = 1
        # Đổi quyền giao sang bên kia; đánh đôi thì đổi người giao đầu tiên trong đội.
        self.serve_idx[win] = (self.serve_idx[win] + 1) % len(team)
        return team[self.serve_idx[win]]

    def _start_point(self, server, delay=0.0):
        now = time.time()
        self.pt_no += 1
        self.server = server
        self.shot = None
        self.land = None
        self.rally = 0
        self.point_winner = self.point_reason = None
        self.scored = False
        self.rstate = "serve"
        self.r_at = now + delay
        self.r_until = self.r_at + AUTO_SERVE
        for p in self.pair:
            st = self.p[p]
            st.update(x=float(self._home(p, server)), y=0.0, s="idle", k="", e=0.0, t=now)
            if p in self.bots:
                self.bots[p].reset(st["x"])
        self._event("serve", server, pt=self.pt_no)

    def _target(self):
        return self.config["points"]

    def _set_won(self, side):
        """Đủ điểm thắng ván chưa: chạm mốc và hơn 2 điểm, hoặc chạm mốc tối đa (mốc + 4… 21 thì 30)."""
        n = self._target()
        cap = 30 if n == 21 else n + 4
        me, op = self.score[side], self.score[1 - side]
        return (me >= n and me - op >= 2) or me >= cap

    def _award(self, winner, reason, land=None):
        """winner = bên sân thắng pha bóng."""
        now = time.time()
        loser = 1 - winner
        srv_side = self._side(self.server)
        self.scored = not self._sideout() or winner == srv_side
        if self.scored:
            self.score[winner] += 1
        self.next_srv = self._next_server(winner)
        self.point_winner, self.point_reason = winner, reason
        self.land = land
        self.longest = max(self.longest, self.rally)
        self.shot = None
        self.r_at = now
        sa, sb = self.score
        self._event("point", None, side=winner, reason=reason, rally=self.rally, score=[sa, sb], scored=self.scored)
        if self.scored and self._set_won(winner):
            self.games_won[winner] += 1
            self.set_scores.append([sa, sb])
            need = self.config["games"] // 2 + 1
            self._add_log(f"🏁 {self._team_name(winner)} thắng ván {self.set_no}: {sa}–{sb}.", "set")
            if self.games_won[winner] >= need:
                self.winner, self.loser = winner, loser
                self.rstate, self.r_until = "over", now + OVER_PAUSE
            else:
                self.rstate, self.r_until = "game", now + GAME_PAUSE
            self._event("setwin", None, side=winner, n=self.set_no)
        else:
            self.rstate, self.r_until = "point", now + POINT_PAUSE
            if self.rally >= 12:
                self._add_log(f"🔥 Pha bóng {self.rally} chạm — {self._team_name(winner)} thắng ({sa}–{sb}).", "rally")

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
                    log.exception("Lỗi vòng lặp Pickleball")
                await self._flush()
                if self.phase == "play":
                    self._bcast += 1
                    if self._bcast % 2 == 0:
                        await self.room.broadcast(self._court_msg())
                if self._dirty:
                    self._dirty = False
                    await self.room.broadcast_state()

    def _tick(self):
        now = time.time()
        st = self.rstate
        if st == "serve" and now >= self.r_until:
            self._serve(self.server, "drive", 0)
        elif st == "rally" and self.shot and now >= self.shot["end_t"] + GRACE:
            self._resolve()
        elif st == "point" and now >= self.r_until:
            self._start_point(self.next_srv)
        elif st == "game" and now >= self.r_until:
            self._start_set(self.next_srv)
        elif st == "over" and now >= self.r_until:
            self._end_match()
            return
        self._step_bots(now)
        if self.rstate in ("serve", "rally"):
            for p in self.pair:
                dc = self.p[p]["dc_at"]
                if dc and now - dc > DC_FORFEIT:
                    self._forfeit(p)
                    break

    def _resolve(self):
        """Không ai đánh trả kịp: bóng tốt thì người đánh thắng, bóng hỏng thì người đánh thua."""
        shot = self.shot
        side = shot["by_side"]
        reason = shot["verdict"] or "in"
        winner = side if reason == "in" else 1 - side
        b1 = shot["b1"]
        land = shot["pts"][b1][0] if b1 is not None else shot["pts"][-1][0]
        self._award(winner, reason, round(land, 1))

    def _forfeit(self, pid):
        now = time.time()
        self.loser = self._side(pid)
        self.winner = 1 - self.loser
        self.point_winner, self.point_reason = self.winner, "forfeit"
        self.shot = None
        self.rstate, self.r_at, self.r_until = "over", now, now + OVER_PAUSE
        self._event("forfeit", pid)
        self._add_log(f"📴 {self._name(pid)} mất kết nối quá lâu — xử thua.", "set")

    def _end_match(self, aborted=False):
        self._token += 1
        self.phase = "end"
        self.shot = None
        if aborted:
            self.winner = self.loser = None
        w, lo = self.winner, self.loser
        self._sync_queue()
        if w is not None:
            for p in self.teams[w]:
                sw = self._stat(p)
                sw["w"] += 1
                sw["streak"] += 1
                sw["best"] = max(sw["best"], sw["streak"])
            for p in self.teams[lo]:
                sl = self._stat(p)
                sl["l"] += 1
                sl["streak"] = 0
            here = self.room.players
            self.queue = ([p for p in self.teams[w] if p in here] + [p for p in self.queue if p not in self.pair]
                          + [p for p in self.teams[lo] if p in here])
            sets = ", ".join(f"{x}–{y}" if w == 0 else f"{y}–{x}" for x, y in self.set_scores)
            text = f"🏆 {self._team_name(w)} thắng {self._team_name(lo)}" + (f" ({sets})!" if sets else "!")
            streak = min(self._stat(p)["streak"] for p in self.teams[w])
            if streak >= 2:
                text += f" Giữ sân {streak} trận liền 🔥"
        else:
            self.queue = [p for p in self.queue if p not in self.pair] + [p for p in self.pair if p in self.room.players]
            text = "🛑 Trận đấu bị dừng."
        for p in self.pair:
            self._stat(p)["smash"] += self.smashes.get(p, 0)
        self.last = {"no": self.match_no, "teams": [list(t) for t in self.teams], "winner": w, "loser": lo,
                     "sets": self.set_scores, "games": list(self.games_won), "smashes": dict(self.smashes),
                     "longest": self.longest}
        self._event("win", None, side=w)
        self._add_log(text, "end")
        self._post_chat("system", text)

    # ------------------------------------------------------------------ cú đánh
    def _launch(self, pid, kind, cx, cy, t0, aim, serve=False):
        side = self._side(pid)
        real = shot_kind(kind, cy, serve)
        # Làm tròn điểm xuất phát trước: trình duyệt nhận đúng các số này và tính ra đường bay y hệt máy chủ.
        cx, cy = round(cx, 3), round(cy, 3)
        vx, vy = solve(real, side, cx, cy, aim)
        pts, net, b1 = trajectory(cx, cy, vx, vy)
        n = (self.shot["n"] + 1) if self.shot else 1
        verdict = judge(pts, net, b1, side, serve)
        dt = WORLD["DT"]
        # Bóng hỏng thì pha bóng xong ngay khi bóng chạm sân; bóng tốt thì đối thủ đỡ được tới lần nảy thứ hai.
        end_i = b1 if verdict and b1 is not None else len(pts) - 1
        self.shot = {"n": n, "x": cx, "y": cy, "vx": vx, "vy": vy, "t0": t0, "by": pid, "by_side": side,
                     "kind": real, "pts": pts, "net": net, "b1": b1, "verdict": verdict,
                     "t1": t0 + b1 * dt if b1 is not None else math.inf, "end_t": t0 + end_i * dt}
        self.rally += 1
        if real == "smash":
            self.smashes[pid] = self.smashes.get(pid, 0) + 1
        self._out.append({"type": "shot", "g": self.match_no, "shot": self._shot_public()})

    def _shot_public(self):
        s = self.shot
        if not s:
            return None
        return {"n": s["n"], "x": s["x"], "y": s["y"], "vx": s["vx"], "vy": s["vy"], "t0": s["t0"], "by": s["by"],
                "side": s["by_side"], "kind": s["kind"], "pt": self.pt_no}

    def _serve(self, pid, kind, aim):
        st = self.p[pid]
        now = time.time()
        cx = st["x"] + st["face"] * 26
        self.rstate = "rally"
        self._launch(pid, kind, cx, WORLD["SERVE_Y"], now, aim, serve=True)
        self._event("served", pid)

    def _hit_fault(self, t, x):
        """Lỗi nếu chạm bóng lúc t khi đứng ở x: "bounce" (luật 2 lần nảy), "volley" (vô lê trong bếp) hoặc None."""
        shot = self.shot
        if t >= shot["t1"]:
            return None
        if shot["n"] <= 2:
            return "bounce"
        if in_kitchen(x):
            return "volley"
        return None

    def _try_hit(self, pid, kind, t, x, y, aim, sx, sy):
        """Vợt đã chạm bóng: phạm luật thì mất pha bóng, không thì đánh đi."""
        fault = self._hit_fault(t, x)
        if fault:
            self._award(1 - self._side(pid), fault)
            self._event("fault", pid, reason=fault)
            return
        self._launch(pid, kind, sx, sy, t, aim)

    def _coach(self, now):
        """Đánh đôi: bot chọn chỗ đứng chờ theo đồng đội và hai người cùng đội không tranh nhau một quả bóng."""
        shot = self.shot if self.rstate == "rally" else None
        for side, team in enumerate(self.teams):
            mine = [p for p in team if p in self.bots]
            if not mine:
                continue
            a, b = team
            d = {p: abs(self.p[p]["x"] - WORLD["NET_X"]) for p in team}
            for p in mine:
                mate = b if p == a else a
                if mate in self.bots:
                    front = (d[p], team.index(p)) < (d[mate], team.index(mate))   # ai gần lưới hơn thì lên trên
                else:
                    front = d[mate] > (FRONT + BACK) / 2                         # đứng bù chỗ người thật bỏ trống
                self.bots[p].home = WORLD["NET_X"] + (-1 if side == 0 else 1) * (FRONT if front else BACK)
            if shot is None or shot["by_side"] == side or now >= shot["end_t"]:
                continue
            fresh = [p for p in mine if self.bots[p].decided != shot["n"]]
            if not fresh:
                continue
            for p in mine:
                self.bots[p].ensure_plan(shot, now)
                self.bots[p].decided = shot["n"]

            def cost(p):
                plan = self.bots[p].plan
                return abs(plan[2] - self.p[p]["x"]) if plan[1] is not None else math.inf

            if len(mine) == 2:
                keep = min(mine, key=cost)
                other = b if keep == a else a
                if cost(other) < math.inf:
                    self.bots[other].plan = (shot["n"], None)
            else:
                p = mine[0]
                plan = self.bots[p].plan
                mate = b if p == a else a
                # Người thật đứng gần chỗ đón bóng hơn hẳn thì nhường.
                if plan[1] is not None and abs(plan[2] - self.p[mate]["x"]) + 30 < abs(plan[2] - self.p[p]["x"]):
                    self.bots[p].plan = (shot["n"], None)

    def _step_bots(self, now):
        if len(self.teams[0]) > 1:
            self._coach(now)
        for pid, bot in self.bots.items():
            shot = self.shot if self.rstate == "rally" else None
            serving = self.rstate == "serve" and pid == self.server
            swinging = bot.step(now, TICK, shot, serving)
            st = self.p[pid]
            st.update(x=bot.x, y=bot.y, s=bot.state, k=bot.kind if bot.swing_at else "", e=bot.elapsed, t=now)
            if serving and now >= self.r_at + 1.1:
                bot.swing_at, bot.kind = now, "drive"
                self._serve(pid, random.choices(["drive", "dink"], weights=[3, 2])[0], random.choice((-1, 0, 1)))
                continue
            if swinging and shot is not None and shot["by_side"] != bot.side and now < shot["end_t"]:
                if shot["verdict"] and now >= shot["t1"]:
                    continue
                sx, sy = pos_at(shot["pts"], now - shot["t0"])
                if (self._on_side(pid, sx) and self._reaches(bot.x, bot.y, st["face"], sx, sy)
                        and not self._hit_fault(now, bot.x)):
                    self._try_hit(pid, bot.kind, now, bot.x, bot.y, random.choice((-1, 0, 0, 1)), sx, sy)
                    bot.swing_at = None

    def _on_side(self, pid, sx):
        side = self._side(pid)
        return sx <= WORLD["NET_X"] + 12 if side == 0 else sx >= WORLD["NET_X"] - 12

    @staticmethod
    def _reaches(x, y, face, sx, sy, slack=0.0):
        cx, cy = reach_center(x, y, face)
        return (sx - cx) ** 2 + (sy - cy) ** 2 <= (WORLD["REACH_R"] + slack) ** 2

    # ------------------------------------------------------------------ hành động khi đánh
    def _playing(self, pid):
        return self.phase == "play" and pid in self.p and pid not in self.bots

    def _act_pos(self, pid, data):
        if not self._playing(pid):
            return False
        if int(_num(data.get("pt"), -1)) != self.pt_no:
            return False
        st = self.p[pid]
        now = time.time()
        ts = _num(data.get("ts"), now)
        ts = max(now - 0.3, min(now, ts))
        if ts <= st["t"]:
            return False
        side = self._side(pid)
        m, pw = WORLD["MARGIN"], WORLD["PW"]
        lo, hi = (pw, WORLD["NET_X"] - m - pw) if side == 0 else (WORLD["NET_X"] + m + pw, WORLD["W"] - pw)
        s = str(data.get("s") or "idle")
        k = str(data.get("k") or "")
        st.update(x=max(lo, min(hi, _num(data.get("x"), st["x"]))), y=max(0.0, min(300.0, _num(data.get("y")))),
                  s=s if s in STATES else "idle", k=k if k in KINDS else "", e=max(0.0, min(1.0, _num(data.get("e")))),
                  t=ts, dc_at=None)
        return False

    def _act_serve(self, pid, data):
        if not self._playing(pid) or self.rstate != "serve" or pid != self.server or time.time() < self.r_at:
            return False
        kind = data.get("kind")
        self._serve(pid, kind if kind in KINDS else "drive", max(-1, min(1, int(_num(data.get("aim"))))))
        return False

    def _act_hit(self, pid, data):
        if not self._playing(pid) or self.rstate != "rally" or not self.shot:
            return False
        shot = self.shot
        if int(_num(data.get("n"), -1)) != shot["n"] or shot["by_side"] == self._side(pid):
            return False
        kind = data.get("kind")
        if kind not in KINDS:
            return False
        now = time.time()
        t = _num(data.get("t"), now)
        t = max(shot["t0"] + 0.04, now - 0.35, min(now + 0.05, t))
        if t > shot["end_t"] or (shot["verdict"] and t >= shot["t1"]):
            return False      # bóng đã nảy hai lần / đã chạm đất ngoài sân trước lúc vợt chạm
        sx, sy = pos_at(shot["pts"], t - shot["t0"])
        if not self._on_side(pid, sx):
            return False
        st = self.p[pid]
        x, y = _num(data.get("x"), st["x"]), _num(data.get("y"), st["y"])
        if abs(x - st["x"]) > SLACK or abs(y - st["y"]) > SLACK:
            x, y = st["x"], st["y"]
        if not self._reaches(x, y, st["face"], sx, sy, slack=24):
            return False
        aim = max(-1, min(1, int(_num(data.get("aim")))))
        self._try_hit(pid, kind, t, x, y, aim, sx, sy)
        return False

    # ------------------------------------------------------------------ chat
    def _act_chat(self, pid, data):
        text = " ".join(str(data.get("text", "")).split())[:300]
        if text:
            self._post_chat("all", text, pid)

    # ------------------------------------------------------------------ trạng thái
    def _court_msg(self):
        ps = {}
        for p in self.pair:
            st = self.p[p]
            ps[p] = [round(st["x"], 1), round(st["y"], 1), st["s"], st["k"], round(st["e"], 3), round(st["t"], 3)]
        return {"type": "court", "g": self.match_no, "pt": self.pt_no, "ts": round(time.time(), 3), "p": ps}

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
                "side": self._side(p_id) if p_id in self.pair else None,
                "queue": queue.index(p_id) if p_id in queue else None,
                "w": st.get("w", 0), "l": st.get("l", 0), "streak": st.get("streak", 0),
                "best": st.get("best", 0), "smash": st.get("smash", 0),
            })
        spawn = {p: [self.p[p]["x"], self.p[p]["face"]] for p in self.pair} if self.p else {}
        return {
            "phase": self.phase,
            "matchNo": self.match_no,
            "me": {"id": pid, "host": pid == self.room.host_id, "court": pid in self.pair,
                   "side": self._side(pid) if pid in self.pair else None},
            "players": players,
            "pair": self.pair,
            "teams": self.teams,
            "colors": COLORS,
            "queue": queue,
            "setNo": self.set_no,
            "ptNo": self.pt_no,
            "rstate": self.rstate,
            "rAt": self.r_at,
            "rUntil": self.r_until,
            "server": self.server,
            "serverNo": self.server_no,
            "spawn": spawn,
            "shot": self._shot_public(),
            "score": self.score,
            "gamesWon": self.games_won,
            "setScores": self.set_scores,
            "pointWinner": self.point_winner,
            "pointReason": self.point_reason,
            "scored": self.scored,
            "land": self.land,
            "rally": self.rally,
            "winner": self.winner,
            "loser": self.loser,
            "last": self.last,
            "now": time.time(),
            "events": self.events[-20:],
            "config": self.config,
            "world": WORLD,
            "shots": SHOTS,
            "reasons": REASONS,
            "modesOpt": MODES,
            "scoringOpt": SCORINGS,
            "pointsOpt": POINTS,
            "gamesOpt": GAMES,
            "botLevels": BOT_LEVELS,
            "maxPlayers": self.max_players,
            "chat": self.chat[-150:],
            "log": self.log[-100:],
        }
