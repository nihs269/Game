"""UNO — đánh bài cùng màu hoặc cùng số, ai hết bài trước thì thắng ván."""
import asyncio
import logging
import random
import time
from collections import Counter

from core.game_base import BaseGame, GameError
from .bots import UnoBotMixin

log = logging.getLogger("gamehub.uno")

COLORS = ["r", "y", "g", "b"]
COLOR_NAMES = {"r": "Đỏ", "y": "Vàng", "g": "Xanh lá", "b": "Xanh dương"}
ACTIONS = ("skip", "rev", "d2")
VALUE_NAMES = {"skip": "Cấm lượt", "rev": "Đảo chiều", "d2": "+2", "wild": "Đổi màu", "w4": "+4"}
TURN_TIMES = (0, 10, 15, 20, 30, 45, 60)
HAND_SIZE = 7
OFFLINE_TURN = 5       # giây chờ người chơi mất kết nối trước khi tự đánh hộ
AFTER_DRAW_TIME = 10   # ít nhất bấy nhiêu giây để quyết định đánh lá vừa rút


def card_points(card):
    if card["c"] == "w":
        return 50
    if card["v"] in ACTIONS:
        return 20
    return int(card["v"])


def card_label(card, color=None):
    if card["c"] == "w":
        text = VALUE_NAMES[card["v"]]
        return f"{text} ({COLOR_NAMES[color]})" if color else text
    return f"{VALUE_NAMES.get(card['v'], card['v'])} {COLOR_NAMES[card['c']]}"


def new_deck():
    cards = []
    for c in COLORS:
        cards.append({"c": c, "v": "0"})
        for v in [str(n) for n in range(1, 10)] + list(ACTIONS):
            cards += [{"c": c, "v": v}, {"c": c, "v": v}]
    cards += [{"c": "w", "v": "wild"} for _ in range(4)] + [{"c": "w", "v": "w4"} for _ in range(4)]
    for i, card in enumerate(cards):
        card["id"] = i
    random.shuffle(cards)
    return cards


