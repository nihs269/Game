"""Cờ Tỷ Phú (kiểu Business Tour) — đi vòng quanh thế giới, mua thành phố kèm xây nhà, mua lại đất của
người khác và giành độc quyền để thắng sớm.

Luật chính:
  • Bàn 32 ô: Xuất phát (nhận lương mỗi lần đi qua), Đảo hoang, World Championship, World Tour, 20 thành
    phố Việt Nam thuộc 8 vùng, 4 khu nghỉ dưỡng, 3 ô Cơ hội, 1 ô Thuế (10% tổng tài sản).
  • Đổ 2 xúc xắc; ra đôi được đổ tiếp; ra đôi 3 lần liền thì dạt ra Đảo hoang.
  • Thành phố chưa có chủ: mua đất và xây luôn nhà trong một lần. Cấp nhà tối đa phụ thuộc số vòng đã đi
    (nhà cấp 1 → cấp 3; khách sạn chỉ nâng lên được từ nhà cấp 3, từ vòng 2 trở đi).
    Dừng ở thành phố của mình thì được xây thêm.
  • Dừng ở thành phố của người khác: trả tiền thuê (đủ bộ cả vùng thì ×2), sau đó được MUA LẠI với giá gấp
    đôi giá trị (không cần chủ đồng ý) — trừ khi đã có khách sạn.
  • World Championship: chọn một thành phố của mình để tổ chức giải → tiền thuê ở đó nhân thêm (cộng dồn).
  • World Tour: lượt sau được bay thẳng tới ô bất kỳ (tốn phí), thay vì đổ xúc xắc.
  • Đảo hoang: kẹt tối đa 3 lượt — thoát bằng đổ ra đôi, nộp tiền hoặc thẻ Thoát đảo.
  • Thắng sớm: độc quyền 3 vùng, độc quyền cả một cạnh bàn, hoặc sở hữu cả 4 khu nghỉ dưỡng.
    Hoặc mọi người khác phá sản. Hết số vòng giới hạn → ai có tổng tài sản lớn nhất thắng.
Dữ liệu bàn cờ ở static/board.json (dùng chung với giao diện). Tiền tính theo nghìn ($K).
"""
import asyncio
import json
import logging
import os
import random
import time

from core.game_base import BaseGame, GameError
from .bots import TyPhuBotMixin

log = logging.getLogger("gamehub.cotyphu")

with open(os.path.join(os.path.dirname(__file__), "static", "board.json"), encoding="utf-8") as _f:
    BOARD = json.load(_f)
SQ = BOARD["squares"]
GROUPS = BOARD["groups"]
N = len(SQ)
SIDE = N // 4
CITIES = [i for i, s in enumerate(SQ) if s["type"] == "city"]
RESORTS = [i for i, s in enumerate(SQ) if s["type"] == "resort"]
OWNABLE = CITIES + RESORTS
GROUP_MEMBERS = {g: [i for i in CITIES if SQ[i]["group"] == g] for g in GROUPS}
SIDES = [[i for i in OWNABLE if k * SIDE < i < (k + 1) * SIDE] for k in range(4)]
ISLAND = next(i for i, s in enumerate(SQ) if s["type"] == "island")
TOUR = next(i for i, s in enumerate(SQ) if s["type"] == "tour")
CHAMP = next(i for i, s in enumerate(SQ) if s["type"] == "champ")

HOTEL = 4                         # cấp công trình: 0 = đất, 1–3 = nhà cấp 1–3, 4 = khách sạn
MAX_HOUSE = 3
RENT_MULT = [0.1, 0.3, 0.6, 1.0, 1.8]   # × giá đất; tăng dần theo vốn đã bỏ ra
SALARY = 300
ISLAND_FEE = 200
TOUR_FEE = 50
CHAMP_MAX = 4                     # World Championship: lần 1 ×2, lần 2 ×3 … tối đa ×5
RESORT_RENT = [0, 40, 90, 180, 360]
START_MONEY = (1500, 2000, 3000)
MAX_ROUNDS = (0, 10, 15, 20, 30)
TURN_TIMES = (0, 15, 20, 30, 45)
PLAYER_COLORS = ["#ff5d6c", "#3fa7ff", "#3ecf8e", "#ffb547"]
ROLL_TIME = 1.0
MOVE_STEP = 0.2
FLY_STEP = 0.08                   # World Tour: bay theo chiều đi, lướt nhanh qua từng ô
CARD_TIME = 2.6
OFFLINE_TIME = 6
LEVEL_NAMES = ["Đất trống", "Nhà cấp 1", "Nhà cấp 2", "Nhà cấp 3", "Khách sạn"]

