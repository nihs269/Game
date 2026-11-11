"""Đua Xe Gõ Phím — cả phòng gõ cùng một đoạn văn, xe ai về đích trước thì thắng chặng.

Mỗi ván gồm vài chặng; mỗi chặng:
  countdown — đèn xuất phát 3‑2‑1 (đoạn văn đã hiện để đọc trước, chưa gõ được).
  race      — gõ từng từ; gõ đúng cả từ + dấu cách mới sang từ tiếp. Trình duyệt báo tiến độ (số ký tự đúng)
              ~8 lần/giây; máy chủ gom lại và phát tin nhắn nhẹ {"type": "duaxe"} 10 lần/giây thay vì cả trạng thái.
              Người đầu tiên về đích → những người còn lại chỉ còn FINISH_GRACE giây.
              🔥 Nitro: máy chủ tự đếm chuỗi từ gõ đúng liền (số lỗi không tăng) → đủ NITRO_WORDS thì nạp 1 bình;
              kích hoạt thì trong NITRO_TIME giây mỗi ký tự gõ đúng cộng thêm quãng đường thưởng — xe về đích
              khi ký tự đã gõ + quãng thưởng đủ dài đoạn văn (nên có thể về đích trước khi gõ hết chữ).
              💨 Đang gõ sai thì xe bốc khói (danh sách "err" trong tin nhắn nhẹ).
  result    — xếp hạng chặng, cộng điểm theo thứ hạng về đích.
Hết các chặng, tổng điểm cao nhất thắng (bằng điểm thì xét WPM trung bình).
"""
import asyncio
import logging
import random
import time
import unicodedata

from core.game_base import BaseGame, GameError
from .bots import DuaXeBotMixin
from .texts import POOLS

log = logging.getLogger("gamehub.duaxe")

COLORS = ["#ff4d5e", "#3b8cff", "#34c46e", "#ffc23c", "#b07cff", "#ff8fc7", "#2fd0d0", "#ff9f43"]
POINTS = [10, 8, 6, 5, 4, 3, 2, 1]
ROUNDS = (1, 3, 5)
LENGTHS = ("short", "medium", "long", "mixed")
ACCENTS = ("co", "khong")
BOT_LEVELS = ("easy", "normal", "hard", "pro")
COUNTDOWN = 4.0
RESULT_TIME = 7.0
FINISH_GRACE = 25.0
TICK = 0.1
MAX_CPS = 25  # ~300 WPM — nhanh hơn thế coi như gian lận, chặn lại
NITRO_WORDS = 10   # gõ liền chừng này từ không sai thì được 1 bình nitro (giữ tối đa 1)
NITRO_TIME = 4.0   # nitro kéo dài (giây)
NITRO_GAIN = 0.5   # trong lúc nitro, mỗi ký tự gõ đúng đẩy xe đi thêm 50%


