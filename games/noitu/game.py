"""Nối Từ — lần lượt nói một từ 2 tiếng bắt đầu bằng tiếng cuối của từ trước (con mèo → mèo mướp → mướp đắng…).

Luật:
  • Từ phải có đúng 2 tiếng, có trong từ điển (~62.000 từ) và chưa ai dùng trong ván.
  • Hết giờ hoặc bấm “Chịu” → mất 1 mạng; hết mạng thì bị loại. Người kế tiếp bắt đầu với một từ mới.
  • Từ chặn: nếu từ vừa nói không còn từ nào nối tiếp được, người kế tiếp mất mạng ngay (chủ phòng tắt được).
  • Từ chưa có trong từ điển (nhưng đúng 2 tiếng tiếng Việt) có thể “xin duyệt”: những người còn lại bỏ phiếu,
    quá nửa đồng ý thì từ được tính và lưu luôn vào từ điển cho các ván sau.
  • Người cuối cùng còn trụ lại thắng.
"""
import asyncio
import logging
import random
import time

from core.game_base import BaseGame, GameError
from .bots import NoiTuBotMixin
from .dictionary import DICT, clean_input, syl_key, word_key

log = logging.getLogger("gamehub.noitu")

COLORS = ["#ff6b6b", "#4d8df7", "#3cc47c", "#ffc23c", "#b07cff", "#ff8fc7", "#2fd0d0", "#ff9f43"]
LIVES = (1, 2, 3)
TURN_TIMES = (10, 15, 20, 30, 45)
BOT_LEVELS = ("easy", "normal", "hard")
VOTE_TIME = 12
PAUSE_TIME = 2.6
BLOCK_TIME = 2.4
OFFLINE_TIME = 8