CARDS = [
    {"key": "escape", "text": "🎫 Vé thoát đảo — giữ lại, tự dùng khi bị kẹt ở Đảo hoang.", "keep": True},
    {"key": "escape", "text": "🎫 Vé thoát đảo — giữ lại, tự dùng khi bị kẹt ở Đảo hoang.", "keep": True},
    {"key": "angel", "text": "😇 Thiên thần hộ mệnh — lần tới phải trả tiền thuê sẽ được miễn.", "keep": True},
    {"key": "angel", "text": "😇 Thiên thần hộ mệnh — lần tới phải trả tiền thuê sẽ được miễn.", "keep": True},
    {"key": "half", "text": "🏷️ Phiếu giảm giá — lần tới chỉ phải trả 50% tiền thuê.", "keep": True},
    {"key": "half", "text": "🏷️ Phiếu giảm giá — lần tới chỉ phải trả 50% tiền thuê.", "keep": True},
    {"key": "quake", "text": "🌋 Động đất! Công trình đắt nhất của một đối thủ bị phá mất 1 cấp (khách sạn không ảnh hưởng)."},
    {"key": "quake", "text": "🌋 Động đất! Công trình đắt nhất của một đối thủ bị phá mất 1 cấp (khách sạn không ảnh hưởng)."},
    {"key": "start", "text": "🏁 Đi thẳng về Xuất phát và nhận lương."},
    {"key": "tour", "text": "✈️ Được tặng vé bay — tới ngay World Tour."},
    {"key": "champ", "text": "🏆 Được mời tới World Championship."},
    {"key": "island", "text": "🌊 Đắm tàu! Dạt vào Đảo hoang."},
    {"key": "money", "amount": 150, "text": "🎰 Trúng xổ số! Nhận $150K."},
    {"key": "money", "amount": 80, "text": "💼 Thưởng kinh doanh. Nhận $80K."},
    {"key": "money", "amount": -100, "text": "🚓 Bị phạt vi phạm giao thông. Trả $100K."},
    {"key": "back", "steps": 3, "text": "↩️ Quên hộ chiếu! Lùi lại 3 ô."},
]


def money_str(n):
    return f"${n:,}K".replace(",", ".")


def house_cost(i):
    return SQ[i]["price"] // 2


def hotel_cost(i):
    return SQ[i]["price"]


def level_cost(i, frm, to):
    """Chi phí nâng thành phố `i` từ cấp `frm` lên cấp `to` (frm = -1: chưa mua đất)."""
    cost = 0
    for lv in range(frm + 1, to + 1):
        cost += SQ[i]["price"] if lv == 0 else hotel_cost(i) if lv == HOTEL else house_cost(i)
    return cost


