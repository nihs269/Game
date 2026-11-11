"""Võ Đài Sinh Tử — đối kháng 1 chọi 1 kiểu Mortal Kombat, võ sĩ mang ngoại hình nhân vật của người chơi.

Luật:
  • Mỗi trận 2 võ sĩ đấu nhiều hiệp (thắng 1/2/3 hiệp là thắng trận). Mỗi hiệp 100 máu; hết giờ thì ai còn nhiều máu
    hơn thắng hiệp (bằng nhau là hoà, đánh lại).
  • Hiệp quyết định thắng bằng K.O. → “KẾT LIỄU ĐI!”: đối thủ đứng choáng, người thắng có vài giây lại gần bấm F để
    tung đòn kết liễu: móc hàm hất lên trời, gọi sét đánh thành tro hoặc thiêu rụi.
  • Phòng nhiều người: người thắng giữ võ đài, người thua xuống cuối hàng chờ; ai không đấu thì xem.
  • Mỗi người chọn một võ sĩ trong dàn Mortal Kombat 4 (moves.CHARS) — mỗi võ sĩ có 3 tuyệt chiêu riêng.

Cách đồng bộ (giống Flappy):
  • Trình duyệt tự mô phỏng võ sĩ của mình (đi, nhảy, ra đòn — không trễ), ~30 lần/giây gửi trạng thái lên.
  • Đòn tay chân: trình duyệt người đánh thấy trúng thì báo `hit`; máy chủ kiểm tra (khoảng cách, nhịp ra đòn, đối thủ
    có đang đỡ / đang nằm không), trừ máu rồi phát tin `hit` cho mọi người — người bị đánh tự văng / choáng theo.
  • Chưởng (cầu lửa, móc câu) do máy chủ mô phỏng và phân xử va chạm. Bot do máy chủ mô phỏng hoàn toàn.
  • Máy chủ phát vị trí + máu của 2 võ sĩ và các chưởng đang bay 30 lần/giây.
"""
import asyncio
import logging
import random
import sys
import time

from core.game_base import BaseGame, GameError
from .bots import BotFighter
from .moves import CHAR_IDS, CHARS, FATALITIES, MOVES, WORLD, height, reaches

log = logging.getLogger("gamehub.vodai")

COLORS = ["#ff5a5f", "#4d8df7"]   # võ sĩ bên trái đỏ, bên phải xanh
TICK = 1 / 60          # nhịp mô phỏng + phát vị trí

# Windows mặc định làm tròn bộ hẹn giờ theo bước ~15,6 ms: sleep(1/30) thành ~47 ms (chỉ ~21 lần/giây) khiến đối thủ
# trên màn hình đi giật. Xin độ phân giải 1 ms cho cả tiến trình máy chủ.
if sys.platform == "win32":
    try:
        import ctypes
        ctypes.windll.winmm.timeBeginPeriod(1)
    except Exception:  # noqa: BLE001
        pass
INTRO = WORLD["INTRO"]   # "ROUND n" … "FIGHT!"
VS_TIME = WORLD["VS"]    # màn hình VS trước hiệp 1
KO_PAUSE = 3.2         # nghỉ sau K.O. / hết giờ trước hiệp sau
FINISH_TIME = 6.0      # thời gian được bấm kết liễu
FATALITY_TIME = 4.2    # diễn đòn kết liễu
OVER_PAUSE = 3.0       # trận đã phân thắng bại (không kết liễu) → bảng kết quả
SLACK = 70             # độ lệch vị trí cho phép khi kiểm tra đòn của người chơi (do độ trễ mạng)
FATAL_RANGE = 300
DC_FORFEIT = 10.0      # võ sĩ mất kết nối quá lâu thì xử thua
MAX_ROUNDS = 9
ROUND_TIMES = (45, 60, 90)
ROUND_WINS = (1, 2, 3)
BOT_LEVELS = ("easy", "normal", "hard")
DUMMY = "dummy"        # mã của đối thủ tập (không phải người trong phòng)
DUMMY_MODES = ("stand", "crouch", "block", "jump", "cpu")   # đứng yên / ngồi / luôn đỡ / nhảy liên tục / đánh trả
REGEN_AFTER = 1.5      # luyện tập: không bị đánh quá lâu này thì hồi đầy máu
STATES = {"idle", "walk", "crouch", "block", "cblock", "jump", "atk", "hurt", "fall", "down", "rise", "dizzy", "ko"}


def _sign(v):
    return 1 if v >= 0 else -1


