"""Liar's Bar (chế độ Liar's Deck) — úp bài, khai gian, bị bắt thì chơi cò quay Nga.

Mỗi ván nhỏ: chia 5 lá, chọn ngẫu nhiên “lá của bàn” (Q/K/A). Đến lượt, úp 1–3 lá
và khai tất cả đều là lá của bàn (Joker thay được mọi lá). Người kế tiếp chọn: đánh
tiếp, hoặc hô “Liar!” để lật bài. Ai sai phải bóp cò khẩu súng 6 ổ có 1 viên đạn
của mình. Người cuối cùng còn sống thắng.
"""
import asyncio
import logging
import random
import time

from core.game_base import BaseGame, GameError
from .bots import LiarBotMixin

log = logging.getLogger("gamehub.liarbar")

TABLE_RANKS = ["Q", "K", "A"]
RANK_NAMES = {"Q": "Q (Đầm)", "K": "K (Già)", "A": "A (Xì)", "J": "Joker"}
DECK = {"Q": 6, "K": 6, "A": 6, "J": 2}
HAND_SIZE = 5
CHAMBERS = 6
TURN_TIMES = (0, 20, 30, 45, 60)
REVEAL_TIME = 4
TRIGGER_TIME = 12
SHOT_TIME = 3.5
OFFLINE_TIME = 4