def strip_accents(text):
    text = text.replace("đ", "d").replace("Đ", "D")
    return unicodedata.normalize("NFC", "".join(
        c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn"))


class DuaXeGame(DuaXeBotMixin, BaseGame):
    id = "duaxe"
    name = "Đua Xe Gõ Phím"
    icon = "🏎️"
    description = "Cả phòng gõ cùng một đoạn văn tiếng Việt — gõ đúng từng từ để xe chạy, ai về đích trước thắng!"
    min_players = 1
    max_players = 8
    guide = [
        ("🎯 Mục tiêu", "Gõ thật nhanh và đúng đoạn văn hiện trên màn hình. Mỗi từ gõ đúng giúp xe của bạn tiến lên — **về đích trước** thì thắng chặng."),
        ("⌨️ Cách gõ", [
            "Gõ đúng **cả từ rồi bấm dấu cách** mới sang từ tiếp theo. Gõ sai thì ô gõ chuyển **đỏ** — xoá đi gõ lại.",
            "Chế độ **có dấu**: bật bộ gõ tiếng Việt (Unikey, Telex/VNI…). Gõ chưa xong dấu không bị tính sai, nhưng phải đủ dấu mới qua từ.",
            "Chế độ **không dấu**: tắt bộ gõ tiếng Việt, gõ như chữ thường.",
            "Không dán (paste) được. Trong lúc đèn đỏ có thể đọc trước đoạn văn.",
            "Đang gõ sai thì xe **bốc khói** và khựng lại — cả phòng đều thấy!",
        ]),
        ("🔥 Nitro", [
            "Gõ liền **10 từ không sai** thì nạp được 1 bình nitro (giữ tối đa 1).",
            "Bấm **Tab** (hoặc nút 🔥) để kích hoạt: trong **4 giây**, mỗi chữ gõ đúng đẩy xe đi xa **gấp rưỡi** — có thể về đích trước khi gõ hết đoạn văn.",
        ]),
        ("🏅 Tính điểm", [
            "Về nhất **10 điểm**, nhì 8, ba 6, rồi 5 · 4 · 3 · 2 · 1. Không về đích kịp: 0 điểm.",
            "Người đầu tiên về đích → những người còn lại chỉ còn **25 giây**.",
            "**WPM** = số từ (5 ký tự) mỗi phút. Hết các chặng, tổng điểm cao nhất thắng.",
        ]),
        ("⚙️ Tuỳ chọn (chủ phòng)", "Số chặng, độ dài đoạn văn, có dấu / không dấu, độ khó bot (25 → 95 WPM). Chơi một mình để luyện cũng được!"),
    ]

    def __init__(self, room):
        super().__init__(room)
        self.config = {"rounds": 3, "length": "medium", "accent": "co", "bot_level": "normal"}
        self.chat = []
        self.log = []
        self.events = []
        self._msg_id = 0
        self._seq = 0
        self._token = 0
        self._race_token = 0
        self._dirty = False
        self.deadline = None
        self.phase_total = None
        self.wins = {}
        self.game_no = 0
        self._used = set()
        self._reset_game()
        self.phase = "lobby"

    def _reset_game(self):
        self._token += 1
        self._race_token += 1
        self.deadline = self.phase_total = None
        self.order = []
        self.names = {}
        self.colors = {}
        self.points = {}
        self.best_wpm = {}
        self.wpm_sum = {}
        self.finished_count = {}
        self.stage = None          # countdown · race · result
        self.race_no = 0
        self.total_races = 0
        self.text = ""
        self.started_at = None
        self.race_limit = 0
        self.prog = {}             # quãng đường của xe (ký tự đã gõ đúng + quãng thưởng nitro)
        self.typed = {}            # số ký tự đã gõ đúng
        self.done = {}             # số ký tự tới hết từ đã hoàn thành (để vào lại giữa chừng)
        self.typos = {}
        self.bonus = {}            # quãng thưởng nitro
        self.streak = {}           # số từ gõ đúng liền
        self.charge = {}           # 1 = đang có bình nitro
        self.boost_until = {}
        self.err = set()           # ai đang gõ sai (xe bốc khói)
        self._sent_fx = None
        self.fin = {}              # pid → {place, ms, wpm, acc}
        self.results = []
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
                log.exception("Lỗi hẹn giờ Đua Xe")
            await self.room.broadcast_state()

    def _stop_timer(self):
        self._token += 1
        self.deadline = self.phase_total = None

    def dispose(self):
        self._token += 1
        self._race_token += 1
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
        return {"label": f"Đang đua chặng {self.race_no}/{self.total_races}", "joinable": False}

    async def on_player_join(self, player):
        self._post_chat("system", f"👋 {player.name} đã vào phòng.")

    async def on_player_removed(self, player):
        self.names[player.id] = player.name
        self._post_chat("system", f"🚪 {player.name} đã rời phòng.")

    async def on_action(self, player, action, data):
        handler = getattr(self, "_act_" + action, None) if action.isidentifier() else None
        if handler is None:
            raise GameError("Hành động không hợp lệ.")
        return handler(player.id, data)

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
        if data.get("length") in LENGTHS:
            self.config["length"] = data["length"]
        if data.get("accent") in ACCENTS:
            self.config["accent"] = data["accent"]
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
        self.total_races = self.config["rounds"]
        for i, p in enumerate(self.order):
            self.names[p] = self._name(p)
            self.colors[p] = COLORS[i % len(COLORS)]
            self.points[p] = 0
            self.wpm_sum[p] = 0.0
            self.finished_count[p] = 0
            self.wins.setdefault(p, 0)
        self._post_chat("system", f"🏎️ Ván {self.game_no} bắt đầu — {self.total_races} chặng đua!")
        self._add_log(f"🏎️ Ván {self.game_no} bắt đầu — {self.total_races} chặng.", "start")
        self._next_race()

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

    # ------------------------------------------------------------------ chặng đua
    def _pick_text(self):
        length = self.config["length"]
        if length == "mixed":
            length = random.choice(["short", "medium", "long"])
        pool = POOLS[length]
        fresh = [t for t in pool if t not in self._used]
        if not fresh:
            self._used -= set(pool)
            fresh = pool
        text = random.choice(fresh)
        self._used.add(text)
        text = unicodedata.normalize("NFC", " ".join(text.split()))
        return strip_accents(text) if self.config["accent"] == "khong" else text

    def _next_race(self):
        if self.race_no >= self.total_races:
            self._finish()
            return
        self.race_no += 1
        self.text = self._pick_text()
        self.race_limit = int(len(self.text) / 1.6) + 15
        self.prog = {p: 0 for p in self.order}
        self.typed = {p: 0 for p in self.order}
        self.done = {p: 0 for p in self.order}
        self.typos = {p: 0 for p in self.order}
        self.bonus = {p: 0.0 for p in self.order}
        self.streak = {p: 0 for p in self.order}
        self.charge = {p: 0 for p in self.order}
        self.boost_until = {}
        self.err = set()
        self._sent_fx = None
        self.fin = {}
        self.results = []
        self.started_at = None
        self.stage = "countdown"
        self._bots_init_race()
        self._event("countdown", None, race=self.race_no)
        self._set_timer(COUNTDOWN, self._begin_race)

    def _begin_race(self):
        self.stage = "race"
        self.started_at = time.time()
        self._event("go", None, race=self.race_no)
        self._set_timer(self.race_limit, self._end_race)
        self._race_token += 1
        asyncio.ensure_future(self._ticker(self._race_token))

    async def _ticker(self, token):
        last = time.time()
        while token == self._race_token:
            await asyncio.sleep(TICK)
            async with self.room.lock:
                if token != self._race_token or self.stage != "race" or getattr(self, "_disposed", False):
                    return
                now = time.time()
                dt, last = now - last, now
                try:
                    full = self._bots_step(dt, now)
                    if self._all_done():
                        self._end_race()
                        full = True
                except Exception:
                    log.exception("Lỗi vòng lặp Đua Xe")
                    full = True
                # Nitro hết giờ / xe hết khói cũng phải báo cho mọi người.
                fx = (tuple(sorted(self._boosting(now))), tuple(sorted(self.err)), tuple(sorted(p for p, c in self.charge.items() if c)))
                if fx != self._sent_fx:
                    self._sent_fx = fx
                    self._dirty = True
                if full:
                    await self.room.broadcast_state()
                elif self._dirty:
                    self._dirty = False
                    await self.room.broadcast({"type": "duaxe", "race": self.race_no, **self._live(now)})

    def _boosting(self, now=None):
        now = now or time.time()
        return [p for p, t in self.boost_until.items() if t > now and p not in self.fin]

    def _live(self, now=None):
        """Phần thay đổi liên tục trong lúc đua — gửi bằng tin nhắn nhẹ và trong trạng thái đầy đủ."""
        return {"prog": {p: int(v) for p, v in self.prog.items()}, "boost": self._boosting(now),
                "err": [p for p in self.err if p not in self.fin], "charge": self.charge}

    def _advance(self, pid, typed, done, now):
        """Cập nhật tiến độ: cộng quãng thưởng nếu đang nitro, nạp nitro khi đủ chuỗi từ đúng liền."""
        n = len(self.text)
        prev_done = self.done.get(pid, 0)
        if done > prev_done:
            if self.boost_until.get(pid, 0) > now:
                self.bonus[pid] = self.bonus.get(pid, 0.0) + (done - prev_done) * NITRO_GAIN
            if not self.charge.get(pid):   # đang giữ bình thì chưa nạp tiếp
                words = self.text[prev_done:done].count(" ") + (1 if done >= n > prev_done else 0)
                self.streak[pid] = self.streak.get(pid, 0) + words
                if self.streak[pid] >= NITRO_WORDS:
                    self.charge[pid] = 1
                    self.streak[pid] = 0
        self.typed[pid] = typed
        self.done[pid] = done
        self.prog[pid] = min(n, typed + self.bonus.get(pid, 0.0))
        self._dirty = True
        return done >= n or done + self.bonus.get(pid, 0.0) >= n

    def _use_nitro(self, pid, now):
        if not self.charge.get(pid) or self.boost_until.get(pid, 0) > now:
            return False
        self.charge[pid] = 0
        self.boost_until[pid] = now + NITRO_TIME
        self._event("nitro", pid)
        self._dirty = True
        return True

    def _all_done(self):
        racing = [p for p in self.order if self._connected(p)]
        return bool(racing) and all(p in self.fin for p in racing)

    def _act_progress(self, pid, data):
        if self.phase != "play" or self.stage != "race" or pid not in self.order or pid in self.fin:
            return False
        if data.get("race") != self.race_no:
            return False
        n = len(self.text)
        try:
            pos = max(0, min(n, int(data.get("pos", 0))))
            done = max(0, min(pos, int(data.get("done", 0))))
            typos = max(0, min(9999, int(data.get("typos", 0))))
        except (TypeError, ValueError):
            return False
        now = time.time()
        cap = int((now - self.started_at) * MAX_CPS) + 8
        pos, done = min(pos, cap), min(done, cap)
        if typos > self.typos.get(pid, 0):
            self.streak[pid] = 0
        self.typos[pid] = typos
        if data.get("err"):
            self.err.add(pid)
        else:
            self.err.discard(pid)
        finished = self._advance(pid, pos, done, now)
        if data.get("nitro") and not finished:
            self._use_nitro(pid, now)
        if finished:
            self._finish_player(pid)
            if self._all_done():
                self._end_race()
            return None   # gửi lại toàn bộ trạng thái
        return False

    def _finish_player(self, pid):
        ms = int((time.time() - self.started_at) * 1000)
        n = len(self.text)
        typed = max(1, self.typed.get(pid, n))   # nitro về đích sớm thì WPM chỉ tính phần đã thật sự gõ
        wpm = round(typed / 5 / max(ms / 60000, 1e-3))
        acc = round(100 * typed / (typed + self.typos.get(pid, 0)))
        place = len(self.fin) + 1
        self.fin[pid] = {"place": place, "ms": ms, "wpm": wpm, "acc": acc}
        self.prog[pid] = n
        self.err.discard(pid)
        self._event("finish", pid, place=place)
        if place == 1:
            self._post_chat("system", f"🏁 {self._name(pid)} về nhất chặng {self.race_no} — {wpm} WPM!")
            remaining = self.deadline - time.time() if self.deadline else 0
            if remaining > FINISH_GRACE:
                self._set_timer(FINISH_GRACE, self._end_race)

    def _end_race(self):
        if self.stage != "race":
            return
        self._race_token += 1
        self.stage = "result"
        elapsed = max(1.0, time.time() - self.started_at)
        n = len(self.text)
        finishers = sorted(self.fin, key=lambda p: self.fin[p]["place"])
        others = sorted([p for p in self.order if p not in self.fin], key=lambda p: -self.prog.get(p, 0))
        self.results = []
        for rank, p in enumerate(finishers + others, 1):
            f = self.fin.get(p)
            if f:
                pts = POINTS[min(f["place"], len(POINTS)) - 1]
                self.wpm_sum[p] += f["wpm"]
                self.finished_count[p] += 1
                self.best_wpm[p] = max(self.best_wpm.get(p, 0), f["wpm"])
                row = {"pid": p, "rank": rank, "finished": True, **f, "pts": pts}
            else:
                row = {"pid": p, "rank": rank, "finished": False, "pts": 0,
                       "wpm": round(self.typed.get(p, 0) / 5 / (elapsed / 60)), "pct": round(100 * self.prog.get(p, 0) / n)}
            self.points[p] += row["pts"]
            self.results.append(row)
        if finishers:
            f = self.fin[finishers[0]]
            self._add_log(f"🏁 Chặng {self.race_no}: {self._name(finishers[0])} về nhất — {f['wpm']} WPM, chính xác {f['acc']}%.", "round")
        else:
            self._add_log(f"🏁 Chặng {self.race_no}: không ai về đích kịp!", "round")
        self._event("result", finishers[0] if finishers else None, race=self.race_no)
        self._set_timer(RESULT_TIME, self._next_race)

    def _avg_wpm(self, p):
        c = self.finished_count.get(p, 0)
        return round(self.wpm_sum.get(p, 0) / c) if c else 0

    def _finish(self):
        self._stop_timer()
        self._race_token += 1
        self.phase = "end"
        self.stage = None
        self.ranking = sorted(self.order, key=lambda p: (-self.points[p], -self._avg_wpm(p)))
        self.winner = self.ranking[0] if self.ranking else None
        if self.winner:
            self.wins[self.winner] = self.wins.get(self.winner, 0) + 1
            text = f"🏆 {self._name(self.winner)} thắng ván {self.game_no} với {self.points[self.winner]} điểm!"
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
                "points": self.points.get(p_id, 0),
                "best": self.best_wpm.get(p_id),
                "avg": self._avg_wpm(p_id),
                "wins": self.wins.get(p_id, 0),
            })
        race = None
        if self.phase == "play" and self.stage:
            race = {"n": self.race_no, "total": self.total_races, "text": self.text,
                    "startedAt": self.started_at, "limit": self.race_limit,
                    **self._live(), "fin": self.fin, "nitroWords": NITRO_WORDS, "nitroTime": NITRO_TIME, "nitroGain": NITRO_GAIN,
                    "results": self.results if self.stage == "result" else None,
                    "mine": {"done": self.done.get(pid, 0), "typos": self.typos.get(pid, 0), "streak": self.streak.get(pid, 0),
                             "bonus": self.bonus.get(pid, 0.0)} if pid in self.order else None}
        return {
            "phase": self.phase,
            "stage": self.stage,
            "gameNo": self.game_no,
            "me": {"id": pid, "host": pid == self.room.host_id, "playing": pid in self.order},
            "players": players,
            "race": race,
            "winner": self.winner,
            "ranking": self.ranking,
            "deadline": self.deadline,
            "total": self.phase_total,
            "now": time.time(),
            "events": self.events[-15:],
            "config": self.config,
            "choices": {"rounds": ROUNDS, "length": LENGTHS, "accent": ACCENTS, "bot_level": BOT_LEVELS},
            "points": POINTS,
            "minPlayers": self.min_players,
            "maxPlayers": self.max_players,
            "startError": self._start_error() if self.phase != "play" else None,
            "chat": self.chat[-150:],
            "log": self.log[-100:],
        }