class VoDaiGame(BaseGame):
    id = "vodai"
    name = "Võ Đài Sinh Tử"
    icon = "🐉"
    description = "Đối kháng 1 chọi 1 kiểu Mortal Kombat 4: chọn Scorpion, Sub-Zero, Raiden… đấm, đá, tung tuyệt chiêu và FATALITY kết liễu đối thủ. Thắng thì giữ võ đài!"
    min_players = 1
    max_players = 8
    supports_bots = True
    guide = [
        ("🎯 Mục tiêu", "Hai võ sĩ đấu **1 chọi 1**, đánh cạn máu đối thủ (K.O.) để thắng hiệp. Thắng đủ số hiệp là thắng trận. "
                       "Hết giờ thì ai còn **nhiều máu hơn** thắng hiệp. Phòng đông người: **người thắng giữ võ đài**, "
                       "người thua xuống cuối hàng chờ, những người khác ngồi xem và cổ vũ."),
        ("🕹️ Điều khiển", [
            "**Đi**: A / D (hoặc ← →) · **Nhảy**: W / ↑ · **Ngồi**: S / ↓",
            "**Đấm**: J (hoặc Z) · **Đá**: K (hoặc X) · **Đỡ**: giữ L (hoặc C) — đỡ được cả khi ngồi.",
            "Ngồi + Đấm = **Móc hàm** (hất tung đối thủ) · Ngồi + Đá = **Quét chân** · Lùi + Đá = **Roundhouse** (đá xoay hạ gục) · Trên không: đấm / **đá bay**.",
            "Đứng sát đối thủ + tiến + Đấm = **Quật** — không đỡ được! Đá cao bay qua đầu người đang ngồi.",
            "Điện thoại: dùng các nút trên màn hình (nên xoay ngang).",
        ]),
        ("🐉 Chọn võ sĩ", "Ở phòng chờ (và giữa các trận) mỗi người chọn một võ sĩ trong dàn **Mortal Kombat 4**: "
                         + ", ".join(c["name"] for c in CHARS) + ". Mỗi võ sĩ có ngoại hình và **3 tuyệt chiêu riêng**."),
        ("🔥 Tuyệt chiêu", [
            "Ô 1: **↓ → + Đấm** (hoặc phím U) — thường là chưởng. Chưởng bay ngang đầu: **ngồi xuống là né được!**",
            "Ô 2: **← → + Đấm** (hoặc phím I) · Ô 3: **→ → + Đá** (hoặc phím O).",
            "Các loại: 🪝 móc câu kéo đối thủ lại và làm choáng · ❄️ cầu băng đóng băng đối thủ · 🌀 dịch chuyển ra sau lưng · "
            "lao tới (phi cước, đá xe đạp, trượt chân, húc vai).",
            "Tuyệt chiêu có thời gian hồi. Chưởng bị đỡ vẫn mất một chút máu.",
        ]),
        ("💀 Kết liễu", "Hiệp quyết định thắng bằng K.O. thì đối thủ đứng choáng và màn hình hiện **KẾT LIỄU ĐI!** — "
                       "lại gần rồi bấm **F** (hoặc nút 💀) trong vài giây để tung đòn kết liễu (móc hàm lên trời, sét đánh, thiêu rụi). "
                       "Chủ phòng có thể tắt kết liễu."),
        ("🥋 Luyện tập", "Chủ phòng bấm **Vào luyện tập** để tập một mình với đối thủ tập: chọn võ sĩ cho nó và cho nó "
                        "**đứng yên / ngồi / luôn đỡ / nhảy liên tục / đánh trả**. Máu vô hạn, không giới hạn giờ, có "
                        "**danh sách chiêu**, thống kê combo và nút **💀 Thử kết liễu**. Không tính thắng thua."),
        ("⚙️ Tuỳ chọn (chủ phòng)", "Số hiệp cần thắng (1/2/3), thời gian mỗi hiệp, bật/tắt kết liễu, độ khó của bot. "
                                    "Chơi một mình thì thêm bot để luyện."),
    ]

    def __init__(self, room):
        super().__init__(room)
        self.config = {"rounds": 2, "time": 60, "fatality": True, "bot_level": "normal"}
        self.chat = []
        self.log = []
        self.events = []
        self._out = []          # tin nhắn nhẹ (hit…) chờ phát
        self._dirty = False     # có thay đổi cần gửi lại toàn bộ trạng thái
        self._msg_id = 0
        self._seq = 0
        self._token = 0
        self._disposed = False
        self.names = {}
        self.queue = []         # thứ tự lên võ đài: 2 người đầu là cặp đấu (người giữ đài đứng đầu)
        self.stats = {}         # pid -> {"w", "l", "streak", "best", "fat"}
        self.chars = {}         # pid -> id võ sĩ đã chọn (giữ qua các trận)
        self.match_no = 0
        self.last = None        # kết quả trận vừa xong
        self.dummy = {"mode": "stand", "char": None}   # cấu hình đối thủ tập (char None = ngẫu nhiên)
        self.real_no = 0        # số trận thật (không tính các lần luyện tập)
        self._reset_match()
        self.phase = "lobby"

    def _reset_match(self):
        self._token += 1
        self.practice = False
        self.fighters = []
        self.f = {}
        self.bots = {}
        self.round = 0
        self.rstate = None      # intro | fight | ko | finish | fatality | over
        self.r_at = 0.0
        self.r_until = 0.0
        self.fight_at = 0.0
        self.round_end = 0.0
        self.round_wins = {}
        self.round_winner = None
        self.round_reason = None
        self.perfect = False
        self.winner = None
        self.loser = None
        self.fatality = None
        self.projs = []
        self._proj_id = 0
        self.hits = {}
        self.stage = 0

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
        a, b = self.fighters
        return b if pid == a else a

    def _stat(self, pid):
        return self.stats.setdefault(pid, {"w": 0, "l": 0, "streak": 0, "best": 0, "fat": 0})

    def _sync_queue(self):
        """Hàng chờ = người còn trong phòng theo thứ tự cũ, người mới vào xếp cuối."""
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
        return self.phase != "play" or pid not in self.fighters

    def can_rename(self):
        return self.phase != "play"

    def status(self):
        if self.phase == "lobby":
            return {"label": "Đang chờ", "joinable": True}
        if self.phase == "end":
            return {"label": "Nghỉ giữa trận", "joinable": True}
        return {"label": "Luyện tập" if self.practice else "Đang đấu", "joinable": False}

    async def on_player_join(self, player):
        if player.id not in self.chars:
            used = set(self.chars.values())
            free = [c["id"] for c in CHARS if c["id"] not in used] or [c["id"] for c in CHARS]
            self.chars[player.id] = random.choice(free)
        self._sync_queue()
        self._post_chat("system", f"👋 {player.name} đã vào phòng.")

    async def on_player_connect(self, player):
        f = self.f.get(player.id)
        if f:
            f["dc_at"] = None

    async def on_player_disconnect(self, player):
        f = self.f.get(player.id)
        if self.phase == "play" and f is not None:
            f["dc_at"] = time.time()

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
            raise GameError("Không thể đổi luật khi đang đấu.")
        try:
            if "rounds" in data and int(data["rounds"]) in ROUND_WINS:
                self.config["rounds"] = int(data["rounds"])
            if "time" in data and int(data["time"]) in ROUND_TIMES:
                self.config["time"] = int(data["time"])
        except (TypeError, ValueError):
            pass
        if isinstance(data.get("fatality"), bool):
            self.config["fatality"] = data["fatality"]
        if data.get("bot_level") in BOT_LEVELS:
            self.config["bot_level"] = data["bot_level"]

    def _act_pick_char(self, pid, data):
        cid = data.get("id")
        if cid not in CHAR_IDS:
            raise GameError("Võ sĩ không hợp lệ.")
        if self.phase == "play" and pid in self.fighters:
            raise GameError("Đang đấu thì không đổi võ sĩ được.")
        self.chars[pid] = cid

    def _char(self, pid):
        return CHAR_IDS.get(self.chars.get(pid)) or CHARS[0]

    def _act_start(self, pid, data):
        self._require_host(pid)
        if self.phase == "play":
            raise GameError("Trận đấu đang diễn ra.")
        self._sync_queue()
        if len(self.queue) < 2:
            raise GameError("Cần ít nhất 2 người để đấu — thêm bot nhé!")
        self._reset_match()
        self.match_no += 1
        self.real_no += 1
        self._setup(self.queue[:2])
        for p in self.fighters:
            self._stat(p)
        a, b = self.fighters
        vs = f"{self._char(a)['name']} ({self._name(a)}) ⚔️ {self._char(b)['name']} ({self._name(b)})"
        self._post_chat("system", f"🥋 Trận {self.real_no}: {vs}!")
        self._add_log(f"🥋 Trận {self.real_no}: {vs}", "start")
        self._start_round(1)
        self._token += 1
        asyncio.ensure_future(self._tick_loop(self._token))

    def _setup(self, fighters):
        self.phase = "play"
        self.fighters = list(fighters)
        self.stage = random.randrange(4)
        for i, p in enumerate(self.fighters):
            self.names[p] = self._name(p)
            self.round_wins[p] = 0
            self.hits[p] = 0
            self.f[p] = {"x": float(WORLD["START"][i]), "y": 0.0, "vx": 0.0, "vy": 0.0, "face": 1 if i == 0 else -1,
                         "s": "idle", "m": "", "e": 0.0, "b": False, "t": time.time(), "hp": WORLD["HP"],
                         "last_n": 0, "last_hit_at": 0.0, "stun_until": 0.0, "inv_until": 0.0, "combo": 0,
                         "cd": {}, "dc_at": None, "hurt_at": 0.0}
            player = self.room.players.get(p)
            if p == DUMMY or (player and player.is_bot):
                self.bots[p] = BotFighter(self.config["bot_level"], self._char(p)["moves"])

    # ------------------------------------------------------------------ luyện tập
    def _act_practice(self, pid, data):
        """Chủ phòng vào luyện tập một mình với đối thủ tập (không tính thắng thua, không đổi hàng chờ)."""
        self._require_host(pid)
        if self.phase == "play":
            raise GameError("Trận đấu đang diễn ra.")
        self._act_dummy(pid, data)
        self._reset_match()
        self.practice = True
        self.match_no += 1
        self.names[DUMMY] = "Đối thủ tập"
        self.chars[DUMMY] = self.dummy["char"] or random.choice(CHARS)["id"]
        self._setup([pid, DUMMY])
        self._post_chat("system", f"🥋 {self._name(pid)} vào luyện tập ({self._char(pid)['name']} vs {self._char(DUMMY)['name']}).")
        self._start_round(1)
        self._token += 1
        asyncio.ensure_future(self._tick_loop(self._token))

    def _act_dummy(self, pid, data):
        """Đổi hành vi / võ sĩ của đối thủ tập (người đang tập đổi được ngay trong lúc tập)."""
        if self.phase == "play" and self.practice:
            if pid != self.fighters[0]:
                raise GameError("Chỉ người đang tập mới đổi được đối thủ tập.")
        else:
            self._require_host(pid)
        if data.get("mode") in DUMMY_MODES:
            self.dummy["mode"] = data["mode"]
        if "char" in data:
            cid = data.get("char")
            self.dummy["char"] = cid if cid in CHAR_IDS else None
            if self.practice and self.phase == "play":
                self.chars[DUMMY] = self.dummy["char"] or random.choice(CHARS)["id"]
                bot = BotFighter(self.config["bot_level"], self._char(DUMMY)["moves"])
                bot.reset(self.f[DUMMY]["x"], self.f[DUMMY]["face"], time.time())
                self.bots[DUMMY] = bot

    def _act_practice_finish(self, pid, data):
        """Luyện tập: cho đối thủ tập đứng choáng “FINISH HIM” để thử đòn kết liễu."""
        if not (self.practice and self.phase == "play" and pid == self.fighters[0] and self.rstate == "fight"):
            return False
        now = time.time()
        self.f[DUMMY]["hp"] = 0
        self.winner, self.loser = pid, DUMMY
        self.round_winner, self.round_reason = pid, "ko"
        self.rstate, self.r_at, self.r_until = "finish", now, now + FINISH_TIME
        self.projs = []
        bot = self.bots[DUMMY]
        bot.move = None
        bot.dizzy = True
        self._event("ko", pid, victim=DUMMY, perfect=False, finish=True)

    def _practice_reset(self):
        self.winner = self.loser = self.fatality = None
        self.bots[DUMMY].dizzy = False
        self._start_round(self.round + 1)

    def _act_next_match(self, pid, data):
        self._act_start(pid, data)

    def _act_lobby(self, pid, data):
        self._require_host(pid)
        if self.phase != "end":
            raise GameError("Không thể làm việc này lúc này.")
        self._reset_match()
        self.phase = "lobby"
        self.stats = {}
        self.real_no = 0
        self.last = None
        self._post_chat("system", "🔁 Quay lại phòng chờ.")

    def _act_stop(self, pid, data):
        self._require_host(pid)
        if self.phase != "play":
            raise GameError("Trận đấu chưa bắt đầu.")
        self._end_match(aborted=True)

    # ------------------------------------------------------------------ hiệp đấu
    def _start_round(self, n):
        now = time.time()
        self.round = n
        self.rstate = "intro"
        self.r_at = now
        self.fight_at = now + (1.2 if self.practice else INTRO + (VS_TIME if n == 1 else 0))
        self.r_until = self.fight_at
        self.round_end = self.fight_at + (10 ** 7 if self.practice else self.config["time"])   # luyện tập: không giới hạn giờ
        self.round_winner = self.round_reason = None
        self.perfect = False
        self.projs = []
        for i, p in enumerate(self.fighters):
            f = self.f[p]
            face = 1 if i == 0 else -1
            f.update(x=float(WORLD["START"][i]), y=0.0, vx=0.0, vy=0.0, face=face, s="idle", m="", e=0.0, b=False,
                     t=now, hp=WORLD["HP"], stun_until=0.0, inv_until=0.0, combo=0, cd={})
            if p in self.bots:
                self.bots[p].reset(WORLD["START"][i], face, now)
        self._event("round", None, n=n)

    async def _tick_loop(self, token):
        nxt = time.perf_counter()
        while token == self._token and not self._disposed:
            # hẹn theo mốc tuyệt đối để nhịp đều, không bị trôi
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
                    log.exception("Lỗi vòng lặp Võ Đài")
                await self._flush()
                if self.phase == "play":
                    await self.room.broadcast(self._fight_msg())
                if self._dirty:
                    self._dirty = False
                    await self.room.broadcast_state()

    def _tick(self):
        now = time.time()
        st = self.rstate
        if st == "intro" and now >= self.fight_at:
            self.rstate = "fight"
            self.r_at = now
            self._event("fight", None)
        elif st == "fight" and now >= self.round_end:
            self._timeout()
        elif st == "ko" and now >= self.r_until:
            if self.round >= MAX_ROUNDS:
                self._decide_by_rounds()
            else:
                self._start_round(self.round + 1)
        elif st in ("finish", "fatality", "over") and now >= self.r_until:
            if self.practice and st != "over":
                self._practice_reset()
            else:
                self._end_match()
                return
        if self.practice and self.rstate == "fight":
            for p in self.fighters:
                f = self.f[p]
                if f["hp"] < WORLD["HP"] and now - f["hurt_at"] > REGEN_AFTER:
                    f["hp"] = WORLD["HP"]
        self._step_bots(now)
        self._step_projs(now)
        # võ sĩ rớt mạng quá lâu → xử thua
        if self.rstate in ("intro", "fight"):
            for p in self.fighters:
                dc = self.f[p]["dc_at"]
                if dc and now - dc > DC_FORFEIT:
                    self._forfeit(p)
                    break

    def _mode(self, pid):
        if self.rstate == "fight":
            if pid == DUMMY and self.dummy["mode"] != "cpu":
                return "dummy:" + self.dummy["mode"]
            return "fight"
        if self.rstate == "finish" and pid == self.winner:
            return "chase"
        return "idle"

    def _step_bots(self, now):
        for pid, bot in self.bots.items():
            opp = self._other(pid)
            fo = self.f[opp]
            projs = [{"x": p["x"], "vx": p["vx"], "k": p["k"]} for p in self.projs if p["o"] == opp]
            evs = bot.step(now, fo, projs, self._mode(pid))
            f = self.f[pid]
            f.update(x=bot.x, y=bot.y, vx=bot.vx, vy=bot.vy, face=bot.face, s=bot.state, m=bot.move or "",
                     e=bot.elapsed, b=bot.block, t=now)
            for ev in evs:
                if self.rstate != "fight":
                    break
                if ev[0] == "active":
                    _, mv, n = ev
                    if now >= fo["inv_until"] and reaches(bot.x, bot.y, bot.face, mv, fo["x"], fo["y"], fo["s"]):
                        bot.hit_n = n
                        self._apply_hit(pid, opp, mv)
                elif ev[0] == "spawn":
                    self._spawn(pid, ev[1], bot.x, bot.face, now)
            # bot thắng: lại gần rồi kết liễu
            if (self.rstate == "finish" and pid == self.winner and now - self.r_at > 2.6
                    and abs(bot.x - fo["x"]) < 200):
                self._fatality(pid)

    # ------------------------------------------------------------------ chưởng
    def _spawn(self, pid, kind, x, face, now):
        m = MOVES[kind]
        self._proj_id += 1
        self.projs.append({"id": self._proj_id, "o": pid, "k": kind, "x": x + face * 40, "y": m["py"],
                           "vx": face * m["spd"], "born": now, "t": now})

    def _step_projs(self, now):
        if not self.projs:
            return
        if self.rstate != "fight":
            self.projs = []
            return
        half = WORLD["HALF"]
        alive = []
        for p in self.projs:
            m = MOVES[p["k"]]
            x0 = p["x"]
            p["x"] += p["vx"] * (now - p["t"])
            p["t"] = now
            if now - p["born"] > m["ttl"] or not (-60 < p["x"] < WORLD["W"] + 60):
                continue
            v = self._other(p["o"])
            fv = self.f[v]
            lo, hi = min(x0, p["x"]) - m["r"], max(x0, p["x"]) + m["r"]
            h = height(fv["s"])
            if (now >= fv["inv_until"] and hi > fv["x"] - half and lo < fv["x"] + half
                    and p["y"] + m["r"] > fv["y"] and p["y"] - m["r"] < fv["y"] + h):
                self._apply_hit(p["o"], v, p["k"], proj=p)
                continue
            alive.append(p)
        # hai quả cầu lửa ngược chiều chạm nhau thì triệt tiêu
        gone = set()
        for i, a in enumerate(alive):
            for b in alive[i + 1:]:
                if (a["o"] != b["o"] and a["id"] not in gone and b["id"] not in gone
                        and abs(a["x"] - b["x"]) < MOVES[a["k"]]["r"] + MOVES[b["k"]]["r"]):
                    gone.update((a["id"], b["id"]))
                    self._out.append({"type": "clash", "g": self.match_no, "x": round((a["x"] + b["x"]) / 2, 1),
                                      "y": (a["y"] + b["y"]) / 2})
        self.projs = [p for p in alive if p["id"] not in gone]

    # ------------------------------------------------------------------ trúng đòn
    def _apply_hit(self, a, v, mv, proj=None):
        if self.rstate != "fight":
            return
        now = time.time()
        m = MOVES[mv]
        fa, fv = self.f[a], self.f[v]
        if now < fv["inv_until"] or fv["hp"] <= 0:
            return
        direction = _sign(proj["vx"]) if proj else (_sign(fv["x"] - fa["x"]) if fv["x"] != fa["x"] else fa["face"])
        if m.get("throw"):
            direction = -fa["face"]     # bị quật qua đầu, văng ra sau lưng người ném
        blocked = (bool(fv["b"]) and fv["y"] < 2 and fv["face"] == -direction and fv["s"] in ("block", "cblock")
                   and not m.get("throw"))
        if blocked:
            dmg = round(m["dmg"] * WORLD["CHIP"]) if m.get("special") else 0
            combo = 0
        else:
            combo = fv["combo"] + 1 if now < fv["stun_until"] + 0.08 else 1
            dmg = max(1, round(m["dmg"] * max(0.5, 0.88 ** (combo - 1))))
        fv["hp"] = max(0, fv["hp"] - dmg)
        fv["hurt_at"] = now
        if self.practice and fv["hp"] <= 0:
            fv["hp"] = WORLD["HP"]   # luyện tập: không bao giờ bị K.O.
        ko = fv["hp"] <= 0
        finish = ko and self.config["fatality"] and self.round_wins[a] + 1 >= self.config["rounds"]
        if blocked:
            kb, up, stun, down = m["kb"] * 0.5, 0, WORLD["BLOCKSTUN"], False
        else:
            kb, up, stun, down = m["kb"], m["up"], m["stun"], m["down"] or fv["y"] > 2
        if ko and not finish:
            kb, up, down = max(kb, 320), max(up, 560), True
        if finish:
            kb, up, stun, down = 220, 0, FINISH_TIME + FATALITY_TIME, False
        msg = {"type": "hit", "g": self.match_no, "r": self.round, "a": a, "v": v, "mv": mv, "dmg": dmg, "blk": blocked,
               "dir": direction, "kb": kb, "up": up, "stun": stun, "down": down, "hp": fv["hp"], "combo": combo,
               "ko": ko, "finish": finish, "x": round(fv["x"], 1), "y": round(fv["y"] + (proj["y"] if proj else 80), 1)}
        if m.get("throw"):
            msg["pull"] = round(max(WORLD["LEFT"], min(WORLD["RIGHT"], fa["x"] - fa["face"] * 55)), 1)
            fv["x"] = msg["pull"]
        if m.get("pull") and not blocked:
            msg["pull"] = round(max(WORLD["LEFT"], min(WORLD["RIGHT"], fa["x"] + fa["face"] * m["pull"])), 1)
            fv["x"] = msg["pull"]
        fv["stun_until"] = now + stun
        fv["combo"] = combo
        if down:
            fv["inv_until"] = now + 0.6 + WORLD["DOWN"] + WORLD["RISE"]
        if not blocked:
            self.hits[a] = self.hits.get(a, 0) + 1
        if v in self.bots:
            self.bots[v].on_hit(msg, now)
        self._out.append(msg)
        if ko:
            self._ko(a, v)

    def _ko(self, a, v):
        now = time.time()
        self.round_wins[a] += 1
        self.round_winner, self.round_reason = a, "ko"
        self.perfect = self.f[a]["hp"] >= WORLD["HP"]
        self.r_at = now
        self.projs = []
        if self.round_wins[a] >= self.config["rounds"]:
            self.winner, self.loser = a, v
            if self.config["fatality"]:
                self.rstate, self.r_until = "finish", now + FINISH_TIME
            else:
                self.rstate, self.r_until = "over", now + OVER_PAUSE
        else:
            self.rstate, self.r_until = "ko", now + KO_PAUSE
        self._event("ko", a, victim=v, perfect=self.perfect, finish=self.rstate == "finish")
        self._add_log(f"💥 {self._name(a)} hạ K.O. {self._name(v)} ở hiệp {self.round}"
                      f"{' — không mất giọt máu nào!' if self.perfect else ''}", "ko")

    def _timeout(self):
        now = time.time()
        a, b = self.fighters
        ha, hb = self.f[a]["hp"], self.f[b]["hp"]
        self.r_at = now
        self.projs = []
        self.round_reason = "time"
        if ha == hb:
            self.round_winner = None
            self.rstate, self.r_until = "ko", now + KO_PAUSE
            self._event("time", None)
            self._add_log(f"⏱ Hết giờ hiệp {self.round} — hoà ({ha} máu mỗi bên).", "ko")
            return
        w, lo = (a, b) if ha > hb else (b, a)
        self.round_winner = w
        self.round_wins[w] += 1
        self.perfect = self.f[w]["hp"] >= WORLD["HP"]
        if self.round_wins[w] >= self.config["rounds"]:
            self.winner, self.loser = w, lo
            self.rstate, self.r_until = "over", now + OVER_PAUSE
        else:
            self.rstate, self.r_until = "ko", now + KO_PAUSE
        self._event("time", w)
        self._add_log(f"⏱ Hết giờ hiệp {self.round} — {self._name(w)} thắng nhờ còn nhiều máu hơn.", "ko")

    def _decide_by_rounds(self):
        a, b = self.fighters
        if self.round_wins[a] != self.round_wins[b]:
            self.winner, self.loser = (a, b) if self.round_wins[a] > self.round_wins[b] else (b, a)
        self._end_match()

    def _forfeit(self, pid):
        now = time.time()
        self.winner, self.loser = self._other(pid), pid
        self.round_winner, self.round_reason = self.winner, "forfeit"
        self.rstate, self.r_at, self.r_until = "over", now, now + OVER_PAUSE
        self.projs = []
        self._event("forfeit", pid)
        self._add_log(f"📴 {self._name(pid)} mất kết nối quá lâu — xử thua.", "ko")

    def _fatality(self, pid):
        now = time.time()
        kind = random.choice(FATALITIES)
        self.fatality = {"by": pid, "on": self.loser, "kind": kind, "at": now}
        self.rstate, self.r_at, self.r_until = "fatality", now, now + FATALITY_TIME
        if not self.practice:
            self._stat(pid)["fat"] += 1
        self._event("fatality", pid, victim=self.loser, style=kind)
        self._add_log(f"💀 FATALITY! {self._name(pid)} kết liễu {self._name(self.loser)}.", "fatal")

    def _end_practice(self):
        pid = self.fighters[0] if self.fighters else None
        self._reset_match()
        self.phase = "end" if self.last else "lobby"
        if pid:
            self._post_chat("system", f"🥋 {self._name(pid)} kết thúc luyện tập.")

    def _end_match(self, aborted=False):
        if self.practice:
            self._end_practice()
            return
        self._token += 1
        self.phase = "end"
        self.projs = []
        a, b = self.fighters
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
            # người thắng giữ võ đài, người thua xuống cuối hàng
            self._sync_queue()
            self.queue = [w] + [p for p in self.queue if p not in (w, lo)] + ([lo] if lo in self.room.players else [])
            text = f"🏆 {self._name(w)} thắng {self._name(lo)} {self.round_wins[w]}–{self.round_wins[lo]}!"
            if sw["streak"] >= 2:
                text += f" Chuỗi {sw['streak']} trận thắng 🔥"
        else:
            self._sync_queue()
            self.queue = [p for p in self.queue if p not in (a, b)] + [p for p in (a, b) if p in self.room.players]
            text = "🛑 Trận đấu bị dừng." if aborted else "🤝 Trận đấu hoà."
        self.last = {"no": self.real_no, "a": a, "b": b, "winner": w, "loser": lo,
                     "rounds": dict(self.round_wins), "hits": dict(self.hits),
                     "fatality": self.fatality["kind"] if self.fatality else None}
        self._event("win", w)
        self._add_log(text, "end")
        self._post_chat("system", text)

    # ------------------------------------------------------------------ hành động khi đấu
    def _fighting(self, pid):
        return self.phase == "play" and pid in self.f and pid not in self.bots

    def _act_pos(self, pid, data):
        if not self._fighting(pid):
            return False
        try:
            if int(data.get("r", 0)) != self.round:
                return False
            x, y = float(data.get("x")), float(data.get("y"))
            vx, vy, e = float(data.get("vx", 0)), float(data.get("vy", 0)), float(data.get("e", 0))
        except (TypeError, ValueError):
            return False
        if x != x or y != y or vx != vx or vy != vy or e != e:  # NaN
            return False
        f = self.f[pid]
        mv = str(data.get("m") or "")
        s = str(data.get("s") or "idle")
        now = time.time()
        try:
            ts = float(data.get("ts", now))
        except (TypeError, ValueError):
            ts = now
        ts = now if ts != ts else max(now - 0.3, min(now, ts))
        if ts <= f["t"]:
            return False      # gói đến muộn hơn gói mới hơn — bỏ
        f.update(x=max(WORLD["LEFT"], min(WORLD["RIGHT"], x)), y=max(0.0, min(400.0, y)),
                 vx=max(-2000.0, min(2000.0, vx)), vy=max(-3000.0, min(3000.0, vy)),
                 face=1 if (data.get("f") or 1) > 0 else -1, s=s if s in STATES else "idle",
                 m=mv if mv in MOVES else "", e=max(0.0, min(5.0, e)), b=bool(data.get("b")), t=ts, dc_at=None)
        return False

    def _act_hit(self, pid, data):
        if not self._fighting(pid) or self.rstate != "fight":
            return False
        mv = data.get("mv")
        m = MOVES.get(mv) if isinstance(mv, str) else None
        if not m or m.get("proj") or m.get("teleport"):
            return False
        if m.get("special") and mv not in self._char(pid)["moves"]:
            return False
        try:
            n = int(data.get("n", 0))
        except (TypeError, ValueError):
            return False
        now = time.time()
        f = self.f[pid]
        if n <= f["last_n"] or now - f["last_hit_at"] < 0.12:
            return False
        v = self._other(pid)
        fv = self.f[v]
        # Kiểm tra theo vị trí mới nhất của hai bên, có chừa độ trễ mạng.
        if not reaches(f["x"], f["y"], f["face"], mv, fv["x"], fv["y"], fv["s"], slack=SLACK):
            return False
        f["last_n"], f["last_hit_at"] = n, now
        self._apply_hit(pid, v, mv)
        return False

    def _act_special(self, pid, data):
        if not self._fighting(pid) or self.rstate != "fight":
            return False
        k = data.get("k")
        m = MOVES.get(k) if isinstance(k, str) else None
        if not m or not m.get("proj") or k not in self._char(pid)["moves"]:
            return False
        now = time.time()
        f = self.f[pid]
        if now < f["cd"].get(k, 0) - 0.2:
            return False
        f["cd"][k] = now + m["cd"]
        try:
            x = max(WORLD["LEFT"], min(WORLD["RIGHT"], float(data.get("x", f["x"]))))
        except (TypeError, ValueError):
            x = f["x"]
        if x != x:
            x = f["x"]
        face = 1 if (data.get("f") or 1) > 0 else -1
        self._spawn(pid, k, x, face, now)
        return False

    def _act_fatality(self, pid, data):
        if self.phase != "play" or self.rstate != "finish" or pid != self.winner or pid in self.bots:
            return False
        if abs(self.f[pid]["x"] - self.f[self.loser]["x"]) > FATAL_RANGE:
            raise GameError("Lại gần đối thủ hơn chút nữa rồi bấm F!")
        self._fatality(pid)

    # ------------------------------------------------------------------ chat
    def _act_chat(self, pid, data):
        text = " ".join(str(data.get("text", "")).split())[:300]
        if text:
            self._post_chat("all", text, pid)

    # ------------------------------------------------------------------ trạng thái
    def _fight_msg(self):
        now = time.time()
        fs = {}
        for p in self.fighters:
            f = self.f[p]
            fs[p] = [round(f["x"], 1), round(f["y"], 1), round(f["vx"]), round(f["vy"]), f["face"], f["s"], f["m"],
                     round(f["e"], 3) if f["m"] else 0, 1 if f["b"] else 0, f["hp"], round(f["t"], 3)]
        projs = [[p["id"], p["k"], round(p["x"], 1), p["y"], p["vx"], p["o"]] for p in self.projs]
        return {"type": "fight", "g": self.match_no, "r": self.round, "ts": round(now, 3), "f": fs, "p": projs}

    def view(self, pid):
        queue = [p for p in self.queue if p in self.room.players]
        queue += [p for p in self.room.players if p not in queue]
        players = []
        order = list(self.fighters) + [p for p in queue if p not in self.fighters]
        order += [p for p in self.room.players if p not in order]
        for p_id in order:
            p = self.room.players.get(p_id)
            if p is None and p_id not in self.fighters:
                continue
            st = self.stats.get(p_id, {})
            players.append({
                "id": p_id,
                "name": p.name if p else self.names.get(p_id, "?"),
                "bot": bool(p and p.is_bot) or p_id == DUMMY,
                "connected": bool(p and p.connected) or p_id == DUMMY,
                "look": p.look if p else None,
                "host": p_id == self.room.host_id,
                "fighter": p_id in self.fighters,
                "char": self.chars.get(p_id, CHARS[0]["id"]),
                "side": self.fighters.index(p_id) if p_id in self.fighters else None,
                "queue": queue.index(p_id) if p_id in queue else None,
                "w": st.get("w", 0), "l": st.get("l", 0), "streak": st.get("streak", 0),
                "best": st.get("best", 0), "fat": st.get("fat", 0),
            })
        return {
            "phase": self.phase,
            "matchNo": self.match_no,
            "matchLabel": self.real_no,
            "practice": self.practice,
            "dummy": self.dummy,
            "dummyModes": DUMMY_MODES,
            "me": {"id": pid, "host": pid == self.room.host_id, "fighter": pid in self.fighters,
                   "side": self.fighters.index(pid) if pid in self.fighters else None},
            "players": players,
            "fighters": self.fighters,
            "colors": COLORS,
            "queue": queue,
            "round": self.round,
            "rstate": self.rstate,
            "rAt": self.r_at,
            "rUntil": self.r_until,
            "fightAt": self.fight_at,
            "roundEnd": self.round_end,
            "roundWins": self.round_wins,
            "roundWinner": self.round_winner,
            "roundReason": self.round_reason,
            "perfect": self.perfect,
            "winner": self.winner,
            "loser": self.loser,
            "fatality": self.fatality,
            "stage": self.stage,
            "last": self.last,
            "now": time.time(),
            "events": self.events[-20:],
            "config": self.config,
            "world": WORLD,
            "moves": MOVES,
            "chars": CHARS,
            "roundTimes": ROUND_TIMES,
            "roundWinsOpt": ROUND_WINS,
            "botLevels": BOT_LEVELS,
            "maxPlayers": self.max_players,
            "fatalRange": FATAL_RANGE,
            "chat": self.chat[-150:],
            "log": self.log[-100:],
        }