class LiarBarGame(LiarBotMixin, BaseGame):
    id = "liarbar"
    name = "Liar's Bar"
    icon = "🍺"
    description = "Quán bar của những kẻ nói dối: úp bài và khai gian, ai bị bắt quả tang phải chơi cò quay Nga. Người cuối cùng sống sót thắng."
    min_players = 2
    max_players = 4
    guide = [
        ("🎯 Mục tiêu", "Là người cuối cùng còn sống trong quán bar."),
        ("🃏 Bộ bài", "20 lá: 6 Q, 6 K, 6 A và 2 Joker. Mỗi lượt bài chia mỗi người 5 lá và chọn ngẫu nhiên **lá của bàn** (Q, K hoặc A). **Joker** thay được mọi lá."),
        ("👉 Đến lượt", [
            "**Úp 1–3 lá** và khai rằng tất cả đều là lá của bàn — thật hay bịp tuỳ bạn.",
            "Người kế tiếp chọn: **tin** thì úp bài của mình tiếp, **không tin** thì hô **LIAR!** để lật bài người vừa đánh.",
        ]),
        ("🤥 Lật bài", [
            "Có lá nào không phải lá của bàn (hay Joker) → người vừa đánh **nói dối**, phải chơi cò quay.",
            "Toàn hàng thật → người hô LIAR **bắt oan**, tự mình chơi cò quay.",
        ]),
        ("🔫 Cò quay Nga", "Mỗi người một khẩu súng 6 ổ, 1 viên đạn ở vị trí ngẫu nhiên. Mỗi lần bóp cò lại gần viên đạn hơn (1/6 → 1/5 → … → chắc chắn nổ). Trúng đạn là bị loại."),
        ("🔁 Lượt bài mới", [
            "Sau mỗi lần bóp cò, bài được chia lại với lá của bàn mới; người vừa bóp cò (nếu còn sống) đi trước.",
            "Ai hết bài thì bỏ qua; nếu chỉ còn người hết bài để đáp lại, người đó buộc phải lật bài.",
            "Hết giờ lượt: máy tự úp 1 lá (hoặc tự lật bài nếu đã hết bài).",
        ]),
        ("💡 Mẹo", "Lá có dấu ✓ trên tay bạn là hàng thật. Đếm xem còn bao nhiêu lá hợp lệ để đoán ai đang nói dối! Thiếu người thì thêm bot."),
    ]

    def __init__(self, room):
        super().__init__(room)
        self.config = {"turn_time": 30}
        self.chat = []
        self._msg_id = 0
        self._token = 0
        self._seq = 0
        self._cid = 0
        self.scores = {}
        self.round = 0
        self._reset_game()
        self.phase = "lobby"

    def _reset_game(self):
        self._token += 1
        self.deadline = None
        self.phase_total = None
        self.stage = None
        self.order = []
        self.alive = []
        self.hands = {}
        self.revolvers = {}
        self.table = None
        self.pile = []
        self.last_play = None
        self.cur = 0
        self.hand_no = 0
        self.reveal = None
        self.shot = None
        self.winner = None
        self.events = []
        self.log = []
        self._bots_reset()

    # ------------------------------------------------------------------ tiện ích
    def _name(self, pid):
        p = self.room.players.get(pid)
        return p.name if p else "?"

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
        self.chat.append({
            "id": self._msg_id, "t": time.time(), "channel": channel, "text": text,
            "pid": pid, "name": self._name(pid) if pid else None,
        })
        if len(self.chat) > 300:
            self.chat = self.chat[-300:]

    def _require_host(self, pid):
        if pid != self.room.host_id:
            raise GameError("Chỉ chủ phòng mới làm được việc này.")

    @property
    def current(self):
        return self.order[self.cur] if self.order and self.phase == "play" and self.stage == "turn" else None

    def _next_alive(self, pid, need_cards=False):
        i = self.order.index(pid)
        for k in range(1, len(self.order)):
            q = self.order[(i + k) % len(self.order)]
            if q in self.alive and (not need_cards or self.hands.get(q)):
                return q
        return None

    def _is_valid(self, card):
        return card["r"] in (self.table, "J")

    def _can_call(self, pid):
        return (self.phase == "play" and self.stage == "turn" and pid == self.current
                and self.last_play is not None and self.last_play["pid"] != pid)

    def _must_call(self, pid):
        return self._can_call(pid) and not self.hands.get(pid)

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
            try:
                fn()
            except GameError:
                pass
            except Exception:
                log.exception("Lỗi hẹn giờ Liar's Bar")
            await self.room.broadcast_state()

    def _stop_timer(self):
        self._token += 1
        self.deadline = None
        self.phase_total = None

    def _start_turn_timer(self):
        pid = self.current
        if pid is None:
            return
        if not self._connected(pid):
            self._set_timer(OFFLINE_TIME, self._auto_move)
        elif self.config["turn_time"]:
            self._set_timer(self.config["turn_time"], self._auto_move)
        else:
            self._stop_timer()

    def _auto_move(self):
        pid = self.current
        if pid is None:
            return
        if not self.hands.get(pid):
            self._act_call(pid, {})
        else:
            self._act_play(pid, {"cards": [random.choice(self.hands[pid])["id"]]})

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
        return {"label": f"Đang chơi · Ván {self.round}", "joinable": False}

    async def on_player_join(self, player):
        self._post_chat("system", f"👋 {player.name} bước vào quán bar.")

    async def on_player_removed(self, player):
        self.scores.pop(player.id, None)
        self._post_chat("system", f"🚪 {player.name} đã rời quán.")

    async def on_player_disconnect(self, player):
        self._retime_for(player.id)

    async def on_player_connect(self, player):
        self._retime_for(player.id)

    def _retime_for(self, pid):
        if self.phase != "play":
            return
        if self.stage == "turn" and pid == self.current:
            self._start_turn_timer()
        elif self.stage == "roulette" and self.reveal and self.reveal["shooter"] == pid:
            self._set_timer(TRIGGER_TIME if self._connected(pid) else OFFLINE_TIME, self._pull)

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
        try:
            t = int(data.get("turn_time"))
        except (TypeError, ValueError):
            return
        if t in TURN_TIMES:
            self.config["turn_time"] = t

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
        self.round += 1
        self.phase = "play"
        self.order = self.participants()
        random.shuffle(self.order)
        self.alive = list(self.order)
        for p in self.order:
            self.scores.setdefault(p, 0)
            self.revolvers[p] = {"bullet": random.randint(1, CHAMBERS), "shots": 0}
        self._post_chat("system", f"🍺 Ván {self.round} bắt đầu! Mỗi người một khẩu súng 6 ổ, 1 viên đạn. Chúc may mắn…")
        self._start_hand(self.order[0])

    def _act_next_round(self, pid, data):
        self._act_start(pid, data)

    def _act_lobby(self, pid, data):
        self._require_host(pid)
        if self.phase != "end":
            raise GameError("Không thể làm việc này lúc này.")
        self._reset_game()
        self.phase = "lobby"
        self.scores = {}
        self.round = 0
        self._post_chat("system", "🔁 Quay lại phòng chờ, bảng điểm đã được làm mới.")

    # ------------------------------------------------------------------ một ván nhỏ
    def _start_hand(self, starter):
        deck = []
        for r, n in DECK.items():
            for _ in range(n):
                self._cid += 1
                deck.append({"id": self._cid, "r": r})
        random.shuffle(deck)
        self.hands = {p: [deck.pop() for _ in range(HAND_SIZE)] if p in self.alive else [] for p in self.order}
        self.table = random.choice(TABLE_RANKS)
        self.pile = []
        self.last_play = None
        self.reveal = None
        self.shot = None
        self.hand_no += 1
        self.stage = "turn"
        self.cur = self.order.index(starter)
        self._event("deal", table=self.table)
        self._add_log(f"🃏 Ván nhỏ {self.hand_no}: lá của bàn là {RANK_NAMES[self.table]}. {self._name(starter)} đi trước.", "start")
        self._start_turn_timer()

    def _act_play(self, pid, data):
        if self.phase != "play" or self.stage != "turn":
            raise GameError("Chưa thể đánh bài lúc này.")
        if pid != self.current:
            raise GameError("Chưa đến lượt của bạn.")
        hand = self.hands[pid]
        if not hand:
            raise GameError("Bạn đã hết bài — phải hô Liar!")
        raw = data.get("cards")
        if not isinstance(raw, list) or not 1 <= len(raw) <= 3:
            raise GameError("Hãy chọn từ 1 đến 3 lá.")
        try:
            ids = {int(x) for x in raw}
        except (TypeError, ValueError):
            raise GameError("Lá bài không hợp lệ.")
        cards = [c for c in hand if c["id"] in ids]
        if len(cards) != len(raw):
            raise GameError("Bạn không có những lá bài này.")
        for c in cards:
            hand.remove(c)
        self.pile += cards
        self.last_play = {"pid": pid, "cards": cards}
        n = len(cards)
        self._event("play", pid, n=n)
        self._add_log(f"🂠 {self._name(pid)} úp {n} lá, khai là {n} lá {self.table}.", "play")
        responder = self._next_alive(pid, need_cards=True) or self._next_alive(pid)
        self.cur = self.order.index(responder)
        if not self.hands.get(responder):
            self._add_log(f"🤐 {self._name(responder)} đã hết bài — buộc phải lật bài.")
        self._start_turn_timer()

    def _act_call(self, pid, data):
        if not self._can_call(pid):
            raise GameError("Chưa thể hô Liar! lúc này.")
        lp = self.last_play
        liar = any(not self._is_valid(c) for c in lp["cards"])
        shooter = lp["pid"] if liar else pid
        self.reveal = {"caller": pid, "pid": lp["pid"], "cards": lp["cards"], "liar": liar, "shooter": shooter}
        self.stage = "reveal"
        self._event("call", pid, target=lp["pid"], liar=liar)
        shown = ", ".join(RANK_NAMES[c["r"]] for c in lp["cards"])
        if liar:
            text = f"🤥 {self._name(pid)} hô LIAR! Lật bài: {shown} — {self._name(lp['pid'])} NÓI DỐI!"
        else:
            text = f"😇 {self._name(pid)} hô LIAR! Lật bài: {shown} — {self._name(lp['pid'])} nói THẬT!"
        self._add_log(text, "call")
        self._set_timer(REVEAL_TIME, self._to_roulette)

    def _to_roulette(self):
        self.stage = "roulette"
        shooter = self.reveal["shooter"]
        r = self.revolvers[shooter]
        self._add_log(f"🔫 {self._name(shooter)} phải bóp cò (đã bắn {r['shots']}/{CHAMBERS} ổ).", "roulette")
        self._set_timer(TRIGGER_TIME if self._connected(shooter) else OFFLINE_TIME, self._pull)

    def _act_trigger(self, pid, data):
        if self.phase != "play" or self.stage != "roulette" or self.reveal["shooter"] != pid:
            raise GameError("Chưa đến lúc bóp cò.")
        self._pull()

    def _pull(self):
        if self.stage != "roulette":
            return
        pid = self.reveal["shooter"]
        r = self.revolvers[pid]
        r["shots"] += 1
        dead = r["shots"] >= r["bullet"]
        self.shot = {"pid": pid, "dead": dead, "shots": r["shots"]}
        self.stage = "shot"
        self._event("shot", pid, dead=dead)
        if dead:
            self.alive.remove(pid)
            text = f"💥 ĐOÀNG! {self._name(pid)} đã gục xuống."
            self._post_chat("system", text)
        else:
            text = f"😮‍💨 Cạch… ổ trống! {self._name(pid)} sống sót ({r['shots']}/{CHAMBERS})."
        self._add_log(text, "dead" if dead else "survive")
        self._set_timer(SHOT_TIME, self._after_shot)

    def _after_shot(self):
        if len(self.alive) <= 1:
            self._end_game(self.alive[0] if self.alive else None)
            return
        pid = self.shot["pid"]
        starter = pid if pid in self.alive else self._next_alive(pid)
        self._start_hand(starter)

    def _end_game(self, winner):
        self._stop_timer()
        self.phase = "end"
        self.stage = None
        self.winner = winner
        if winner:
            self.scores[winner] = self.scores.get(winner, 0) + 1
            self._event("win", winner)
            text = f"🏆 {self._name(winner)} là người cuối cùng còn sống và thắng ván {self.round}!"
            self._add_log(text, "end")
            self._post_chat("system", text)

    # ------------------------------------------------------------------ chat
    def _act_chat(self, pid, data):
        text = " ".join(str(data.get("text", "")).split())[:300]
        if text:
            self._post_chat("all", text, pid)

    # ------------------------------------------------------------------ trạng thái
    def view(self, pid):
        in_round = self.phase in ("play", "end")
        seated = self.order if in_round else list(self.room.players.keys())
        players = []
        for p_id in seated + [p for p in self.room.players if p not in seated]:
            p = self.room.players.get(p_id)
            if p is None:
                continue
            playing = p_id in self.revolvers
            players.append({
                "id": p_id,
                "name": p.name,
                "bot": p.is_bot,
                "connected": p.connected,
                "look": p.look,
                "host": p_id == self.room.host_id,
                "playing": playing or not in_round,
                "alive": p_id in self.alive if in_round else True,
                "count": len(self.hands.get(p_id, [])),
                "shots": self.revolvers[p_id]["shots"] if playing else 0,
                "score": self.scores.get(p_id, 0),
            })
        hand = self.hands.get(pid)
        if hand is not None:
            hand = sorted(hand, key=lambda c: ("QKAJ".index(c["r"]), c["id"]))
        show_reveal = self.stage in ("reveal", "roulette", "shot")
        return {
            "phase": self.phase,
            "stage": self.stage,
            "round": self.round,
            "handNo": self.hand_no,
            "me": {"id": pid, "host": pid == self.room.host_id, "playing": pid in self.revolvers,
                   "alive": pid in self.alive if in_round else True},
            "players": players,
            "hand": hand if pid in self.alive else None,
            "table": self.table,
            "pileCount": len(self.pile),
            "lastPlay": {"pid": self.last_play["pid"], "count": len(self.last_play["cards"])} if self.last_play else None,
            "turn": self.current,
            "canCall": self._can_call(pid),
            "mustCall": self._must_call(pid),
            "reveal": self.reveal if show_reveal else None,
            "shot": self.shot if self.stage == "shot" else None,
            "chambers": CHAMBERS,
            "deadline": self.deadline,
            "total": self.phase_total,
            "now": time.time(),
            "winner": self.winner,
            "events": self.events[-12:],
            "config": self.config,
            "turnTimes": TURN_TIMES,
            "rankNames": RANK_NAMES,
            "minPlayers": self.min_players,
            "maxPlayers": self.max_players,
            "startError": self._start_error() if self.phase != "play" else None,
            "chat": self.chat[-150:],
            "log": self.log[-100:],
        }