class UnoGame(UnoBotMixin, BaseGame):
    id = "uno"
    name = "UNO"
    icon = "🃏"
    description = "Đánh bài cùng màu hoặc cùng số, dùng lá chức năng để chặn đối thủ. Còn 1 lá nhớ hô “UNO!”."
    min_players = 2
    max_players = 10
    guide = [
        ("🎯 Mục tiêu", "Là người đầu tiên đánh hết bài trên tay. Người thắng ván được cộng điểm từ bài còn lại của những người khác."),
        ("🃏 Bộ bài & chia bài", "Bộ 108 lá chuẩn (4 màu Đỏ, Vàng, Xanh lá, Xanh dương + lá Đổi màu, +4). Mỗi người 7 lá, lật 1 lá làm lá đầu tiên trên bàn."),
        ("👉 Đến lượt", [
            "Đánh 1 lá **cùng màu** hoặc **cùng số/ký hiệu** với lá trên bàn, hoặc lá **Đổi màu / +4** (đánh lúc nào cũng được).",
            "Không đánh được thì **rút 1 lá** — lá vừa rút đánh được thì đánh luôn, không thì bỏ lượt.",
        ]),
        ("⚡ Lá chức năng", [
            "⊘ **Cấm lượt** — người kế tiếp mất lượt.",
            "⇄ **Đảo chiều** — đổi chiều chơi (2 người thì như Cấm lượt).",
            "**+2** — người kế tiếp rút 2 lá và mất lượt.",
            "**Đổi màu** — chọn màu mới.",
            "**+4** — chọn màu mới, người kế tiếp rút 4 lá và mất lượt.",
        ]),
        ("📣 Hô UNO!", "Khi đánh lá áp chót (còn 1 lá) phải bấm **UNO!**. Quên hô mà bị người khác bấm **Bắt lỗi** trước khi người kế tiếp đánh → phạt rút 2 lá."),
        ("🏆 Tính điểm", [
            "Lá số = đúng số điểm, lá chức năng = 20, Đổi màu / +4 = 50.",
            "Chủ phòng bấm **Ván tiếp theo** để chơi tiếp, điểm được cộng dồn.",
        ]),
        ("⚙️ Luật tuỳ chọn (chủ phòng chỉnh)", [
            "Thời gian mỗi lượt — hết giờ tự rút & bỏ lượt.",
            "**Cộng dồn +2/+4** — bị phạt có thể đánh tiếp +2/+4 để đẩy cho người sau.",
            "**Rút tới khi đánh được** — thay vì chỉ rút 1 lá.",
        ]),
        ("🤖 Bot & rớt mạng", "Thiếu người thì thêm bot ở phòng chờ. Người mất kết nối đến lượt sẽ được máy tự rút & bỏ lượt sau 5 giây; vào lại bằng đúng tên cũ để chơi tiếp."),
    ]

    def __init__(self, room):
        super().__init__(room)
        self.config = {"turn_time": 30, "stacking": True, "draw_until_play": False}
        self.chat = []
        self._msg_id = 0
        self._token = 0
        self._seq = 0  # tăng liên tục qua các ván để client không bỏ sót hiệu ứng
        self.scores = {}
        self.round = 0
        self._reset_round()
        self.phase = "lobby"

    def _reset_round(self):
        self._token += 1
        self.deadline = None
        self.phase_total = None
        self.order = []
        self.hands = {}
        self.deck = []
        self.discard = []
        self.color = None
        self.turn = 0
        self.direction = 1
        self.pending = 0
        self.drawn = None          # id lá vừa rút (được đánh ngay hoặc bỏ lượt)
        self.uno_said = set()      # đã hô UNO trước khi đánh lá áp chót
        self.uno_pending = None    # còn 1 lá mà chưa hô — người khác có thể bắt lỗi
        self.winner = None
        self.round_points = 0
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
        return self.order[self.turn] if self.order else None

    @property
    def top(self):
        return self.discard[-1] if self.discard else None

    def _next_index(self, steps=1):
        return (self.turn + self.direction * steps) % len(self.order)

    def _playable(self, pid, card):
        top = self.top
        if self.pending:
            if not self.config["stacking"]:
                return False
            return card["v"] == "w4" or (card["v"] == "d2" and top["v"] == "d2")
        if self.drawn is not None and card["id"] != self.drawn:
            return False
        return card["c"] == "w" or card["c"] == self.color or card["v"] == top["v"]

    def _playable_ids(self, pid):
        if self.phase != "play" or pid != self.current:
            return []
        return [c["id"] for c in self.hands.get(pid, []) if self._playable(pid, c)]

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
            except Exception:
                log.exception("Lỗi hẹn giờ UNO")
            await self.room.broadcast_state()

    def _stop_timer(self):
        self._token += 1
        self.deadline = None
        self.phase_total = None

    def _start_turn_timer(self, extend=False):
        pid = self.current
        limit = self.config["turn_time"]
        if not self._connected(pid):
            seconds = OFFLINE_TURN
        elif limit:
            seconds = limit
        else:
            self._stop_timer()
            return
        if extend and self.deadline:
            seconds = max(self.deadline - time.time(), min(seconds, AFTER_DRAW_TIME))
        self._set_timer(seconds, self._auto_move)

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
        return {"label": f"Đang chơi · Ván {self.round}", "joinable": False}

    async def on_player_join(self, player):
        self._post_chat("system", f"👋 {player.name} đã vào phòng.")

    async def on_player_removed(self, player):
        self.scores.pop(player.id, None)
        self._post_chat("system", f"🚪 {player.name} đã rời phòng.")

    async def on_player_disconnect(self, player):
        if self.phase == "play" and player.id == self.current:
            self._start_turn_timer()

    async def on_player_connect(self, player):
        if self.phase == "play" and player.id == self.current and self.deadline:
            self._start_turn_timer()

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
        if "turn_time" in data:
            try:
                t = int(data["turn_time"])
            except (TypeError, ValueError):
                t = None
            if t in TURN_TIMES:
                self.config["turn_time"] = t
        for key in ("stacking", "draw_until_play"):
            if key in data:
                self.config[key] = bool(data[key])

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
        self._deal()

    def _act_lobby(self, pid, data):
        """Về phòng chờ và xoá bảng điểm."""
        self._require_host(pid)
        if self.phase != "end":
            raise GameError("Không thể làm việc này lúc này.")
        self._reset_round()
        self.phase = "lobby"
        self.scores = {}
        self.round = 0
        self._post_chat("system", "🔁 Quay lại phòng chờ, bảng điểm đã được làm mới.")

    def _deal(self):
        self._reset_round()
        self.round += 1
        self.phase = "play"
        self.order = self.participants()
        random.shuffle(self.order)
        for p in self.order:
            self.scores.setdefault(p, 0)
        self.deck = new_deck()
        for p in self.order:
            self.hands[p] = [self.deck.pop() for _ in range(HAND_SIZE)]
        # lá mở đầu phải là lá số
        while not self.deck[-1]["v"].isdigit():
            self.deck.insert(0, self.deck.pop())
        first = self.deck.pop()
        self.discard = [first]
        self.color = first["c"]
        self.turn = 0
        self._add_log(f"🎬 Ván {self.round} bắt đầu với {len(self.order)} người. Lá mở đầu: {card_label(first)}.", "start")
        self._post_chat("system", f"🎬 Ván {self.round} bắt đầu! {self._name(self.current)} đánh trước.")
        self._event("deal")
        self._start_turn_timer()

    # ------------------------------------------------------------------ rút bài
    def _draw_cards(self, pid, n):
        got = []
        for _ in range(n):
            if not self.deck:
                if len(self.discard) <= 1:
                    break
                top = self.discard.pop()
                self.deck = self.discard
                random.shuffle(self.deck)
                self.discard = [top]
                self._add_log("🔄 Hết bài — xào lại chồng bài đã đánh.")
            card = self.deck.pop()
            self.hands[pid].append(card)
            got.append(card)
        if got:
            self._event("draw", pid, n=len(got))
        if self.uno_pending == pid and len(self.hands[pid]) != 1:
            self.uno_pending = None
        self.uno_said.discard(pid)
        return got

    def _close_uno_window(self, pid):
        """Người kế tiếp đã hành động → hết cơ hội bắt lỗi quên hô UNO."""
        if self.uno_pending is not None and self.uno_pending != pid:
            self.uno_pending = None

    def _require_turn(self, pid):
        if self.phase != "play":
            raise GameError("Ván đấu chưa bắt đầu.")
        if pid != self.current:
            raise GameError("Chưa đến lượt của bạn.")

    def _act_draw(self, pid, data):
        self._require_turn(pid)
        if self.drawn is not None:
            raise GameError("Bạn đã rút bài rồi — hãy đánh lá vừa rút hoặc bỏ lượt.")
        self._close_uno_window(pid)
        if self.pending:
            n = self.pending
            self.pending = 0
            got = self._draw_cards(pid, n)
            self._add_log(f"😵 {self._name(pid)} phải rút {len(got)} lá và mất lượt.", "draw")
            self._advance(1)
            return
        if self.config["draw_until_play"]:
            got = []
            while True:
                more = self._draw_cards(pid, 1)
                got += more
                if not more or self._playable(pid, more[0]):
                    break
        else:
            got = self._draw_cards(pid, 1)
        self._add_log(f"🂠 {self._name(pid)} rút {len(got)} lá.", "draw")
        last = got[-1] if got else None
        if last and self._playable(pid, last):
            self.drawn = last["id"]
            self._start_turn_timer(extend=True)
        else:
            self._advance(1)

    def _act_pass(self, pid, data):
        self._require_turn(pid)
        if self.drawn is None:
            raise GameError("Phải rút bài trước khi bỏ lượt.")
        self._add_log(f"⏭ {self._name(pid)} bỏ lượt.")
        self._advance(1)

    # ------------------------------------------------------------------ đánh bài
    def _act_play(self, pid, data):
        self._require_turn(pid)
        hand = self.hands[pid]
        try:
            cid = int(data.get("card"))
        except (TypeError, ValueError):
            raise GameError("Lá bài không hợp lệ.")
        card = next((c for c in hand if c["id"] == cid), None)
        if card is None:
            raise GameError("Bạn không có lá bài này.")
        if not self._playable(pid, card):
            if self.pending:
                raise GameError(f"Bạn phải chồng thêm lá +2/+4 hoặc rút {self.pending} lá.")
            raise GameError("Lá này không hợp màu hoặc số với lá trên bàn.")
        color = card["c"]
        if color == "w":
            color = data.get("color")
            if color not in COLORS:
                raise GameError("Hãy chọn màu cho lá đổi màu.")
        self._close_uno_window(pid)

        hand.remove(card)
        self.discard.append(card)
        self.color = color
        self.drawn = None
        self._event("play", pid, card=card, color=color)
        self._add_log(f"🃏 {self._name(pid)} đánh {card_label(card, color if card['c'] == 'w' else None)}.", "play")

        if len(hand) == 1:
            if pid in self.uno_said:
                self._event("uno", pid)
                self._add_log(f"📣 {self._name(pid)} hô UNO!", "uno")
            else:
                self.uno_pending = pid
        self.uno_said.discard(pid)

        v = card["v"]
        n = len(self.order)
        if v in ("d2", "w4"):
            self.pending += 2 if v == "d2" else 4
            if not self.config["stacking"] or not hand:
                victim = self.order[self._next_index(1)]
                amount, self.pending = self.pending, 0
                got = self._draw_cards(victim, amount)
                self._add_log(f"😵 {self._name(victim)} phải rút {len(got)} lá và mất lượt.", "draw")
                self._event("skip", victim)
                steps = 2
            else:
                steps = 1
        elif v == "skip":
            victim = self.order[self._next_index(1)]
            self._event("skip", victim)
            self._add_log(f"⛔ {self._name(victim)} bị cấm lượt.")
            steps = 2
        elif v == "rev":
            if n == 2:
                self._event("skip", self.order[self._next_index(1)])
                steps = 2
            else:
                self.direction *= -1
                self._event("reverse", pid)
                self._add_log("🔁 Đảo chiều vòng chơi.")
                steps = 1
        else:
            steps = 1

        if not hand:
            self._end_round(pid)
            return
        self._advance(steps)

    def _advance(self, steps):
        self.drawn = None
        self.turn = self._next_index(steps)
        self._start_turn_timer()

    def _auto_move(self):
        """Hết giờ (hoặc người chơi mất kết nối): tự rút bài rồi bỏ lượt."""
        if self.phase != "play":
            return
        pid = self.current
        if self.drawn is None:
            self._act_draw(pid, {})
        if self.phase == "play" and self.current == pid and self.drawn is not None:
            self._act_pass(pid, {})

    # ------------------------------------------------------------------ UNO!
    def _act_uno(self, pid, data):
        if self.phase != "play":
            raise GameError("Ván đấu chưa bắt đầu.")
        hand = self.hands.get(pid, [])
        if self.uno_pending == pid:
            self.uno_pending = None
        elif pid == self.current and len(hand) == 2:
            if pid not in self.uno_said:
                self.uno_said.add(pid)
                self._event("uno", pid, early=True)
            return
        else:
            raise GameError("Chỉ hô UNO khi bạn sắp còn (hoặc đang còn) 1 lá.")
        self._event("uno", pid)
        self._add_log(f"📣 {self._name(pid)} hô UNO!", "uno")

    def _act_catch(self, pid, data):
        if self.phase != "play":
            raise GameError("Ván đấu chưa bắt đầu.")
        target = self.uno_pending
        if target is None or target == pid or pid not in self.order:
            raise GameError("Không có ai để bắt lỗi.")
        self.uno_pending = None
        self._draw_cards(target, 2)
        self._event("catch", pid, target=target)
        text = f"🚨 {self._name(pid)} bắt lỗi {self._name(target)} quên hô UNO — phạt rút 2 lá!"
        self._add_log(text, "catch")
        self._post_chat("system", text)

    # ------------------------------------------------------------------ kết thúc ván
    def _end_round(self, winner):
        self._stop_timer()
        self.phase = "end"
        self.winner = winner
        self.uno_pending = None
        points = sum(card_points(c) for p, h in self.hands.items() if p != winner for c in h)
        self.round_points = points
        self.scores[winner] = self.scores.get(winner, 0) + points
        text = f"🏆 {self._name(winner)} đã hết bài và thắng ván {self.round}! (+{points} điểm)"
        self._event("win", winner, points=points)
        self._add_log(text, "end")
        self._post_chat("system", text)

    def _act_next_round(self, pid, data):
        self._require_host(pid)
        if self.phase != "end":
            raise GameError("Ván đấu chưa kết thúc.")
        if len(self.room.players) < self.min_players:
            raise GameError(self._start_error())
        self._deal()

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
            playing = p_id in self.hands
            players.append({
                "id": p_id,
                "name": p.name,
                "bot": p.is_bot,
                "connected": p.connected,
                "look": p.look,
                "host": p_id == self.room.host_id,
                "playing": playing or not in_round,
                "count": len(self.hands[p_id]) if playing else 0,
                "score": self.scores.get(p_id, 0),
                "hand": self.hands[p_id] if playing and self.phase == "end" else None,
            })
        hand = self.hands.get(pid)
        if hand is not None:
            hand = sorted(hand, key=lambda c: ("rygbw".index(c["c"]), c["v"]))
        return {
            "phase": self.phase,
            "round": self.round,
            "me": {"id": pid, "host": pid == self.room.host_id, "playing": pid in self.hands},
            "players": players,
            "hand": hand,
            "playable": self._playable_ids(pid),
            "top": self.top,
            "color": self.color,
            "direction": self.direction,
            "pending": self.pending,
            "turn": self.current if self.phase == "play" else None,
            "drawn": self.drawn if pid == self.current else None,
            "unoSaid": pid in self.uno_said,
            "unoPending": self.uno_pending,
            "deckCount": len(self.deck),
            "deadline": self.deadline,
            "total": self.phase_total,
            "now": time.time(),
            "winner": self.winner,
            "roundPoints": self.round_points,
            "events": self.events[-12:],
            "config": self.config,
            "turnTimes": TURN_TIMES,
            "minPlayers": self.min_players,
            "maxPlayers": self.max_players,
            "startError": self._start_error() if self.phase != "play" else None,
            "chat": self.chat[-150:],
            "log": self.log[-100:],
        }
