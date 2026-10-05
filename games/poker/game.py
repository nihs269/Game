"""Poker Texas Hold'em (No-Limit) — 2 lá tẩy + 5 lá chung, cược 4 vòng, ai có tay bài mạnh nhất ăn pot.

Một “ván” gồm nhiều ván bài liên tiếp: mỗi người có số chip khởi điểm như nhau, hết chip thì
bị loại (có thể nạp lại). Máy chủ lo chia bài, tiền mù, lượt cược, side pot khi có người all-in
và so bài. Người mới vào phòng giữa chừng được xếp chỗ từ ván bài kế tiếp.
"""
import asyncio
import logging
import random
import time

from core.game_base import BaseGame, GameError
from .bots import PokerBotMixin
from .hands import best_five, hand_name, new_deck, score

log = logging.getLogger("gamehub.poker")

CHIP_OPTIONS = (500, 1000, 2000, 5000)
BLIND_OPTIONS = (10, 20, 50, 100)
TURN_TIMES = (0, 15, 20, 30, 45, 60)
BLIND_UP_OPTIONS = (0, 10, 15, 20)
STREETS = ["preflop", "flop", "turn", "river"]
STREET_VI = {"preflop": "Trước flop", "flop": "Flop", "turn": "Turn", "river": "River"}
RESULT_TIME = 7        # xem kết quả so bài trước ván bài mới
FOLD_WIN_TIME = 3.5
RUNOUT_STEP = 1.6      # mọi người đã all-in: lật dần từng vòng
OFFLINE_TIME = 5
WAIT_RETRY = 3


