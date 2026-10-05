"""Mèo Nổ (Exploding Kittens) — ai rút phải Mèo Nổ mà không có Gỡ Bom thì bị loại.

Mỗi lượt: đánh bao nhiêu lá tuỳ thích, rồi kết thúc lượt bằng cách rút 1 lá.
Người cuối cùng còn sống thắng. Mọi hành động (trừ Gỡ Bom) đều có thể bị chặn
bằng lá “Không!” trong vài giây sau khi đánh — và “Không!” cũng chặn được “Không!”.
"""
import asyncio
import logging
import random
import time

from core.game_base import BaseGame, GameError
from .bots import MeoNoBotMixin

log = logging.getLogger("gamehub.meono")

CARDS = {
    "kitten": {"name": "Mèo Nổ", "icon": "💣", "kind": "bomb",
               "desc": "Rút phải lá này mà không có Gỡ Bom thì bạn NỔ TUNG và bị loại."},
    "defuse": {"name": "Gỡ Bom", "icon": "🧯", "kind": "defuse",
               "desc": "Tự động dùng khi rút phải Mèo Nổ. Sau đó bạn bí mật nhét Mèo Nổ lại vào chồng bài, ở vị trí tuỳ chọn."},
    "attack": {"name": "Tấn Công", "icon": "⚔️", "kind": "action",
               "desc": "Kết thúc lượt mà không rút bài; người kế tiếp phải chơi 2 lượt. Bị tấn công mà tấn công lại thì người sau phải chơi số lượt còn lại + 2."},
    "skip": {"name": "Bỏ Lượt", "icon": "🏃", "kind": "action",
             "desc": "Kết thúc 1 lượt mà không phải rút bài."},
    "favor": {"name": "Xin Xỏ", "icon": "🙏", "kind": "action",
              "desc": "Chọn 1 người — người đó phải tự chọn 1 lá trên tay đưa cho bạn."},
    "shuffle": {"name": "Xáo Bài", "icon": "🔀", "kind": "action",
                "desc": "Xáo trộn chồng bài rút."},
    "future": {"name": "Tiên Tri", "icon": "🔮", "kind": "action",
               "desc": "Bí mật xem 3 lá trên cùng của chồng bài."},
    "nope": {"name": "Không!", "icon": "🚫", "kind": "nope",
             "desc": "Chặn một hành động vừa đánh (trừ Gỡ Bom). Có thể dùng bất cứ lúc nào, kể cả để chặn một lá Không! khác."},
    "taco": {"name": "Mèo Taco", "icon": "🌮", "kind": "cat",
             "desc": "Lá mèo: đánh 1 đôi để rút ngẫu nhiên 1 lá của người khác, bộ 3 để đòi đích danh 1 lá."},
    "melon": {"name": "Mèo Dưa Hấu", "icon": "🍉", "kind": "cat",
              "desc": "Lá mèo: đánh 1 đôi để rút ngẫu nhiên 1 lá của người khác, bộ 3 để đòi đích danh 1 lá."},
    "potato": {"name": "Mèo Khoai Tây", "icon": "🥔", "kind": "cat",
               "desc": "Lá mèo: đánh 1 đôi để rút ngẫu nhiên 1 lá của người khác, bộ 3 để đòi đích danh 1 lá."},
    "beard": {"name": "Mèo Râu Xồm", "icon": "🧔", "kind": "cat",
              "desc": "Lá mèo: đánh 1 đôi để rút ngẫu nhiên 1 lá của người khác, bộ 3 để đòi đích danh 1 lá."},
    "rainbow": {"name": "Mèo Cầu Vồng", "icon": "🌈", "kind": "cat",
                "desc": "Lá mèo: đánh 1 đôi để rút ngẫu nhiên 1 lá của người khác, bộ 3 để đòi đích danh 1 lá."},
}
# Dòng tóm tắt in trên mặt lá + nhãn phân loại cho giao diện
CARD_SHORT = {
    "kitten": ("Bom", "Rút phải là nổ!"),
    "defuse": ("Bảo mệnh", "Cứu bạn khỏi Mèo Nổ"),
    "attack": ("Hành động", "Người sau chơi 2 lượt"),
    "skip": ("Hành động", "Hết lượt, khỏi rút"),
    "favor": ("Hành động", "Bắt 1 người cho bài"),
    "shuffle": ("Hành động", "Xáo chồng bài"),
    "future": ("Hành động", "Xem 3 lá trên cùng"),
    "nope": ("Chặn", "Huỷ 1 lá vừa đánh"),
}
for _t, _c in CARDS.items():
    _c["tag"], _c["short"] = CARD_SHORT.get(_t, ("Mèo", "Gom đôi để cướp bài"))