class TyPhuGame(TyPhuBotMixin, BaseGame):
    id = "cotyphu"
    name = "Cờ Tỷ Phú"
    icon = "🎩"
    description = "Kiểu Business Tour: đi vòng quanh thế giới, mua thành phố kèm xây nhà, mua lại đất của đối thủ, giành độc quyền để thắng sớm!"
    min_players = 2
    max_players = 4
    guide = [
        ("🎯 Cách thắng", [
            "**Độc quyền 3 vùng**: sở hữu toàn bộ thành phố của 3 vùng bất kỳ.",
            "**Độc quyền một cạnh**: sở hữu mọi thành phố và khu nghỉ dưỡng trên một cạnh bàn cờ.",
            "**Độc quyền nghỉ dưỡng**: sở hữu cả 4 khu nghỉ dưỡng.",
            "Hoặc khiến mọi người khác **phá sản**. Hết số vòng giới hạn thì ai có **tổng tài sản** lớn nhất thắng.",
        ]),
        ("🎲 Đến lượt", [
            "Đổ 2 xúc xắc, đi theo tổng. Mỗi lần đi qua **Xuất phát** nhận **$300K**.",
            "Ra **đôi** được đổ tiếp; ra đôi **3 lần liền** thì dạt ra **Đảo hoang**.",
        ]),
        ("🏙️ Mua & xây", [
            "Dừng ở thành phố chưa có chủ: **mua đất và xây luôn nhà** trong một lần (chọn cấp muốn xây).",
            "Nhà có 3 cấp: **nhà cấp 1 → cấp 3**, rồi **khách sạn**. Vòng đầu chỉ được xây tối đa **nhà cấp 2**; từ vòng 2 xây tới nhà cấp 3.",
            "**Khách sạn** chỉ nâng cấp được từ **nhà cấp 3**, từ vòng 2 trở đi (dừng lại ở thành phố đã có nhà cấp 3 của mình).",
            "Dừng ở thành phố của mình thì được **xây thêm**. Sở hữu cả vùng → tiền thuê **×2**.",
            "**Khu nghỉ dưỡng** không xây được; có càng nhiều khu thì tiền thuê càng cao.",
        ]),
        ("💸 Đất của người khác", [
            "Trả tiền thuê cho chủ đất, sau đó được **mua lại** với **giá gấp đôi** giá trị (không cần chủ đồng ý).",
            "**Bãi biển** và thành phố đã có **khách sạn** thì **không thể bị mua lại**.",
        ]),
        ("✨ Ô đặc biệt", [
            "🏆 **World Championship**: chọn một thành phố của bạn để tổ chức giải. Cả bàn chỉ có **một** nơi tổ chức — người sau tổ chức thì nơi cũ **mất** giải. Mỗi lần có người tổ chức, hệ số tăng thêm: ×2 → ×3 → ×4 → ×5.",
            "✈️ **World Tour**: lượt sau được bay tới một thành phố chưa có chủ hoặc của chính bạn (phí $50K) thay vì đổ xúc xắc.",
            "🏝️ **Đảo hoang**: kẹt tối đa 3 lượt. Thoát bằng đổ ra đôi, nộp $200K hoặc dùng vé thoát đảo.",
            "🎴 **Cơ hội**: rút thẻ — vé thoát đảo, thiên thần (miễn tiền thuê), phiếu giảm 50%, động đất phá nhà đối thủ…",
            "🧾 **Cục thuế**: nộp 10% tổng tài sản.",
        ]),
        ("💥 Hết tiền", "Phải bán thành phố cho ngân hàng (được nửa giá trị) để trả nợ. Bán hết vẫn không đủ thì phá sản — mọi thành phố trở về ngân hàng."),
    ]

    def __init__(self, room):
        super().__init__(room)
        self.config = {"money": 2000, "max_rounds": 20, "turn_time": 20}
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
        self.money = {}
        self.pos = {}
        self.laps = {}
        self.island = {}          # pid -> số lượt đã kẹt ở đảo
        self.cards = {}           # pid -> {"escape": n, "angel": n, "half": n}
        self.tour_ready = set()   # ai được bay World Tour ở lượt kế tiếp
        self.bankrupt = []
        self.props = {i: {"owner": None, "level": 0, "champ": 0} for i in OWNABLE}
        self.champ_count = 0      # số lần World Championship đã được tổ chức trong ván
        self.cur = 0
        self.stage = None         # roll · island · tour · rolling · moving · buy · upgrade · buyout · champ · card · debt
        self.dice = None
        self.doubles = 0
        self.again = False
        self.round = 1
        self.pending = None       # ô đang chờ quyết định (mua / xây / mua lại)
        self.debt = None
        self.card = None
        self.winner = None
        self.win_reason = None
        self.deck = random.sample(range(len(CARDS)), len(CARDS))
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
        if len(self.log) > 250:
            self.log = self.log[-250:]

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

    @property
    def current(self):
        return self.order[self.cur] if self.phase == "play" and self.order else None

    def _alive(self):
        return [p for p in self.order if p not in self.bankrupt]

    def _require_turn(self, pid, *stages):
        if self.phase != "play" or pid != self.current:
            raise GameError("Chưa đến lượt của bạn.")
        if stages and self.stage not in stages:
            raise GameError("Chưa thể làm việc này lúc này.")

    def _owned(self, pid):
        return [i for i in OWNABLE if self.props[i]["owner"] == pid]

    def _has_group(self, pid, g):
        return all(self.props[i]["owner"] == pid for i in GROUP_MEMBERS[g])

    def _max_level(self, pid):
        """Cấp nhà cao nhất được xây thẳng: vòng đầu nhà cấp 2, các vòng sau nhà cấp 3 (khách sạn nâng từ cấp 3)."""
        return 2 if self.laps.get(pid, 0) == 0 else MAX_HOUSE

    def _build_levels(self, pid, frm):
        """Các cấp có thể xây tới từ cấp `frm` (-1 = chưa mua đất). Khách sạn chỉ nâng từ nhà cấp 3, từ vòng 2."""
        if frm == MAX_HOUSE:
            return [HOTEL] if self.laps.get(pid, 0) > 0 else []
        return list(range(frm + 1, self._max_level(pid) + 1))

    def _can_upgrade(self, pid, i):
        lv = self.props[i]["level"]
        levels = self._build_levels(pid, lv)
        return bool(levels) and self.money[pid] >= level_cost(i, lv, levels[0])

    def _value(self, i):
        """Giá trị đã đầu tư vào ô (đất + công trình) — dùng để tính giá mua lại / bán / tài sản."""
        p = self.props[i]
        if p["owner"] is None:
            return 0
        if SQ[i]["type"] == "resort":
            return SQ[i]["price"]
        return level_cost(i, -1, p["level"])

    def _rent(self, i):
        p = self.props[i]
        owner = p["owner"]
        if owner is None:
            return 0
        if SQ[i]["type"] == "resort":
            n = sum(1 for j in RESORTS if self.props[j]["owner"] == owner)
            return RESORT_RENT[n]
        rent = int(SQ[i]["price"] * RENT_MULT[p["level"]])
        if self._has_group(owner, SQ[i]["group"]):
            rent *= 2
        return rent * (1 + p["champ"])

    def _buyout_price(self, i):
        return self._value(i) * 2

    def _can_buyout(self, i):
        p = self.props[i]
        return p["owner"] is not None and SQ[i]["type"] == "city" and p["level"] != HOTEL

    def _net_worth(self, pid):
        return self.money.get(pid, 0) + sum(self._value(i) for i in self._owned(pid))

    def _sell_value(self, i):
        return self._value(i) // 2

    def _raisable(self, pid):
        return self.money.get(pid, 0) + sum(self._sell_value(i) for i in self._owned(pid))

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
                log.exception("Lỗi hẹn giờ Cờ Tỷ Phú")
            await self.room.broadcast_state()

    def _stop_timer(self):
        self._token += 1
        self.deadline = self.phase_total = None

    DECISIONS = ("roll", "island", "tour", "buy", "upgrade", "buyout", "champ", "debt")

    def _decision_timer(self):
        pid = self.current
        if pid is None or self.stage not in self.DECISIONS:
            return
        if not self._connected(pid):
            self._set_timer(OFFLINE_TIME, self._auto)
        elif self.config["turn_time"]:
            self._set_timer(self.config["turn_time"], self._auto)
        else:
            self._stop_timer()

    def _auto(self):
        """Hết giờ / người chơi vắng mặt: làm lựa chọn an toàn thay họ."""
        pid = self.current
        if pid is None:
            return
        st = self.stage
        if st in ("roll", "island"):
            self._act_roll(pid, {})
        elif st == "tour":
            self._act_roll(pid, {})
        elif st in ("buy", "upgrade", "buyout", "champ"):
            self._act_skip(pid, {})
        elif st == "debt":
            self._act_auto_pay(pid, {}) if self._raisable(pid) >= self.debt["amount"] else self._act_bankrupt(pid, {})

    def dispose(self):
        self._token += 1
        self._disposed = True

    # ------------------------------------------------------------------ core hooks
    def can_remove(self, pid):
        return self.phase != "play" or pid not in self.order or pid in self.bankrupt

    def can_rename(self):
        return self.phase != "play"

    def status(self):
        if self.phase == "lobby":
            return {"label": "Đang chờ", "joinable": True}
        if self.phase == "end":
            return {"label": "Nghỉ giữa ván", "joinable": True}
        return {"label": f"Đang chơi · vòng {self.round}", "joinable": False}

    async def on_player_join(self, player):
        self._post_chat("system", f"👋 {player.name} đã vào phòng.")

    async def on_player_removed(self, player):
        self.names[player.id] = player.name
        self._post_chat("system", f"🚪 {player.name} đã rời phòng.")

    async def on_player_disconnect(self, player):
        if player.id == self.current:
            self._decision_timer()

    async def on_player_connect(self, player):
        if player.id == self.current:
            self._decision_timer()

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
        for key, allowed in (("money", START_MONEY), ("max_rounds", MAX_ROUNDS), ("turn_time", TURN_TIMES)):
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
        self._reset_game()
        self.game_no += 1
        self.phase = "play"
        self.order = self.participants()
        random.shuffle(self.order)
        for i, p in enumerate(self.order):
            self.names[p] = self._name(p)
            self.colors[p] = PLAYER_COLORS[i % len(PLAYER_COLORS)]
            self.money[p] = self.config["money"]
            self.pos[p] = 0
            self.laps[p] = 0
            self.cards[p] = {"escape": 0, "angel": 0, "half": 0}
            self.wins.setdefault(p, 0)
        limit = f", tối đa {self.config['max_rounds']} vòng" if self.config["max_rounds"] else ""
        self._post_chat("system", f"🌍 Ván {self.game_no} bắt đầu! Mỗi người {money_str(self.config['money'])}{limit}.")
        self._add_log(f"🌍 Ván {self.game_no} bắt đầu. {self._name(self.order[0])} đi trước.", "start")
        self.cur = 0
        self._begin_turn()

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
            raise GameError("Không có ván nào đang diễn ra.")
        self._post_chat("system", "🛑 Chủ phòng đã kết thúc ván — tính theo tổng tài sản.")
        self._end_game(None, "Kết thúc sớm — tính theo tổng tài sản")

    # ------------------------------------------------------------------ lượt chơi
    def _begin_turn(self, again=False):
        pid = self.current
        self.pending = None
        self.card = None
        if not again:
            self.doubles = 0
        self.again = False
        if pid in self.island:
            self.stage = "island"
        elif pid in self.tour_ready:
            self.stage = "tour"
        else:
            self.stage = "roll"
        self._event("turn", pid, again=again)
        self._decision_timer()

    def _next_turn(self):
        if len(self._alive()) <= 1:
            self._end_game(self._alive()[0] if self._alive() else None, "Mọi đối thủ đã phá sản")
            return
        n = len(self.order)
        prev = self.cur
        for k in range(1, n + 1):
            j = (prev + k) % n
            if self.order[j] not in self.bankrupt:
                if j <= prev:
                    self.round += 1
                    if self.config["max_rounds"] and self.round > self.config["max_rounds"]:
                        self._add_log(f"⏰ Đã hết {self.config['max_rounds']} vòng!", "end")
                        self._end_game(None, f"Hết {self.config['max_rounds']} vòng — người giàu nhất thắng")
                        return
                    self._add_log(f"🔄 Vòng {self.round}.", "round")
                self.cur = j
                break
        self._begin_turn()

    def _end_action(self):
        """Xong việc ở ô vừa đến: ra đôi thì đổ tiếp, không thì sang lượt người sau."""
        if self.phase != "play":
            return
        pid = self.current
        self.pending = None
        self.card = None
        if pid in self.bankrupt:
            self._next_turn()
            return
        if self.again and pid not in self.island:
            self._add_log(f"🎲 {self._name(pid)} ra đôi — được đổ tiếp!", "roll")
            self._begin_turn(again=True)
        else:
            self._next_turn()

    def _act_roll(self, pid, data):
        self._require_turn(pid, "roll", "island", "tour")
        if self.stage == "tour":
            self.tour_ready.discard(pid)
        d1, d2 = random.randint(1, 6), random.randint(1, 6)
        self.dice = [d1, d2]
        total = d1 + d2
        double = d1 == d2
        name = self._name(pid)
        self._event("roll", pid, dice=[d1, d2])
        stage_before = self.stage
        self.stage = "rolling"
        if stage_before == "island":
            if double:
                del self.island[pid]
                self._add_log(f"🎲 {name} đổ {d1}+{d2} — ra đôi, thoát khỏi Đảo hoang!", "island")
                self.again = False
                self._set_timer(ROLL_TIME, lambda: self._move(pid, total))
                return
            self.island[pid] += 1
            if self.island[pid] >= 3:
                del self.island[pid]
                self._add_log(f"🎲 {name} đổ {d1}+{d2} — hết 3 lượt, được rời đảo.", "island")
                self._set_timer(ROLL_TIME, lambda: self._move(pid, total))
                return
            self._add_log(f"🎲 {name} đổ {d1}+{d2} — vẫn kẹt ở Đảo hoang ({self.island[pid]}/3).", "island")
            self._set_timer(ROLL_TIME, self._end_action)
            return
        if double:
            self.doubles += 1
            if self.doubles >= 3:
                self._add_log(f"🎲 {name} ra đôi 3 lần liền — dạt vào Đảo hoang!", "island")
                self._set_timer(ROLL_TIME, lambda: self._to_island(pid))
                return
        self.again = double
        self._add_log(f"🎲 {name} đổ {d1} + {d2} = {total}{' (đôi!)' if double else ''}.", "roll")
        self._set_timer(ROLL_TIME, lambda: self._move(pid, total))

    def _act_pay_island(self, pid, data):
        self._require_turn(pid, "island")
        if self.money[pid] < ISLAND_FEE:
            raise GameError(f"Không đủ {money_str(ISLAND_FEE)}.")
        self.money[pid] -= ISLAND_FEE
        del self.island[pid]
        self._event("pay", pid, amount=ISLAND_FEE, to=[])
        self._add_log(f"💵 {self._name(pid)} nộp {money_str(ISLAND_FEE)} để rời Đảo hoang.", "island")
        self.stage = "roll"
        self._decision_timer()

    def _act_use_escape(self, pid, data):
        self._require_turn(pid, "island")
        if not self.cards[pid]["escape"]:
            raise GameError("Bạn không có vé thoát đảo.")
        self.cards[pid]["escape"] -= 1
        del self.island[pid]
        self._add_log(f"🎫 {self._name(pid)} dùng vé thoát đảo.", "island")
        self.stage = "roll"
        self._decision_timer()

    def _tour_ok(self, pid, i):
        """World Tour chỉ bay tới thành phố / khu nghỉ dưỡng chưa có chủ hoặc của chính mình."""
        return i in self.props and self.props[i]["owner"] in (None, pid)

    def _act_tour(self, pid, data):
        self._require_turn(pid, "tour")
        try:
            target = int(data.get("square"))
        except (TypeError, ValueError):
            raise GameError("Hãy chọn một ô để bay tới.")
        if not self._tour_ok(pid, target):
            raise GameError("World Tour chỉ bay tới đất chưa có chủ hoặc đất của chính bạn.")
        if self.money[pid] < TOUR_FEE:
            raise GameError(f"Không đủ {money_str(TOUR_FEE)} tiền vé.")
        self.money[pid] -= TOUR_FEE
        self.tour_ready.discard(pid)
        self.again = False
        self._event("pay", pid, amount=TOUR_FEE, to=[])
        self._add_log(f"✈️ {self._name(pid)} bay tới {SQ[target]['name']} (vé {money_str(TOUR_FEE)}).", "tour")
        self._move_to(pid, target, fly=True)

    # ------------------------------------------------------------------ di chuyển
    def _move(self, pid, steps):
        self._move_to(pid, (self.pos[pid] + steps) % N)

    def _move_to(self, pid, target, back=False, fly=False):
        start = self.pos[pid]
        steps = (start - target) % N if back else (target - start) % N
        self.pos[pid] = target
        self.stage = "moving"
        salary = not back and steps > 0 and start + steps >= N
        self._event("move", pid, frm=start, to=target, back=back, fly=fly)
        self._set_timer(0.5 + steps * (FLY_STEP if fly else MOVE_STEP), lambda: self._land(pid, salary))

    def _to_island(self, pid):
        self.pos[pid] = ISLAND
        self.island[pid] = 0
        self.again = False
        self.doubles = 0
        self._event("island", pid)
        self._add_log(f"🏝️ {self._name(pid)} bị kẹt ở Đảo hoang!", "island")
        self._end_action()

    def _land(self, pid, salary):
        name = self._name(pid)
        if salary:
            self.laps[pid] += 1
            self.money[pid] += SALARY
            self._event("money", pid, amount=SALARY)
            self._add_log(f"🏁 {name} qua Xuất phát, nhận lương {money_str(SALARY)} (vòng {self.laps[pid] + 1}).", "money")
        i = self.pos[pid]
        s = SQ[i]
        t = s["type"]
        if t in ("city", "resort"):
            p = self.props[i]
            if p["owner"] is None:
                if self.money[pid] >= s["price"]:
                    self._ask(pid, "buy", i)
                    return
                self._add_log(f"😕 {name} dừng ở {s['name']} nhưng không đủ tiền mua.", "info")
            elif p["owner"] == pid:
                if t == "city" and self._can_upgrade(pid, i):
                    self._ask(pid, "upgrade", i)
                    return
            else:
                self._pay_rent(pid, i)
                return
        elif t == "chance":
            idx = self.deck.pop(0)
            self.deck.append(idx)
            card = CARDS[idx]
            self.card = {"text": card["text"], "pid": pid}
            self.stage = "card"
            self._event("card", pid, text=card["text"])
            self._add_log(f"🎴 {name} rút thẻ: {card['text']}", "card")
            self._set_timer(CARD_TIME, lambda: self._apply_card(pid, card))
            return
        elif t == "tax":
            tax = max(10, self._net_worth(pid) // 10)
            self._add_log(f"🧾 {name} nộp thuế {money_str(tax)} (10% tổng tài sản).", "rent")
            if not self._charge(pid, tax, None, "tiền thuế"):
                return
        elif t == "island":
            self._to_island(pid)
            return
        elif t == "champ":
            if any(SQ[j]["type"] == "city" for j in self._owned(pid)):
                self._ask(pid, "champ", None)
                return
            self._add_log(f"🏆 {name} tới World Championship nhưng chưa có thành phố để tổ chức.", "info")
        elif t == "tour":
            self.tour_ready.add(pid)
            self._add_log(f"✈️ {name} tới World Tour — lượt sau được bay tới ô bất kỳ.", "tour")
        self._end_action()

    def _ask(self, pid, stage, square):
        self.stage = stage
        self.pending = square
        self._decision_timer()

    # ------------------------------------------------------------------ tiền thuê & nợ
    def _pay_rent(self, pid, i):
        owner = self.props[i]["owner"]
        rent = self._rent(i)
        name = self._name(pid)
        c = self.cards[pid]
        if c["angel"]:
            c["angel"] -= 1
            self._event("angel", pid)
            self._add_log(f"😇 Thiên thần giúp {name} không phải trả {money_str(rent)} tiền thuê ở {SQ[i]['name']}!", "card")
            self._after_rent(pid, i)
            return
        if c["half"]:
            c["half"] -= 1
            rent //= 2
            self._add_log(f"🏷️ {name} dùng phiếu giảm giá — chỉ trả 50%.", "card")
        self._event("rent", pid, to=owner, amount=rent, square=i)
        self._add_log(f"💸 {name} trả {money_str(rent)} tiền thuê {SQ[i]['name']} cho {self._name(owner)}.", "rent")
        if self._charge(pid, rent, owner, f"tiền thuê {SQ[i]['name']}", then=lambda: self._after_rent(pid, i)):
            self._after_rent(pid, i)

    def _after_rent(self, pid, i):
        if self.phase == "play" and self._can_buyout(i) and self.money[pid] >= self._buyout_price(i):
            self._ask(pid, "buyout", i)
            return
        self._end_action()

    def _charge(self, pid, amount, to, reason, then=None):
        """Trừ tiền; thiếu thì chuyển sang bước nợ (bán thành phố để trả). Trả về True nếu đã trả xong."""
        if amount <= 0:
            return True
        if self.money[pid] >= amount:
            self.money[pid] -= amount
            if to:
                self.money[to] += amount
            self._event("pay", pid, amount=amount, to=[to] if to else [])
            return True
        self.debt = {"amount": amount, "to": to, "reason": reason, "then": then or self._end_action}
        self.stage = "debt"
        self._event("debt", pid, amount=amount)
        self._add_log(f"⚠️ {self._name(pid)} không đủ tiền trả {money_str(amount)} ({reason}) — phải bán thành phố.", "debt")
        self._decision_timer()
        return False

    def _check_debt(self, pid):
        if self.stage == "debt" and self.money[pid] >= self.debt["amount"]:
            d = self.debt
            self.debt = None
            self.money[pid] -= d["amount"]
            if d["to"]:
                self.money[d["to"]] += d["amount"]
            self._event("pay", pid, amount=d["amount"], to=[d["to"]] if d["to"] else [])
            self._add_log(f"✅ {self._name(pid)} đã trả xong {money_str(d['amount'])} ({d['reason']}).", "money")
            self.stage = "landed"
            d["then"]()

    def _sell(self, pid, i):
        gain = self._sell_value(i)
        self.money[pid] += gain
        self.props[i] = {"owner": None, "level": 0, "champ": 0}
        self._event("sell", pid, square=i)
        self._add_log(f"🏦 {self._name(pid)} bán {SQ[i]['name']} cho ngân hàng (+{money_str(gain)}).", "sell")

    def _act_sell(self, pid, data):
        self._require_turn(pid, "debt")
        try:
            i = int(data.get("square"))
        except (TypeError, ValueError):
            raise GameError("Ô không hợp lệ.")
        if i not in self.props or self.props[i]["owner"] != pid:
            raise GameError("Đây không phải thành phố của bạn.")
        self._sell(pid, i)
        self._check_debt(pid)

    def _act_auto_pay(self, pid, data):
        self._require_turn(pid, "debt")
        if self._raisable(pid) < self.debt["amount"]:
            raise GameError("Bán hết cũng không đủ — chỉ còn cách phá sản.")
        while self.money[pid] < self.debt["amount"]:
            i = min(self._owned(pid), key=self._value)  # bán thành phố rẻ nhất trước
            self._sell(pid, i)
        self._check_debt(pid)

    def _act_bankrupt(self, pid, data):
        self._require_turn(pid, "debt")
        to = self.debt["to"]
        for i in self._owned(pid):
            self.props[i] = {"owner": None, "level": 0, "champ": 0}
        if to:
            self.money[to] += self.money[pid]
        self.money[pid] = 0
        self.island.pop(pid, None)
        self.tour_ready.discard(pid)
        self.bankrupt.append(pid)
        self.debt = None
        self._event("bankrupt", pid)
        text = f"💥 {self._name(pid)} phá sản! Mọi thành phố trở về ngân hàng."
        self._add_log(text, "bankrupt")
        self._post_chat("system", text)
        self._next_turn()

    # ------------------------------------------------------------------ mua, xây, mua lại
    def _act_buy(self, pid, data):
        """Mua thành phố/khu nghỉ dưỡng (stage buy), xây thêm (upgrade) — `level` là cấp muốn đạt tới."""
        self._require_turn(pid, "buy", "upgrade")
        i = self.pending
        s = SQ[i]
        p = self.props[i]
        name = self._name(pid)
        if s["type"] == "resort":
            if self.money[pid] < s["price"]:
                raise GameError("Không đủ tiền.")
            self.money[pid] -= s["price"]
            p["owner"] = pid
            self._event("buy", pid, square=i)
            self._add_log(f"🏖️ {name} mua khu nghỉ dưỡng {s['name']} giá {money_str(s['price'])}.", "buy")
        else:
            try:
                level = int(data.get("level", 0))
            except (TypeError, ValueError):
                raise GameError("Cấp xây dựng không hợp lệ.")
            frm = -1 if self.stage == "buy" else p["level"]
            if level not in self._build_levels(pid, frm):
                raise GameError(f"Hiện chỉ được xây tới {LEVEL_NAMES[self._max_level(pid)].lower()} (khách sạn chỉ nâng từ nhà cấp 3, từ vòng 2).")
            cost = level_cost(i, frm, level)
            if self.money[pid] < cost:
                raise GameError(f"Không đủ tiền — cần {money_str(cost)}.")
            self.money[pid] -= cost
            p["owner"] = pid
            p["level"] = level
            self._event("build" if frm >= 0 else "buy", pid, square=i)
            verb = "xây thêm ở" if frm >= 0 else "mua"
            self._add_log(f"🏗️ {name} {verb} {s['name']} → {LEVEL_NAMES[level].lower()} ({money_str(cost)}).", "buy")
            if frm < 0:
                self._announce_monopoly(pid, i)
        if self._check_win(pid):
            return
        self._end_action()

    def _act_buyout(self, pid, data):
        self._require_turn(pid, "buyout")
        i = self.pending
        price = self._buyout_price(i)
        if self.money[pid] < price:
            raise GameError(f"Không đủ tiền — cần {money_str(price)}.")
        old = self.props[i]["owner"]
        self.money[pid] -= price
        self.money[old] += price
        self.props[i]["owner"] = pid
        self._event("buyout", pid, square=i, frm=old, amount=price)
        self._add_log(f"🤝 {self._name(pid)} mua lại {SQ[i]['name']} của {self._name(old)} với giá {money_str(price)}!", "buyout")
        self._announce_monopoly(pid, i)
        if self._check_win(pid):
            return
        p = self.props[i]
        if SQ[i]["type"] == "city" and self._can_upgrade(pid, i):
            self._ask(pid, "upgrade", i)
            return
        self._end_action()

    def _announce_monopoly(self, pid, i):
        """Vừa gom đủ cả vùng → sự kiện độc quyền (giao diện chạy hiệu ứng đặc biệt)."""
        g = SQ[i].get("group")
        if SQ[i]["type"] == "city" and g and self._has_group(pid, g):
            self._event("monopoly", pid, group=g, squares=GROUP_MEMBERS[g])
            self._add_log(f"👑 {self._name(pid)} độc quyền vùng {GROUPS[g]['name']} — tiền thuê ×2!", "buy")

    def _act_champ(self, pid, data):
        self._require_turn(pid, "champ")
        try:
            i = int(data.get("square"))
        except (TypeError, ValueError):
            raise GameError("Hãy chọn một thành phố của bạn.")
        if i not in self.props or self.props[i]["owner"] != pid or SQ[i]["type"] != "city":
            raise GameError("Hãy chọn một thành phố của bạn.")
        # Chỉ một nơi tổ chức: nơi cũ mất giải; hệ số tăng dần theo số lần tổ chức trong ván.
        lost = [j for j, q in self.props.items() if q["champ"] and j != i]
        for j in self.props:
            self.props[j]["champ"] = 0
        self.champ_count = min(CHAMP_MAX, self.champ_count + 1)
        self.props[i]["champ"] = self.champ_count
        self._event("champ", pid, square=i, lost=lost)
        for j in lost:
            self._add_log(f"🏆 {SQ[j]['name']} mất quyền đăng cai World Championship.", "champ")
        self._add_log(f"🏆 {self._name(pid)} tổ chức World Championship ở {SQ[i]['name']} — tiền thuê ×{1 + self.champ_count}!", "champ")
        self._end_action()

    def _act_skip(self, pid, data):
        self._require_turn(pid, "buy", "upgrade", "buyout", "champ")
        self._end_action()

    # ------------------------------------------------------------------ thẻ cơ hội
    def _apply_card(self, pid, card):
        self.card = None
        k = card["key"]
        if card.get("keep"):
            self.cards[pid][k] += 1
        elif k == "quake":
            targets = [(self._value(i), i) for q in self._alive() if q != pid for i in self._owned(q)
                       if SQ[i]["type"] == "city" and 0 < self.props[i]["level"] < HOTEL]
            if targets:
                _, i = max(targets)
                self.props[i]["level"] -= 1
                self._event("quake", pid, square=i)
                self._add_log(f"🌋 Động đất phá 1 cấp công trình ở {SQ[i]['name']} của {self._name(self.props[i]['owner'])}.", "card")
            else:
                self._add_log("🌋 Động đất… nhưng không có công trình nào bị ảnh hưởng.", "card")
        elif k == "start":
            self._move_to(pid, 0)
            return
        elif k == "tour":
            self._move_to(pid, TOUR)
            return
        elif k == "champ":
            self._move_to(pid, CHAMP)
            return
        elif k == "island":
            self._to_island(pid)
            return
        elif k == "back":
            self._move_to(pid, (self.pos[pid] - card["steps"]) % N, back=True)
            return
        elif k == "money":
            amt = card["amount"]
            if amt > 0:
                self.money[pid] += amt
                self._event("money", pid, amount=amt)
            elif not self._charge(pid, -amt, None, "tiền phạt"):
                return
        self._end_action()

    # ------------------------------------------------------------------ thắng / kết thúc
    def _check_win(self, pid):
        groups = [g for g in GROUPS if self._has_group(pid, g)]
        if len(groups) >= 3:
            names = ", ".join(GROUPS[g]["name"] for g in groups[:3])
            self._end_game(pid, f"Độc quyền 3 vùng ({names})")
            return True
        for k, side in enumerate(SIDES):
            if all(self.props[i]["owner"] == pid for i in side):
                self._end_game(pid, f"Độc quyền cạnh bàn số {k + 1}")
                return True
        if all(self.props[i]["owner"] == pid for i in RESORTS):
            self._end_game(pid, "Độc quyền cả 4 khu nghỉ dưỡng")
            return True
        return False

    def _end_game(self, winner, reason):
        self._stop_timer()
        self.phase = "end"
        self.stage = None
        if winner is None:
            alive = self._alive()
            winner = max(alive, key=self._net_worth) if alive else None
        self.winner = winner
        self.win_reason = reason
        if winner:
            self.wins[winner] = self.wins.get(winner, 0) + 1
            text = f"🏆 {self._name(winner)} thắng ván {self.game_no}! ({reason})"
            self._add_log(text, "end")
            self._post_chat("system", text)
            self._event("win", winner)

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
                "color": self.colors.get(p_id),
                "money": self.money.get(p_id, 0),
                "pos": self.pos.get(p_id, 0),
                "laps": self.laps.get(p_id, 0),
                "maxLevel": self._max_level(p_id) if in_game else 1,
                "island": self.island.get(p_id) if p_id in self.island else None,
                "tour": p_id in self.tour_ready,
                "cards": self.cards.get(p_id),
                "bankrupt": p_id in self.bankrupt,
                "worth": self._net_worth(p_id) if in_game else 0,
                "wins": self.wins.get(p_id, 0),
            })
        props = {}
        for i, p in self.props.items():
            if p["owner"] is not None:
                props[str(i)] = {**p, "rent": self._rent(i), "value": self._value(i),
                                 "buyout": self._buyout_price(i) if self._can_buyout(i) else None,
                                 "sell": self._sell_value(i)}
        cur = self.current
        offer = None
        if self.phase == "play" and self.pending is not None and self.stage in ("buy", "upgrade", "buyout"):
            i = self.pending
            s = SQ[i]
            if self.stage == "buyout":
                offer = {"square": i, "price": self._buyout_price(i), "owner": self.props[i]["owner"]}
            elif s["type"] == "resort":
                offer = {"square": i, "levels": [{"level": 0, "cost": s["price"]}]}
            else:
                frm = -1 if self.stage == "buy" else self.props[i]["level"]
                offer = {"square": i, "levels": [{"level": lv, "cost": level_cost(i, frm, lv),
                                                  "rent": int(s["price"] * RENT_MULT[lv])}
                                                 for lv in self._build_levels(cur, frm)]}
        return {
            "phase": self.phase,
            "stage": self.stage,
            "round": self.round,
            "gameNo": self.game_no,
            "me": {"id": pid, "host": pid == self.room.host_id, "playing": pid in self.order,
                   "raisable": self._raisable(pid) if pid in self.order else 0},
            "players": players,
            "props": props,
            "turn": cur,
            "myTurn": cur == pid and self.phase == "play",
            "dice": self.dice,
            "pending": self.pending,
            "offer": offer,
            "debt": {"amount": self.debt["amount"], "reason": self.debt["reason"]} if self.debt else None,
            "card": self.card,
            "winner": self.winner,
            "winReason": self.win_reason,
            "fees": {"island": ISLAND_FEE, "tour": TOUR_FEE, "salary": SALARY},
            "deadline": self.deadline,
            "total": self.phase_total,
            "now": time.time(),
            "events": self.events[-15:],
            "config": self.config,
            "choices": {"money": START_MONEY, "max_rounds": MAX_ROUNDS, "turn_time": TURN_TIMES},
            "minPlayers": self.min_players,
            "maxPlayers": self.max_players,
            "startError": self._start_error() if self.phase != "play" else None,
            "chat": self.chat[-150:],
            "log": self.log[-100:],
        }