class PokerGame(PokerBotMixin, BaseGame):
    id = "poker"
    name = "Poker"
    icon = "♠️"
    description = "Texas Hold'em: 2 lá tẩy + 5 lá chung, theo, tố, tất tay và bluff để giành pot. Người cuối cùng còn chip thắng."
    min_players = 2
    max_players = 9
    guide = [
        ("🎯 Mục tiêu", "Giành chip của người khác bằng cách thắng các **pot** (tổng tiền cược mỗi ván bài). Hết chip là bị loại — người cuối cùng còn chip thắng cả ván."),
        ("🃏 Chia bài", [
            "Mỗi người nhận **2 lá tẩy** (chỉ mình thấy). Trên bàn lần lượt lật **5 lá chung** mà ai cũng dùng được.",
            "Tay bài của bạn = **5 lá tốt nhất** ghép từ 2 lá tẩy + 5 lá chung.",
            "Nút **D** (nhà cái) xoay vòng mỗi ván bài. Hai người bên trái nhà cái đặt **mù nhỏ (SB)** và **mù lớn (BB)** trước khi chia bài.",
        ]),
        ("💰 Bốn vòng cược", [
            "**Trước flop** — sau khi chia 2 lá tẩy, người bên trái mù lớn nói trước.",
            "**Flop** — lật 3 lá chung. **Turn** — lật lá thứ 4. **River** — lật lá thứ 5. Từ flop trở đi, người bên trái nhà cái nói trước.",
            "Đến lượt, bạn chọn: **Bỏ bài** (thua phần đã cược), **Xem** (khi chưa ai cược thêm), **Theo** (cược bằng người trước), **Tố** (cược cao hơn — tối thiểu bằng mức tố trước đó) hoặc **All-in** (dồn hết chip).",
            "Vòng cược kết thúc khi mọi người còn lại đã cược bằng nhau.",
        ]),
        ("🏆 So bài", [
            "Chỉ còn 1 người không bỏ bài → người đó ăn pot, không cần lật bài.",
            "Hết river mà còn nhiều người → lật bài, tay mạnh nhất ăn pot (bằng nhau thì chia đều).",
            "Ai all-in chỉ được ăn phần pot tương ứng số chip mình đã cược (**side pot**); phần dư thuộc về những người cược nhiều hơn.",
        ]),
        ("📊 Thứ tự tay bài (mạnh → yếu)", [
            "**Thùng phá sảnh** — 5 lá liên tiếp cùng chất (A-K-Q-J-10 cùng chất là Thùng phá sảnh lớn).",
            "**Tứ quý** — 4 lá cùng hạng.",
            "**Cù lũ** — 1 bộ ba + 1 đôi.",
            "**Thùng** — 5 lá cùng chất.",
            "**Sảnh** — 5 lá liên tiếp (A có thể đứng đầu hoặc cuối: A-2-3-4-5).",
            "**Sám cô** — 3 lá cùng hạng.",
            "**Thú** — 2 đôi.",
            "**Đôi** — 2 lá cùng hạng.",
            "**Mậu thầu** — không có gì, tính lá cao nhất.",
        ]),
        ("⚙️ Tuỳ chọn (chủ phòng)", [
            "Số chip khởi điểm, mức mù lớn, thời gian mỗi lượt (hết giờ tự Xem hoặc Bỏ bài).",
            "**Tăng mù**: cứ mỗi N ván bài thì mù tăng gấp đôi để ván đấu không kéo dài mãi.",
        ]),
        ("💡 Mẹo", [
            "Hết chip? Bấm **Nạp lại** để quay vào bàn từ ván bài sau.",
            "Người mới vào phòng giữa chừng sẽ được xếp chỗ từ ván bài kế tiếp. Ai mất kết nối sẽ tạm ngồi ngoài.",
            "Bot biết tính xác suất thắng và thỉnh thoảng… bluff 😏",
        ]),
    ]

    def __init__(self, room):
        super().__init__(room)
        self.config = {"chips": 1000, "big_blind": 20, "turn_time": 30, "blind_up": 0}
        self.chat = []
        self.log = []
        self.events = []
        self._msg_id = 0
        self._seq = 0
        self._token = 0
        self.deadline = None
        self.phase_total = None
        self.wins = {}
        self.round = 0
        self._reset_session()
        self.phase = "lobby"

    def _reset_session(self):
        self._token += 1
        self.deadline = self.phase_total = None
        self.seats = []
        self.chips = {}
        self.rebuys = {}
        self.names = {}
        self.hand_no = 0
        self.bb = self.config["big_blind"]
        self.dealer = None
        self.winner = None
        self._reset_hand()
        self._bots_reset()

    def _reset_hand(self):
        self.stage = None          # bet · runout · result · waiting
        self.street = None
        self.deck = []
        self.hole = {}
        self.board = []
        self.bets = {}
        self.totals = {}
        self.in_hand = []
        self.folded = set()
        self.allin = set()
        self.acted = set()
        self.shown = set()
        self.current_bet = 0
        self.min_raise = 0
        self.cur = None
        self.sb_pid = self.bb_pid = None
        self.last_action = {}
        self.result = None

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
        self.chat.append({
            "id": self._msg_id, "t": time.time(), "channel": channel, "text": text,
            "pid": pid, "name": self._name(pid) if pid else None,
        })
        if len(self.chat) > 300:
            self.chat = self.chat[-300:]

    def _require_host(self, pid):
        if pid != self.room.host_id:
            raise GameError("Chỉ chủ phòng mới làm được việc này.")

    def _alive(self):
        """Những người còn trong ván bài (chưa bỏ bài)."""
        return [p for p in self.in_hand if p not in self.folded]

    def _pot(self):
        return sum(self.totals.values())

    def _after(self, pid, pool):
        """Người kế tiếp (theo thứ tự ghế) sau `pid` nằm trong `pool`."""
        if not self.seats:
            return None
        start = self.seats.index(pid) if pid in self.seats else -1
        n = len(self.seats)
        for k in range(1, n + 1):
            q = self.seats[(start + k) % n]
            if q in pool:
                return q
        return None

    def _put(self, pid, amount):
        amount = max(0, min(amount, self.chips[pid]))
        self.chips[pid] -= amount
        self.bets[pid] = self.bets.get(pid, 0) + amount
        self.totals[pid] = self.totals.get(pid, 0) + amount
        if self.chips[pid] == 0 and pid in self.in_hand:
            self.allin.add(pid)
        return amount

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
                log.exception("Lỗi hẹn giờ Poker")
            await self.room.broadcast_state()

    def _stop_timer(self):
        self._token += 1
        self.deadline = self.phase_total = None

    def _start_turn_timer(self):
        pid = self.cur
        if pid is None:
            return
        if not self._connected(pid):
            self._set_timer(OFFLINE_TIME, self._auto_move)
        elif self.config["turn_time"]:
            self._set_timer(self.config["turn_time"], self._auto_move)
        else:
            self._stop_timer()

    def _auto_move(self):
        pid = self.cur
        if pid is None or self.stage != "bet":
            return
        if self.current_bet - self.bets.get(pid, 0) <= 0:
            self._move(pid, "check")
        else:
            self._move(pid, "fold")

    def dispose(self):
        self._token += 1
        self._disposed = True

    # ------------------------------------------------------------------ core hooks
    def room_limit(self):
        # Đang chơi: nhận thêm người xem; ai chưa có ghế sẽ được xếp vào khi bàn còn chỗ.
        return self.max_players + (self.max_spectators if self.phase == "play" else 0)

    def can_remove(self, pid):
        return self.phase != "play" or pid not in self._alive()

    def can_rename(self):
        return self.phase != "play"

    def status(self):
        if self.phase == "lobby":
            return {"label": "Đang chờ", "joinable": True}
        if self.phase == "end":
            return {"label": "Nghỉ giữa ván", "joinable": True}
        return {"label": f"Đang chơi · ván bài {self.hand_no}", "joinable": True}

    async def on_player_join(self, player):
        self._post_chat("system", f"👋 {player.name} ngồi vào sòng.")
        if self.phase == "play" and player.id not in self.seats:
            self._post_chat("system", f"🪑 {player.name} đang xem — sẽ được xếp chỗ từ ván bài sau nếu bàn còn ghế.")

    async def on_player_removed(self, player):
        self._post_chat("system", f"🚪 {player.name} đã rời sòng.")
        self.names[player.id] = player.name
        if self.phase != "play" and player.id in self.seats:
            self.seats.remove(player.id)

    async def on_player_disconnect(self, player):
        if self.phase == "play" and self.stage == "bet" and player.id == self.cur:
            self._start_turn_timer()

    async def on_player_connect(self, player):
        if self.phase == "play" and self.stage == "bet" and player.id == self.cur:
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
        options = {"chips": CHIP_OPTIONS, "big_blind": BLIND_OPTIONS, "turn_time": TURN_TIMES, "blind_up": BLIND_UP_OPTIONS}
        for key, allowed in options.items():
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
        self._reset_session()
        self.round += 1
        self.phase = "play"
        self.seats = self.participants()
        random.shuffle(self.seats)
        for p in self.seats:
            self.chips[p] = self.config["chips"]
            self.wins.setdefault(p, 0)
        self._post_chat("system", f"♠️ Ván {self.round} bắt đầu! Mỗi người {self.config['chips']} chip, mù {self.bb // 2}/{self.bb}.")
        self._start_hand()

    def _act_next_round(self, pid, data):
        self._act_start(pid, data)

    def _act_lobby(self, pid, data):
        self._require_host(pid)
        if self.phase != "end":
            raise GameError("Không thể làm việc này lúc này.")
        self._reset_session()
        self.phase = "lobby"
        self.wins = {}
        self.round = 0
        self._post_chat("system", "🔁 Quay lại phòng chờ, bảng thành tích đã được làm mới.")

    def _act_stop(self, pid, data):
        """Chủ phòng kết thúc ván: trả lại tiền đang cược của ván bài dở dang rồi xếp hạng."""
        self._require_host(pid)
        if self.phase != "play":
            raise GameError("Không có ván nào đang diễn ra.")
        if self.stage in ("bet", "runout"):
            for p, t in self.totals.items():
                if p in self.chips:
                    self.chips[p] += t
        self._post_chat("system", "🛑 Chủ phòng đã kết thúc ván.")
        self._end_session()

    def _act_rebuy(self, pid, data):
        if self.phase != "play" or pid not in self.seats:
            raise GameError("Chưa thể nạp lại lúc này.")
        if self.chips.get(pid, 0) > 0 or pid in self._alive():
            raise GameError("Bạn vẫn còn chip.")
        self.chips[pid] = self.config["chips"]
        self.rebuys[pid] = self.rebuys.get(pid, 0) + 1
        self._add_log(f"💵 {self._name(pid)} nạp lại {self.config['chips']} chip.", "rebuy")
        self._post_chat("system", f"💵 {self._name(pid)} nạp lại chip và sẽ vào bàn từ ván bài sau.")
        if self.stage == "waiting":
            self._start_hand()

    # ------------------------------------------------------------------ một ván bài
    def _start_hand(self):
        # Xếp chỗ người mới, bỏ người đã rời phòng.
        for p in self.room.players:
            if p not in self.seats and len([q for q in self.seats if q in self.room.players]) < self.max_players:
                self.seats.append(p)
                self.chips[p] = self.config["chips"]
                self.wins.setdefault(p, 0)
        prev_dealer = self.dealer
        live_all = [p for p in self.seats if self.chips.get(p, 0) > 0 and p in self.room.players]
        self.seats = [p for p in self.seats if p in self.room.players or p == prev_dealer]
        ready = [p for p in live_all if self._connected(p)]
        if len(live_all) < 2:
            self._end_session()
            return
        self._reset_hand()
        if len(ready) < 2:
            self.stage = "waiting"
            self._set_timer(WAIT_RETRY, self._start_hand)
            return

        if self.config["blind_up"] and self.hand_no and self.hand_no % self.config["blind_up"] == 0:
            self.bb *= 2
            self._add_log(f"⬆️ Mù tăng lên {self.bb // 2}/{self.bb}.", "blind")
            self._post_chat("system", f"⬆️ Mù tăng lên {self.bb // 2}/{self.bb}!")
        self.hand_no += 1
        self.dealer = self._after(prev_dealer, ready) if prev_dealer else random.choice(ready)
        if prev_dealer not in self.room.players and prev_dealer in self.seats:
            self.seats.remove(prev_dealer)
        self.in_hand = [p for p in self.seats if p in ready]
        self.deck = new_deck()
        for p in self.in_hand:
            self.hole[p] = [self.deck.pop(), self.deck.pop()]
            self.bets[p] = 0
            self.totals[p] = 0
        if len(self.in_hand) == 2:
            self.sb_pid = self.dealer
            self.bb_pid = self._after(self.dealer, self.in_hand)
        else:
            self.sb_pid = self._after(self.dealer, self.in_hand)
            self.bb_pid = self._after(self.sb_pid, self.in_hand)
        sb = self._put(self.sb_pid, self.bb // 2)
        bb = self._put(self.bb_pid, self.bb)
        self.last_action = {self.sb_pid: f"Mù nhỏ {sb}", self.bb_pid: f"Mù lớn {bb}"}
        self.current_bet = self.bb
        self.min_raise = self.bb
        self.street = "preflop"
        self.stage = "bet"
        self._event("deal", dealer=self.dealer)
        self._add_log(f"🃏 Ván bài {self.hand_no} · nhà cái {self._name(self.dealer)} · mù {self.bb // 2}/{self.bb}.", "start")
        self.cur = self._next_actor(self.bb_pid)
        if self.cur is None:
            self._end_street()
        else:
            self._start_turn_timer()

    def _needs_action(self, p):
        return (p in self.in_hand and p not in self.folded and p not in self.allin
                and (p not in self.acted or self.bets.get(p, 0) < self.current_bet))

    def _next_actor(self, after):
        pool = [p for p in self.in_hand if self._needs_action(p)]
        if len([p for p in self._alive() if p not in self.allin]) == 1 and pool:
            # Chỉ còn 1 người chưa all-in: chỉ cần hành động nếu còn phải theo.
            p = pool[0]
            if self.bets.get(p, 0) >= self.current_bet:
                return None
        return self._after(after, pool)

    def options(self, pid):
        """Các lựa chọn của người đang tới lượt (dùng cho giao diện và bot)."""
        if self.phase != "play" or self.stage != "bet" or pid != self.cur:
            return None
        bet = self.bets.get(pid, 0)
        chips = self.chips[pid]
        to_call = max(0, self.current_bet - bet)
        max_to = bet + chips
        min_to = min(max_to, self.current_bet + self.min_raise)
        return {
            "toCall": min(to_call, chips),
            "canCheck": to_call == 0,
            "canRaise": pid not in self.acted and chips > to_call,
            "minTo": min_to,
            "maxTo": max_to,
            "bet": bet,
            "currentBet": self.current_bet,
        }

    def _act_move(self, pid, data):
        self._move(pid, str(data.get("move", "")), data.get("to"))

    def _move(self, pid, move, to=None):
        opt = self.options(pid)
        if opt is None:
            raise GameError("Chưa đến lượt của bạn.")
        name = self._name(pid)
        if move == "fold":
            self.folded.add(pid)
            self.last_action[pid] = "Bỏ bài"
            self._event("act", pid, move="fold")
            self._add_log(f"🏳️ {name} bỏ bài.", "fold")
        elif move == "check":
            if not opt["canCheck"]:
                raise GameError("Đang có người cược — bạn phải Theo, Tố hoặc Bỏ bài.")
            self.acted.add(pid)
            self.last_action[pid] = "Xem"
            self._event("act", pid, move="check")
            self._add_log(f"👀 {name} xem bài.", "check")
        elif move == "call" or (move == "allin" and not opt["canRaise"]):
            if opt["toCall"] <= 0:
                raise GameError("Không có gì để theo — hãy chọn Xem.")
            amt = self._put(pid, opt["toCall"])
            self.acted.add(pid)
            allin = pid in self.allin
            self.last_action[pid] = f"All-in {self.bets[pid]}" if allin else f"Theo {amt}"
            self._event("act", pid, move="allin" if allin else "call", amount=amt)
            self._add_log(f"{'🔥' if allin else '✅'} {name} theo {amt}{' (all-in)' if allin else ''}.", "call")
        elif move in ("raise", "allin"):
            if not opt["canRaise"]:
                raise GameError("Bạn không thể tố lúc này.")
            if move == "allin":
                target = opt["maxTo"]
            else:
                try:
                    target = int(to)
                except (TypeError, ValueError):
                    raise GameError("Số chip không hợp lệ.")
                target = min(target, opt["maxTo"])
                if target < opt["minTo"]:
                    raise GameError(f"Phải tố lên ít nhất {opt['minTo']}.")
            if target <= self.current_bet:
                return self._move(pid, "call")
            was_bet = self.current_bet == 0
            self._put(pid, target - opt["bet"])
            raise_size = target - self.current_bet
            if raise_size >= self.min_raise:
                self.min_raise = raise_size
                self.acted = {pid}
            else:
                self.acted.add(pid)  # all-in thiếu: không mở lại quyền tố cho người đã nói
            self.current_bet = target
            allin = pid in self.allin
            label = "All-in" if allin else ("Cược" if was_bet else "Tố")
            self.last_action[pid] = f"{label} {target}"
            self._event("act", pid, move="allin" if allin else "raise", amount=target)
            self._add_log(f"{'🔥' if allin else '💰'} {name} {label.lower()} {target}.", "raise")
        else:
            raise GameError("Hành động không hợp lệ.")
        self._after_move(pid)

    def _after_move(self, pid):
        alive = self._alive()
        if len(alive) == 1:
            self._win_uncontested(alive[0])
            return
        nxt = self._next_actor(pid)
        if nxt is not None:
            self.cur = nxt
            self._start_turn_timer()
            return
        self._end_street()

    def _end_street(self):
        self.cur = None
        if self.street == "river":
            self._showdown()
            return
        self.street = STREETS[STREETS.index(self.street) + 1]
        self.board += [self.deck.pop() for _ in range(3 if self.street == "flop" else 1)]
        self.bets = {p: 0 for p in self.in_hand}
        self.current_bet = 0
        self.min_raise = self.bb
        self.acted = set()
        self.last_action = {p: a for p, a in self.last_action.items() if p in self.folded or p in self.allin}
        self._event("street", street=self.street)
        self._add_log(f"🂠 {STREET_VI[self.street]}: {' '.join(self.board)}", "street")
        actors = [p for p in self._alive() if p not in self.allin]
        if len(actors) >= 2:
            self.stage = "bet"
            self.cur = self._after(self.dealer, actors)
            self._start_turn_timer()
        else:
            # Không còn ai để cược: lật bài của mọi người rồi chia nốt các lá chung.
            self.stage = "runout"
            if not self.shown:
                self.shown = set(self._alive())
                self._event("show")
            self._set_timer(RUNOUT_STEP, self._end_street)

    def _pots(self):
        alive = self._alive()
        levels = sorted({self.totals[p] for p in alive if self.totals.get(p, 0) > 0})
        pots = []
        prev = 0
        for lv in levels:
            amount = sum(max(0, min(t, lv) - prev) for t in self.totals.values())
            elig = [p for p in alive if self.totals.get(p, 0) >= lv]
            if pots and pots[-1][1] == elig:
                pots[-1][0] += amount
            else:
                pots.append([amount, elig])
            prev = lv
        extra = sum(max(0, t - prev) for t in self.totals.values())
        if extra and pots:
            pots[-1][0] += extra
        return pots

    def _order_from_dealer(self, pool):
        out = []
        p = self.dealer
        for _ in range(len(self.seats)):
            p = self._after(p, pool)
            if p is None or p in out:
                break
            out.append(p)
        return out

    def _showdown(self):
        self.stage = "result"
        alive = self._alive()
        self.shown = set(alive)
        scores = {p: score(self.hole[p] + self.board) for p in alive}
        payouts = {}
        pots = []
        for amount, elig in self._pots():
            top = max(scores[p] for p in elig)
            winners = [p for p in self._order_from_dealer(elig) if scores[p] == top]
            share, rem = divmod(amount, len(winners))
            for i, w in enumerate(winners):
                payouts[w] = payouts.get(w, 0) + share + (1 if i < rem else 0)
            pots.append({"amount": amount, "winners": winners, "hand": hand_name(top) if len(elig) > 1 else None})
        for p, amt in payouts.items():
            self.chips[p] += amt
        self.result = {
            "pots": pots,
            "payouts": payouts,
            "hands": {p: {"name": hand_name(scores[p]), "best": best_five(self.hole[p] + self.board)} for p in alive},
            "showdown": True,
        }
        for pot in pots:
            names = ", ".join(self._name(w) for w in pot["winners"])
            with_hand = f" với {pot['hand']}" if pot["hand"] else ""
            self._add_log(f"🏆 {names} ăn {pot['amount']} chip{with_hand}.", "win")
        self._event("win", pids=list(payouts))
        self._set_timer(RESULT_TIME, self._next_hand)

    def _win_uncontested(self, pid):
        self.stage = "result"
        self.cur = None
        amount = self._pot()
        self.chips[pid] += amount
        self.result = {"pots": [{"amount": amount, "winners": [pid], "hand": None}], "payouts": {pid: amount},
                       "hands": {}, "showdown": False}
        self._add_log(f"🏆 {self._name(pid)} ăn {amount} chip (mọi người đều bỏ bài).", "win")
        self._event("win", pids=[pid])
        self._set_timer(FOLD_WIN_TIME, self._next_hand)

    def _next_hand(self):
        for p in self.in_hand:
            if self.chips.get(p, 0) == 0:
                self._add_log(f"💸 {self._name(p)} đã hết chip.", "bust")
                self._post_chat("system", f"💸 {self._name(p)} đã hết chip! Bấm “Nạp lại” để chơi tiếp.")
        self._start_hand()

    def _end_session(self):
        self._stop_timer()
        self._reset_hand()
        self.phase = "end"
        ranked = sorted(self.seats, key=lambda p: -self.chips.get(p, 0))
        self.winner = ranked[0] if ranked else None
        if self.winner:
            self.wins[self.winner] = self.wins.get(self.winner, 0) + 1
            text = f"🏆 {self._name(self.winner)} thắng ván {self.round} với {self.chips[self.winner]} chip!"
            self._add_log(text, "end")
            self._post_chat("system", text)
            self._event("champion", self.winner)

    # ------------------------------------------------------------------ chat
    def _act_chat(self, pid, data):
        text = " ".join(str(data.get("text", "")).split())[:300]
        if text:
            self._post_chat("all", text, pid)

    # ------------------------------------------------------------------ trạng thái
    def view(self, pid):
        playing = self.phase in ("play", "end")
        order = list(self.seats) if playing else []
        order += [p for p in self.room.players if p not in order]
        players = []
        for p_id in order:
            p = self.room.players.get(p_id)
            seated = p_id in self.seats
            in_hand = p_id in self.in_hand
            cards = None
            if in_hand and (p_id == pid or p_id in self.shown):
                cards = self.hole[p_id]
            players.append({
                "id": p_id,
                "name": p.name if p else self.names.get(p_id, "?"),
                "bot": bool(p and p.is_bot),
                "connected": bool(p and p.connected),
                "look": p.look if p else None,
                "host": p_id == self.room.host_id,
                "seated": seated or not playing,
                "chips": self.chips.get(p_id, self.config["chips"] if not playing else 0),
                "bet": self.bets.get(p_id, 0),
                "inHand": in_hand,
                "folded": p_id in self.folded,
                "allin": p_id in self.allin,
                "cards": cards,
                "action": self.last_action.get(p_id),
                "wins": self.wins.get(p_id, 0),
                "rebuys": self.rebuys.get(p_id, 0),
            })
        my_hand = None
        if pid in self.hole and pid not in self.folded:
            my_hand = hand_name(score(self.hole[pid] + self.board))
        return {
            "phase": self.phase,
            "stage": self.stage,
            "street": self.street,
            "round": self.round,
            "handNo": self.hand_no,
            "me": {"id": pid, "host": pid == self.room.host_id, "seated": pid in self.seats,
                   "chips": self.chips.get(pid, 0), "inHand": pid in self.in_hand,
                   "canRebuy": self.phase == "play" and pid in self.seats and self.chips.get(pid, 0) == 0 and pid not in self._alive()},
            "players": players,
            "board": self.board,
            "pot": self._pot(),
            "bb": self.bb,
            "dealer": self.dealer,
            "sb": self.sb_pid,
            "bbPid": self.bb_pid,
            "turn": self.cur,
            "options": self.options(pid),
            "myHand": my_hand,
            "result": self.result,
            "winner": self.winner,
            "deadline": self.deadline,
            "total": self.phase_total,
            "now": time.time(),
            "events": self.events[-12:],
            "config": self.config,
            "choices": {"chips": CHIP_OPTIONS, "big_blind": BLIND_OPTIONS, "turn_time": TURN_TIMES, "blind_up": BLIND_UP_OPTIONS},
            "minPlayers": self.min_players,
            "maxPlayers": self.max_players,
            "startError": self._start_error() if self.phase != "play" else None,
            "chat": self.chat[-150:],
            "log": self.log[-100:],
        }