CARD_ORDER = list(CARDS)
CATS = [t for t, c in CARDS.items() if c["kind"] == "cat"]
BASE_COUNTS = {"attack": 4, "skip": 4, "favor": 4, "shuffle": 4, "future": 5, "nope": 5,
               **{c: 4 for c in CATS}}
ACTION_NAMES = {"attack": "Tấn Công", "skip": "Bỏ Lượt", "favor": "Xin Xỏ", "shuffle": "Xáo Bài",
                "future": "Tiên Tri", "pair": "đôi mèo", "triple": "bộ ba mèo"}

TURN_TIMES = (0, 30, 45, 60, 90, 120)
NOPE_TIMES = (3, 4, 5, 7)
HAND_SIZE = 7
FAVOR_TIME = 20
DEFUSE_TIME = 20
OFFLINE_TIME = 5


class MeoNoGame(MeoNoBotMixin, BaseGame):
    id = "meono"
    name = "Mèo Nổ"
    icon = "💣"
    description = "Rút bài né Mèo Nổ! Dùng Tấn Công, Bỏ Lượt, Tiên Tri, Không!… để sống sót. Người cuối cùng còn lại thắng."
    min_players = 2
    max_players = 10
    guide = [
        ("🎯 Mục tiêu", "Tránh rút phải 💣 **Mèo Nổ**. Ai rút phải mà không có Gỡ Bom thì nổ tung và bị loại — người cuối cùng còn sống thắng."),
        ("🃏 Chia bài", "Mỗi người 7 lá + 1 🧯 Gỡ Bom. Chồng bài có (số người − 1) quả Mèo Nổ. Từ 6 người trở lên dùng gấp đôi bộ bài."),
        ("👉 Đến lượt", [
            "Đánh **bao nhiêu lá tuỳ thích** (hoặc không đánh lá nào).",
            "Kết thúc lượt bằng cách **rút 1 lá** từ chồng bài.",
        ]),
        ("🃏 Các lá bài", [
            "🧯 **Gỡ Bom** — tự dùng khi rút phải Mèo Nổ, rồi bí mật nhét bom lại vào chồng bài ở vị trí tuỳ chọn.",
            "⚔️ **Tấn Công** — hết lượt không cần rút; người sau phải chơi 2 lượt (bị tấn công mà tấn công lại → số lượt còn lại + 2).",
            "🏃 **Bỏ Lượt** — kết thúc 1 lượt mà không cần rút.",
            "🙏 **Xin Xỏ** — một người phải tự chọn 1 lá đưa cho bạn.",
            "🔀 **Xáo Bài** — xáo lại chồng bài.",
            "🔮 **Tiên Tri** — bí mật xem 3 lá trên cùng.",
            "🚫 **Không!** — chặn hành động vừa đánh, kể cả chặn một lá Không! khác (có vài giây để chặn).",
            "🌮🍉🥔🧔🌈 **Lá mèo** — không có tác dụng riêng. Đánh **đôi** giống nhau: rút ngẫu nhiên 1 lá của người khác; **bộ ba**: đòi đích danh 1 lá.",
        ]),
        ("💡 Mẹo", [
            "Thông tin bí mật (rút được gì, 3 lá Tiên Tri…) hiện trong tab Diễn biến với dấu 🔒.",
            "Giữ Gỡ Bom thật kỹ! Dùng Tiên Tri trước khi rút để biết lá trên cùng có phải bom không.",
            "Chủ phòng chỉnh thời gian mỗi lượt (hết giờ tự rút bài) và thời gian chờ chặn. Thiếu người thì thêm bot.",
        ]),
    ]

    def __init__(self, room):
        super().__init__(room)
        self.config = {"turn_time": 60, "nope_time": 4}
        self.chat = []
        self._msg_id = 0
        self._token = 0
        self._seq = 0
        self._cid = 0
        self.scores = {}
        self.round = 0
        self._reset_round()
        self.phase = "lobby"

    def _reset_round(self):
        self._token += 1
        self.deadline = None
        self.phase_total = None
        self.timer_kind = None
        self.order = []
        self.alive = []
        self.hands = {}
        self.deck = []          # deck[0] là lá trên cùng
        self.discard = []
        self.cur = 0
        self.turns_left = 1
        self.turn_no = 0
        self.wait = None        # nope / favor / defuse đang chờ
        self.deck_ver = 0       # đổi khi chồng bài bị xáo / nhét bài vào
        self.knowledge = {}     # pid -> {"ver", "cards"} biết trước các lá trên cùng
        self.private = {}
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

    def _tell(self, pid, text, kind="private"):
        box = self.private.setdefault(pid, [])
        box.append({"t": time.time(), "text": text, "kind": kind})
        if len(box) > 60:
            del box[:-60]

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
        return self.order[self.cur] if self.order and self.phase == "play" else None

    def _new_card(self, t):
        self._cid += 1
        return {"id": self._cid, "t": t}

    def _label(self, t):
        return f"{CARDS[t]['icon']} {CARDS[t]['name']}"

    def _find(self, pid, t):
        return next((c for c in self.hands.get(pid, []) if c["t"] == t), None)

    def _next_alive(self, pid):
        i = self.order.index(pid)
        for k in range(1, len(self.order) + 1):
            q = self.order[(i + k) % len(self.order)]
            if q in self.alive:
                return q
        return pid

    def _future(self, pid):
        k = self.knowledge.get(pid)
        if k and k["ver"] == self.deck_ver and k["cards"]:
            return k["cards"]
        return None

    # ------------------------------------------------------------------ hẹn giờ
    def _set_timer(self, seconds, fn, kind):
        self._token += 1
        token = self._token
        self.timer_kind = kind
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
                log.exception("Lỗi hẹn giờ Mèo Nổ")
            await self.room.broadcast_state()

    def _stop_timer(self):
        self._token += 1
        self.deadline = None
        self.phase_total = None
        self.timer_kind = None

    def _start_turn_timer(self):
        if self.phase != "play" or self.wait is not None:
            return
        pid = self.current
        if not self._connected(pid):
            self._set_timer(OFFLINE_TIME, self._auto_draw, "turn")
        elif self.config["turn_time"]:
            self._set_timer(self.config["turn_time"], self._auto_draw, "turn")
        else:
            self._stop_timer()

    def _auto_draw(self):
        if self.phase == "play" and self.wait is None:
            self._act_draw(self.current, {})

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
        self._post_chat("system", f"👋 {player.name} đã vào phòng.")

    async def on_player_removed(self, player):
        self.scores.pop(player.id, None)
        self._post_chat("system", f"🚪 {player.name} đã rời phòng.")

    async def on_player_disconnect(self, player):
        self._retime_for(player.id)

    async def on_player_connect(self, player):
        self._retime_for(player.id)

    def _retime_for(self, pid):
        """Người đang được chờ vừa mất/có lại kết nối → đặt lại đồng hồ."""
        if self.phase != "play":
            return
        w = self.wait
        if w is None:
            if pid == self.current:
                self._start_turn_timer()
        elif w["kind"] == "favor" and w["target"] == pid:
            self._set_timer(FAVOR_TIME if self._connected(pid) else OFFLINE_TIME, self._favor_timeout, "favor")
        elif w["kind"] == "defuse" and w["pid"] == pid:
            self._set_timer(DEFUSE_TIME if self._connected(pid) else OFFLINE_TIME, self._defuse_timeout, "defuse")

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
        for key, allowed in (("turn_time", TURN_TIMES), ("nope_time", NOPE_TIMES)):
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
        self._deal()

    def _act_next_round(self, pid, data):
        self._act_start(pid, data)

    def _act_lobby(self, pid, data):
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
        self.alive = list(self.order)
        n = len(self.order)
        mult = 1 if n <= 5 else 2
        for p in self.order:
            self.scores.setdefault(p, 0)
        pool = [self._new_card(t) for t, c in BASE_COUNTS.items() for _ in range(c * mult)]
        random.shuffle(pool)
        for p in self.order:
            self.hands[p] = [pool.pop() for _ in range(HAND_SIZE)] + [self._new_card("defuse")]
        extra_defuse = min(2, 6 * mult - n)
        pool += [self._new_card("kitten") for _ in range(n - 1)]
        pool += [self._new_card("defuse") for _ in range(extra_defuse)]
        random.shuffle(pool)
        self.deck = pool
        self.cur = 0
        self.turns_left = 1
        self.turn_no = 1
        self._add_log(f"🎬 Ván {self.round}: {n} người, {n - 1} Mèo Nổ trong chồng {len(self.deck)} lá.", "start")
        self._post_chat("system", f"🎬 Ván {self.round} bắt đầu! {self._name(self.current)} đi trước.")
        self._event("deal")
        self._start_turn_timer()

    # ------------------------------------------------------------------ lượt chơi
    def _require_turn(self, pid):
        if self.phase != "play":
            raise GameError("Ván đấu chưa bắt đầu.")
        if self.wait is not None:
            raise GameError("Hãy chờ hành động hiện tại được xử lý xong.")
        if pid != self.current:
            raise GameError("Chưa đến lượt của bạn.")

    def _end_turn(self):
        """Hết một lượt (đã rút bài / bỏ lượt)."""
        self.turns_left -= 1
        if self.turns_left <= 0:
            self._next_turn(1)
        else:
            self.turn_no += 1
            self._start_turn_timer()

    def _next_turn(self, turns):
        nxt = self._next_alive(self.current)
        self.cur = self.order.index(nxt)
        self.turns_left = turns
        self.turn_no += 1
        if turns > 1:
            self._add_log(f"⚔️ {self._name(nxt)} phải chơi {turns} lượt liên tiếp.", "attack")
        self._start_turn_timer()

    def _pick_target(self, pid, data):
        target = str(data.get("target", ""))
        if target not in self.alive or target == pid:
            raise GameError("Hãy chọn một người chơi khác còn sống.")
        if not self.hands.get(target):
            raise GameError(f"{self._name(target)} không còn lá bài nào.")
        return target

    def _act_play(self, pid, data):
        self._require_turn(pid)
        raw = data.get("cards")
        if not isinstance(raw, list) or not 1 <= len(raw) <= 3:
            raise GameError("Hãy chọn 1 lá chức năng, hoặc 2–3 lá mèo giống nhau.")
        try:
            ids = {int(x) for x in raw}
        except (TypeError, ValueError):
            raise GameError("Lá bài không hợp lệ.")
        hand = self.hands[pid]
        cards = [c for c in hand if c["id"] in ids]
        if len(cards) != len(raw):
            raise GameError("Bạn không có những lá bài này.")
        types = {c["t"] for c in cards}
        t = cards[0]["t"]
        target = name = None
        if len(cards) == 1:
            if t in ("attack", "skip", "shuffle", "future"):
                action = t
            elif t == "favor":
                action = "favor"
                target = self._pick_target(pid, data)
            elif t == "nope":
                raise GameError("Lá Không! dùng để chặn hành động vừa được đánh.")
            elif t == "defuse":
                raise GameError("Gỡ Bom sẽ tự động dùng khi bạn rút phải Mèo Nổ.")
            else:
                raise GameError("Lá mèo phải đánh theo đôi hoặc bộ ba giống nhau.")
        else:
            if len(types) != 1 or t not in CATS:
                raise GameError("Chỉ đánh được đôi / bộ ba lá mèo giống hệt nhau.")
            target = self._pick_target(pid, data)
            if len(cards) == 2:
                action = "pair"
            else:
                action = "triple"
                name = data.get("name")
                if name not in CARDS or name == "kitten":
                    raise GameError("Hãy chọn tên lá bài muốn đòi.")
        for c in cards:
            hand.remove(c)
            self.discard.append(c)
        self.wait = {"kind": "nope", "pid": pid, "action": action, "target": target, "name": name,
                     "cards": cards, "nopes": 0, "nopers": [], "seq": self._seq + 1}
        self._event("play", pid, cards=cards, target=target)
        text = f"{self._label(t)}" if len(cards) == 1 else f"{len(cards)} × {self._label(t)}"
        extra = ""
        if action == "triple":
            extra = f" và đòi {self._name(target)} lá {self._label(name)}"
        elif target:
            extra = f" vào {self._name(target)}"
        self._add_log(f"🃏 {self._name(pid)} đánh {text}{extra}.", "play")
        self._set_timer(self.config["nope_time"], self._resolve, "nope")

    def _act_nope(self, pid, data):
        w = self.wait
        if self.phase != "play" or w is None or w["kind"] != "nope":
            raise GameError("Không có hành động nào để chặn.")
        if pid not in self.alive:
            raise GameError("Bạn đã bị loại.")
        card = self._find(pid, "nope")
        if card is None:
            raise GameError("Bạn không có lá Không!")
        self.hands[pid].remove(card)
        self.discard.append(card)
        w["nopes"] += 1
        w["nopers"].append(pid)
        self._event("nope", pid, card=card, nopes=w["nopes"])
        state = "CHẶN" if w["nopes"] % 2 else "GỠ CHẶN cho"
        self._add_log(f"🚫 {self._name(pid)} đánh Không! — {state} {ACTION_NAMES[w['action']]} của {self._name(w['pid'])}.", "nope")
        self._set_timer(self.config["nope_time"], self._resolve, "nope")

    def _resolve(self):
        w, self.wait = self.wait, None
        if w is None or w["kind"] != "nope":
            return
        pid, action, target = w["pid"], w["action"], w["target"]
        if w["nopes"] % 2:
            self._event("blocked", pid)
            self._add_log(f"❌ {ACTION_NAMES[action]} của {self._name(pid)} đã bị chặn.", "nope")
            self._start_turn_timer()
            return
        if action == "attack":
            turns = (self.turns_left if self.turns_left > 1 else 0) + 2
            self._event("attack", self._next_alive(pid))
            self._next_turn(turns)
            return
        if action == "skip":
            self._add_log(f"🏃 {self._name(pid)} bỏ lượt, không phải rút bài.")
            self._end_turn()
            return
        if action == "shuffle":
            random.shuffle(self.deck)
            self.deck_ver += 1
            self._event("shuffle", pid)
            self._add_log("🔀 Chồng bài đã được xáo trộn.")
        elif action == "future":
            top = [dict(c) for c in self.deck[:3]]
            self.knowledge[pid] = {"ver": self.deck_ver, "cards": top}
            self._event("future", pid)
            self._tell(pid, "🔮 3 lá trên cùng (từ trên xuống): " + ", ".join(self._label(c["t"]) for c in top), "future")
            self._add_log(f"🔮 {self._name(pid)} đã nhìn trộm 3 lá trên cùng.")
        elif action == "favor":
            if target in self.alive and self.hands.get(target):
                self.wait = {"kind": "favor", "from": pid, "target": target}
                self._set_timer(FAVOR_TIME if self._connected(target) else OFFLINE_TIME, self._favor_timeout, "favor")
                return
        elif action == "pair":
            if target in self.alive and self.hands.get(target):
                self._transfer(target, pid, random.choice(self.hands[target]), "steal")
        elif action == "triple":
            card = self._find(target, w["name"]) if target in self.alive else None
            if card:
                self._transfer(target, pid, card, "steal")
            else:
                self._add_log(f"🤷 {self._name(target)} không có lá {self._label(w['name'])}.")
                self._tell(pid, f"{self._name(target)} không có lá {self._label(w['name'])}.")
        self._start_turn_timer()

    def _transfer(self, giver, taker, card, how):
        self.hands[giver].remove(card)
        self.hands[taker].append(card)
        self._event(how, taker, target=giver)
        verb = "lấy" if how == "steal" else "nhận"
        self._add_log(f"🤝 {self._name(taker)} {verb} 1 lá từ {self._name(giver)}.")
        self._tell(taker, f"Bạn {verb} được {self._label(card['t'])} từ {self._name(giver)}.")
        self._tell(giver, f"Bạn mất lá {self._label(card['t'])} vào tay {self._name(taker)}.")

    def _act_give(self, pid, data):
        w = self.wait
        if self.phase != "play" or w is None or w["kind"] != "favor" or w["target"] != pid:
            raise GameError("Không ai đang xin bài của bạn.")
        try:
            cid = int(data.get("card"))
        except (TypeError, ValueError):
            raise GameError("Lá bài không hợp lệ.")
        card = next((c for c in self.hands[pid] if c["id"] == cid), None)
        if card is None:
            raise GameError("Bạn không có lá bài này.")
        self.wait = None
        self._transfer(pid, w["from"], card, "give")
        self._start_turn_timer()

    def _favor_timeout(self):
        w = self.wait
        if w and w["kind"] == "favor":
            self._act_give(w["target"], {"card": random.choice(self.hands[w["target"]])["id"]})

    # ------------------------------------------------------------------ rút bài
    def _act_draw(self, pid, data):
        self._require_turn(pid)
        card = self.deck.pop(0)
        for k in self.knowledge.values():
            if k["ver"] == self.deck_ver and k["cards"]:
                k["cards"].pop(0)
        self._event("draw", pid)
        if card["t"] != "kitten":
            self.hands[pid].append(card)
            self._tell(pid, f"Bạn rút được {self._label(card['t'])}.", "draw")
            self._end_turn()
            return
        defuse = self._find(pid, "defuse")
        if defuse is None:
            self._explode(pid, card)
            return
        self.hands[pid].remove(defuse)
        self.discard.append(defuse)
        self.wait = {"kind": "defuse", "pid": pid, "card": card}
        self._event("defuse", pid)
        self._add_log(f"😱 {self._name(pid)} rút phải MÈO NỔ… nhưng đã kịp dùng Gỡ Bom! 🧯", "defuse")
        self._set_timer(DEFUSE_TIME if self._connected(pid) else OFFLINE_TIME, self._defuse_timeout, "defuse")

    def _act_insert(self, pid, data):
        w = self.wait
        if self.phase != "play" or w is None or w["kind"] != "defuse" or w["pid"] != pid:
            raise GameError("Bạn không cần nhét Mèo Nổ lúc này.")
        pos = data.get("pos")
        if pos == "random":
            pos = random.randint(0, len(self.deck))
        else:
            try:
                pos = max(0, min(len(self.deck), int(pos)))
            except (TypeError, ValueError):
                raise GameError("Vị trí không hợp lệ.")
        self.wait = None
        self.deck.insert(pos, w["card"])
        self.deck_ver += 1
        self._event("insert", pid)
        where = "trên cùng" if pos == 0 else "dưới cùng" if pos == len(self.deck) - 1 else f"thứ {pos + 1} từ trên xuống"
        self._tell(pid, f"🧯 Bạn đã nhét Mèo Nổ vào vị trí {where}.")
        self._add_log(f"🤫 {self._name(pid)} bí mật nhét Mèo Nổ trở lại chồng bài.")
        self._end_turn()

    def _defuse_timeout(self):
        w = self.wait
        if w and w["kind"] == "defuse":
            self._act_insert(w["pid"], {"pos": "random"})

    def _explode(self, pid, kitten):
        self.alive.remove(pid)
        self.discard.append(kitten)
        self.discard.extend(self.hands[pid])
        self.hands[pid] = []
        self.knowledge.pop(pid, None)
        self._event("explode", pid)
        text = f"💥 {self._name(pid)} rút phải MÈO NỔ và đã NỔ TUNG!"
        self._add_log(text, "explode")
        self._post_chat("system", text)
        if len(self.alive) == 1:
            self._end_game(self.alive[0])
        else:
            self._next_turn(1)

    def _end_game(self, winner):
        self._stop_timer()
        self.wait = None
        self.phase = "end"
        self.winner = winner
        self.scores[winner] = self.scores.get(winner, 0) + 1
        self._event("win", winner)
        text = f"🏆 {self._name(winner)} là người sống sót cuối cùng và thắng ván {self.round}!"
        self._add_log(text, "end")
        self._post_chat("system", text)

    # ------------------------------------------------------------------ chat
    def _act_chat(self, pid, data):
        text = " ".join(str(data.get("text", "")).split())[:300]
        if text:
            self._post_chat("all", text, pid)

    # ------------------------------------------------------------------ trạng thái
    def _public_wait(self):
        w = self.wait
        if w is None:
            return None
        if w["kind"] == "nope":
            return {"kind": "nope", "pid": w["pid"], "action": w["action"], "target": w["target"],
                    "name": w["name"], "cards": w["cards"], "nopes": w["nopes"], "nopers": w["nopers"]}
        if w["kind"] == "favor":
            return {"kind": "favor", "from": w["from"], "target": w["target"]}
        return {"kind": "defuse", "pid": w["pid"]}

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
                "alive": p_id in self.alive if in_round else True,
                "count": len(self.hands[p_id]) if playing else 0,
                "score": self.scores.get(p_id, 0),
                "hand": self.hands[p_id] if playing and self.phase == "end" else None,
            })
        hand = self.hands.get(pid)
        if hand is not None:
            hand = sorted(hand, key=lambda c: (CARD_ORDER.index(c["t"]), c["id"]))
        w = self.wait
        return {
            "phase": self.phase,
            "round": self.round,
            "me": {"id": pid, "host": pid == self.room.host_id, "playing": pid in self.hands,
                   "alive": pid in self.alive if in_round else True},
            "players": players,
            "hand": hand,
            "turn": self.current,
            "turnsLeft": self.turns_left,
            "turnNo": self.turn_no,
            "deckCount": len(self.deck),
            "kittens": max(0, len(self.alive) - 1) if self.phase == "play" else 0,
            "discardTop": self.discard[-1] if self.discard else None,
            "discardCount": len(self.discard),
            "wait": self._public_wait(),
            "canNope": bool(w and w["kind"] == "nope" and pid in self.alive and self._find(pid, "nope")),
            "future": self._future(pid),
            "private": self.private.get(pid, [])[-30:],
            "deadline": self.deadline,
            "total": self.phase_total,
            "timerKind": self.timer_kind,
            "now": time.time(),
            "winner": self.winner,
            "events": self.events[-12:],
            "config": self.config,
            "turnTimes": TURN_TIMES,
            "nopeTimes": NOPE_TIMES,
            "cardInfo": CARDS,
            "cardOrder": CARD_ORDER,
            "minPlayers": self.min_players,
            "maxPlayers": self.max_players,
            "startError": self._start_error() if self.phase != "play" else None,
            "chat": self.chat[-150:],
            "log": self.log[-100:],
        }