class NoiTuGame(NoiTuBotMixin, BaseGame):
    id = "noitu"
    name = "Nối Từ"
    icon = "🔤"
    description = "Nối từ tiếng Việt: nói từ 2 tiếng bắt đầu bằng tiếng cuối của từ trước — con mèo → mèo mướp → mướp đắng… Kho hơn 60.000 từ!"
    min_players = 2
    max_players = 8
    guide = [
        ("🎯 Mục tiêu", "Lần lượt nối từ, ai bí thì mất mạng. **Người cuối cùng còn trụ lại** thắng."),
        ("🔤 Cách nối", [
            "Nói một từ **đúng 2 tiếng**, bắt đầu bằng **tiếng cuối** của từ trước: con **mèo** → **mèo** mướp → **mướp** đắng…",
            "Chỉ cần gõ **tiếng thứ hai** (tiếng đầu đã điền sẵn) rồi bấm Enter. Gõ cả từ cũng được.",
            "Từ phải **có trong từ điển** (hơn 60.000 từ) và **chưa ai dùng** trong ván. Bỏ dấu kiểu cũ hay mới đều được (hoá = hóa, kĩ = kỹ).",
            "Gõ sai thì được gõ lại, miễn còn giờ.",
        ]),
        ("💔 Mạng", [
            "**Hết giờ** hoặc bấm **Chịu** → mất 1 mạng. Hết mạng thì bị loại.",
            "Sau khi có người bí, người kế tiếp bắt đầu với **một từ mới**.",
            "**Từ chặn**: nói được từ mà không còn từ nào nối tiếp → người kế tiếp mất mạng luôn! (chủ phòng tắt được)",
        ]),
        ("🗳️ Xin duyệt từ mới", "Từ đúng tiếng Việt nhưng chưa có trong từ điển? Bấm **Xin duyệt** — những người còn lại bỏ phiếu, **quá nửa đồng ý** thì từ được tính và **lưu vào từ điển** cho các ván sau."),
        ("⚙️ Tuỳ chọn (chủ phòng)", "Số mạng (1–3), thời gian mỗi lượt, bật/tắt từ chặn, độ khó của bot."),
    ]

    def __init__(self, room):
        super().__init__(room)
        self.config = {"lives": 2, "turn_time": 20, "block": True, "bot_level": "normal"}
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
        self.lives = {}
        self.score = {}
        self.alive = []
        self.out = []            # bị loại theo thứ tự
        self.cur = None          # người đang tới lượt
        self.stage = None        # turn · vote · pause
        self.word = None         # khoá từ hiện tại
        self.chain = []          # [{"k", "w", "pid"}] — pid None = từ mở màn
        self.used = set()
        self.propose = {}        # pid → từ vừa gõ chưa có trong từ điển (để xin duyệt)
        self.vote = None
        self.reveal = None       # lần bí gần nhất: ai, vì sao, gợi ý
        self.turn_left = None
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

    def _need(self):
        """Tiếng mà từ kế tiếp phải bắt đầu bằng (khoá), hoặc None."""
        return self.word.split()[1] if self.word else None

    def _next_alive(self, pid):
        """Người còn sống kế tiếp sau `pid` theo thứ tự ngồi."""
        i = self.order.index(pid)
        for k in range(1, len(self.order) + 1):
            q = self.order[(i + k) % len(self.order)]
            if q in self.alive:
                return q
        return None

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
                log.exception("Lỗi hẹn giờ Nối Từ")
            await self.room.broadcast_state()

    def _stop_timer(self):
        self._token += 1
        self.deadline = self.phase_total = None

    def dispose(self):
        self._token += 1
        self._disposed = True

    # ------------------------------------------------------------------ core hooks
    def can_remove(self, pid):
        return self.phase != "play" or pid not in self.alive

    def can_rename(self):
        return self.phase != "play"

    def status(self):
        if self.phase == "lobby":
            return {"label": "Đang chờ", "joinable": True}
        if self.phase == "end":
            return {"label": "Nghỉ giữa ván", "joinable": True}
        return {"label": "Đang nối từ", "joinable": False}

    async def on_player_join(self, player):
        self._post_chat("system", f"👋 {player.name} đã vào phòng.")

    async def on_player_removed(self, player):
        self.names[player.id] = player.name
        self._post_chat("system", f"🚪 {player.name} đã rời phòng.")

    async def on_player_disconnect(self, player):
        if self.phase == "play" and self.stage == "turn" and player.id == self.cur:
            self._turn_timer()

    async def on_player_connect(self, player):
        if self.phase == "play" and self.stage == "turn" and player.id == self.cur:
            self._turn_timer()

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
        for key, allowed in (("lives", LIVES), ("turn_time", TURN_TIMES)):
            if key in data:
                try:
                    v = int(data[key])
                except (TypeError, ValueError):
                    continue
                if v in allowed:
                    self.config[key] = v
        if "block" in data:
            self.config["block"] = bool(data["block"])
        if data.get("bot_level") in BOT_LEVELS:
            self.config["bot_level"] = data["bot_level"]

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
        for i, p in enumerate(self.order):
            self.names[p] = self._name(p)
            self.colors[p] = COLORS[i % len(COLORS)]
            self.lives[p] = self.config["lives"]
            self.score[p] = 0
            self.wins.setdefault(p, 0)
        self.alive = list(self.order)
        self._new_word()
        first = self.order[0]
        self._post_chat("system", f"🔤 Ván {self.game_no} bắt đầu! Từ mở màn: «{DICT.show(self.word)}» — {self._name(first)} nối trước.")
        self._add_log(f"🔤 Ván {self.game_no} bắt đầu — từ mở màn «{DICT.show(self.word)}».", "start")
        self._begin_turn(first)

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
        best = max(self.alive, key=lambda p: (self.lives[p], self.score[p]))
        self._finish(best, "Chủ phòng kết thúc ván")

    # ------------------------------------------------------------------ lượt chơi
    def _new_word(self):
        self.word = DICT.random_start(self.used)
        self.used.add(self.word)
        self.chain.append({"k": self.word, "w": DICT.show(self.word), "pid": None})
        self._event("newword", None, word=DICT.show(self.word))

    def _turn_timer(self, seconds=None):
        if seconds is None:
            seconds = self.config["turn_time"]
        if not self._connected(self.cur):
            seconds = min(seconds, OFFLINE_TIME)
        self._set_timer(seconds, lambda: self._fail(self.cur, "timeout"))

    def _begin_turn(self, pid):
        self.cur = pid
        self.stage = "turn"
        self.propose.pop(pid, None)
        self._event("turn", pid)
        if self.config["block"] and not DICT.nexts(self.word, self.used):
            # Từ chặn: không còn từ nào nối được → mất mạng luôn.
            self._add_log(f"🧱 «{DICT.show(self.word)}» là từ chặn — không còn từ nào nối được!", "block")
            self._set_timer(BLOCK_TIME, lambda: self._fail(pid, "block"))
            return
        self._turn_timer()

    def _act_say(self, pid, data):
        if self.phase != "play" or self.stage != "turn" or pid != self.cur:
            raise GameError("Chưa tới lượt của bạn.")
        text = clean_input(data.get("text"))
        parts = text.split()
        need = self._need()
        if len(parts) == 1 and need:
            parts = [DICT.show(self.word).split()[1], parts[0]]
        if len(parts) != 2:
            raise GameError("Từ phải có đúng 2 tiếng.")
        w = " ".join(parts)
        k = word_key(w)
        if need and k.split()[0] != need:
            raise GameError(f"Phải bắt đầu bằng «{DICT.show(self.word).split()[1]}».")
        if k in self.used:
            raise GameError(f"«{DICT.show(k)}» đã có người dùng rồi.")
        if not DICT.has(k):
            if all(s in DICT.syllables for s in k.split()):
                # Không báo lỗi (để trạng thái được gửi đi): giao diện hiện lời mời “Xin duyệt”.
                self.propose[pid] = w
                return
            raise GameError(f"«{w}» không có trong từ điển.")
        self._accept(pid, k)

    def _accept(self, pid, k):
        self.propose.pop(pid, None)
        self.word = k
        self.used.add(k)
        self.chain.append({"k": k, "w": DICT.show(k), "pid": pid})
        if len(self.chain) > 400:
            self.chain = self.chain[-400:]
        self.score[pid] += 1
        self.reveal = None
        left = len(DICT.nexts(k, self.used))
        self._event("word", pid, word=DICT.show(k), killer=left == 0)
        self._add_log(f"💬 {self._name(pid)}: {DICT.show(k)}", "word")
        self._begin_turn(self._next_alive(pid))

    def _act_giveup(self, pid, data):
        if self.phase != "play" or self.stage != "turn" or pid != self.cur:
            raise GameError("Chưa tới lượt của bạn.")
        self._fail(pid, "giveup")

    def _fail(self, pid, reason):
        if self.phase != "play" or pid != self.cur or self.stage != "turn":
            return
        self._stop_timer()
        self.lives[pid] -= 1
        nexts = DICT.nexts(self.word, self.used)
        common = [k for k in nexts if k in DICT.common]
        pool = common or nexts
        hints = [DICT.show(k) for k in random.sample(pool, min(3, len(pool)))]
        self.reveal = {"pid": pid, "reason": reason, "word": DICT.show(self.word), "hints": hints}
        why = {"timeout": "hết giờ", "giveup": "chịu thua", "block": "gặp từ chặn"}[reason]
        self._event("fail", pid, reason=reason, lives=self.lives[pid], hints=hints)
        tip = f" Có thể nối: {', '.join(hints)}." if hints else ""
        self._add_log(f"💔 {self._name(pid)} {why} ở «{DICT.show(self.word)}» — còn {self.lives[pid]} mạng.{tip}", "fail")
        if self.lives[pid] <= 0:
            nxt = self._next_alive(pid)
            self.alive.remove(pid)
            self.out.append(pid)
            self._event("out", pid)
            self._add_log(f"💥 {self._name(pid)} bị loại!", "out")
            if len(self.alive) <= 1:
                self._finish(self.alive[0] if self.alive else pid, "Trụ lại cuối cùng")
                return
        else:
            nxt = self._next_alive(pid)
        self.stage = "pause"
        self.cur = None
        self._set_timer(PAUSE_TIME, lambda: self._restart_from(nxt))

    def _restart_from(self, pid):
        if pid not in self.alive:
            pid = self.alive[0]
        self._new_word()
        self._add_log(f"🔤 Từ mới: «{DICT.show(self.word)}».", "start")
        self._begin_turn(pid)

    # ------------------------------------------------------------------ xin duyệt từ mới
    def _act_propose(self, pid, data):
        if self.phase != "play" or self.stage != "turn" or pid != self.cur:
            raise GameError("Chưa tới lượt của bạn.")
        w = self.propose.get(pid)
        if not w:
            raise GameError("Không có từ nào để xin duyệt.")
        voters = [p for p in self.alive if p != pid]
        self.turn_left = max(6, (self.deadline or time.time()) - time.time())
        self.stage = "vote"
        self.vote = {"pid": pid, "w": w, "k": word_key(w), "votes": {}, "voters": voters}
        self._event("vote", pid, word=w)
        self._add_log(f"🗳️ {self._name(pid)} xin duyệt từ «{w}».", "vote")
        self._set_timer(VOTE_TIME, self._close_vote)

    def _act_vote(self, pid, data):
        if self.phase != "play" or self.stage != "vote" or not self.vote:
            raise GameError("Không có cuộc bỏ phiếu nào.")
        if pid not in self.vote["voters"]:
            raise GameError("Bạn không bỏ phiếu cho từ của chính mình.")
        self.vote["votes"][pid] = bool(data.get("yes"))
        if len(self.vote["votes"]) >= len(self.vote["voters"]):
            self._close_vote()

    def _close_vote(self):
        v = self.vote
        if not v or self.stage != "vote":
            return
        self._stop_timer()
        yes = sum(1 for x in v["votes"].values() if x)
        no = len(v["voters"]) - yes   # không bỏ phiếu = không đồng ý
        self.vote = None
        pid = v["pid"]
        self.stage = "turn"
        if yes > no and v["k"] not in self.used:
            DICT.add(v["w"])
            self._event("voted", pid, word=v["w"], ok=True, yes=yes, no=no)
            self._add_log(f"✅ «{v['w']}» được chấp nhận ({yes}/{len(v['voters'])}) và thêm vào từ điển!", "vote")
            self._accept(pid, word_key(v["w"]))
            return
        self.propose.pop(pid, None)
        self._event("voted", pid, word=v["w"], ok=False, yes=yes, no=no)
        self._add_log(f"❌ «{v['w']}» không được chấp nhận ({yes}/{len(v['voters'])}).", "vote")
        self._turn_timer(self.turn_left)

    # ------------------------------------------------------------------ kết thúc
    def _finish(self, pid, reason):
        self._stop_timer()
        self.phase = "end"
        self.stage = None
        self.cur = None
        self.vote = None
        self.winner = pid
        self.wins[pid] = self.wins.get(pid, 0) + 1
        rest = [p for p in self.alive if p != pid]
        rest.sort(key=lambda p: (-self.lives[p], -self.score[p]))
        self.ranking = [pid] + rest + list(reversed(self.out))
        text = f"🏆 {self._name(pid)} thắng ván {self.game_no}! ({reason} · {self.score[pid]} từ)"
        self.win_reason = reason
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
                "alive": p_id in self.alive,
                "color": self.colors.get(p_id),
                "lives": self.lives.get(p_id, 0),
                "score": self.score.get(p_id, 0),
                "wins": self.wins.get(p_id, 0),
            })
        vote = None
        if self.vote:
            vote = {"pid": self.vote["pid"], "w": self.vote["w"], "voters": self.vote["voters"],
                    "voted": list(self.vote["votes"]), "mine": self.vote["votes"].get(pid)}
        word = None
        if self.word:
            w = DICT.show(self.word)
            word = {"w": w, "last": w.split()[1], "left": len(DICT.nexts(self.word, self.used))}
        return {
            "phase": self.phase,
            "stage": self.stage,
            "gameNo": self.game_no,
            "me": {"id": pid, "host": pid == self.room.host_id, "playing": pid in self.order,
                   "propose": self.propose.get(pid) if pid == self.cur else None},
            "players": players,
            "turn": self.cur,
            "word": word,
            "chain": [{"w": c["w"], "pid": c["pid"]} for c in self.chain[-60:]],
            "used": len(self.used),
            "dictSize": len(DICT),
            "vote": vote,
            "reveal": self.reveal,
            "winner": self.winner,
            "winReason": getattr(self, "win_reason", ""),
            "ranking": self.ranking,
            "deadline": self.deadline,
            "total": self.phase_total,
            "now": time.time(),
            "events": self.events[-15:],
            "config": self.config,
            "choices": {"lives": LIVES, "turn_time": TURN_TIMES, "bot_level": BOT_LEVELS},
            "minPlayers": self.min_players,
            "maxPlayers": self.max_players,
            "startError": self._start_error() if self.phase != "play" else None,
            "chat": self.chat[-150:],
            "log": self.log[-100:],
        }
