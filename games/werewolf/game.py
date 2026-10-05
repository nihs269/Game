"""Ma Sói — máy chủ đóng vai quản trò, tự động điều khiển ngày/đêm."""
import asyncio
import logging
import random
import time
from collections import Counter

from core.game_base import BaseGame, GameError
from .bots import WerewolfBotMixin

log = logging.getLogger("gamehub.werewolf")

ROLES = {
    "werewolf": {
        "name": "Ma Sói", "icon": "🐺", "team": "wolf",
        "desc": "Mỗi đêm cùng bầy Sói thống nhất chọn một người để cắn. "
                "Phe Sói thắng khi số Sói bằng hoặc nhiều hơn số người còn lại.",
    },
    "seer": {
        "name": "Tiên Tri", "icon": "🔮", "team": "village",
        "desc": "Mỗi đêm được soi một người để biết người đó có phải Ma Sói hay không.",
    },
    "bodyguard": {
        "name": "Bảo Vệ", "icon": "🛡️", "team": "village",
        "desc": "Mỗi đêm chọn một người (kể cả bản thân) để bảo vệ khỏi Ma Sói. "
                "Không được bảo vệ cùng một người hai đêm liên tiếp.",
    },
    "witch": {
        "name": "Phù Thủy", "icon": "🧪", "team": "village",
        "desc": "Có 1 bình thuốc cứu và 1 bình thuốc độc, mỗi bình chỉ dùng được 1 lần trong cả ván. "
                "Mỗi đêm được biết ai bị Sói cắn để quyết định có cứu hay không.",
    },
    "hunter": {
        "name": "Thợ Săn", "icon": "🏹", "team": "village",
        "desc": "Khi bị giết (trừ khi trúng thuốc độc), được bắn chết ngay một người bất kỳ.",
    },
    "villager": {
        "name": "Dân Làng", "icon": "🧑‍🌾", "team": "village",
        "desc": "Không có năng lực đặc biệt. Hãy quan sát, lập luận và bỏ phiếu treo cổ Ma Sói.",
    },
}
ROLE_ORDER = ["werewolf", "seer", "bodyguard", "witch", "hunter", "villager"]
SPECIAL_LIMITS = {"werewolf": (1, 6), "seer": (0, 1), "bodyguard": (0, 1), "witch": (0, 1), "hunter": (0, 1)}
TIME_LIMITS = {"night_time": (15, 180), "discussion_time": (30, 600), "vote_time": (15, 180)}

REVEAL_TIME = 25
WITCH_TIME = 25
HUNTER_TIME = 25
VERDICT_TIME = 7
GRACE = 3  # giây chờ thêm khi mọi người đã hành động xong


def default_roles(n):
    if n <= 5:
        wolves = 1
    elif n <= 8:
        wolves = 2
    elif n <= 11:
        wolves = 3
    else:
        wolves = min(6, n // 4 + 1)
    return {
        "werewolf": wolves,
        "seer": 1,
        "bodyguard": 1 if n >= 6 else 0,
        "witch": 1 if n >= 7 else 0,
        "hunter": 1 if n >= 8 else 0,
    }


def role_label(role):
    info = ROLES[role]
    return f"{info['icon']} {info['name']}"


class WerewolfGame(WerewolfBotMixin, BaseGame):
    id = "werewolf"
    name = "Ma Sói"
    icon = "🐺"
    description = "Dân làng và bầy Sói đấu trí. Ban đêm Sói đi săn, ban ngày cả làng thảo luận và treo cổ kẻ tình nghi."
    min_players = 4
    max_players = 18
    guide = [
        ("🎯 Mục tiêu", [
            "**Phe Dân** thắng khi đã treo cổ / giết hết Ma Sói.",
            "**Phe Sói** thắng khi số Sói còn sống bằng hoặc nhiều hơn số người còn lại.",
        ]),
        ("🎭 Các vai", [
            "🐺 **Ma Sói** — mỗi đêm cả bầy thống nhất cắn 1 người, có kênh chat riêng ban đêm.",
            "🔮 **Tiên Tri** — mỗi đêm soi 1 người xem có phải Sói không.",
            "🛡️ **Bảo Vệ** — mỗi đêm bảo vệ 1 người (kể cả mình), không được chọn cùng người 2 đêm liên tiếp.",
            "🧪 **Phù Thủy** — 1 bình cứu + 1 bình độc cho cả ván, biết ai vừa bị cắn.",
            "🏹 **Thợ Săn** — khi chết (trừ khi trúng độc) được bắn chết ngay 1 người.",
            "🧑‍🌾 **Dân Làng** — không có năng lực, dựa vào lập luận và lá phiếu.",
        ]),
        ("🌗 Diễn biến một vòng", [
            "**Nhận vai** — xem vai của mình (có nút che vai để tránh bị nhìn trộm).",
            "**Đêm** — Sói chọn người cắn, Tiên Tri soi, Bảo Vệ bảo vệ; sau đó Phù Thủy quyết định cứu/độc.",
            "**Sáng** — công bố người chết trong đêm.",
            "**Thảo luận** — cả làng tranh luận xem ai là Sói.",
            "**Bỏ phiếu** — người nhiều phiếu nhất bị treo cổ. Hoà phiếu hoặc đa số chọn “Bỏ qua” thì không ai bị treo.",
        ]),
        ("🎮 Tạo & bắt đầu ván", [
            "Chủ phòng chỉnh số lượng từng vai (hoặc để tự động theo số người) và thời gian đêm / thảo luận / bỏ phiếu, rồi bấm **Bắt đầu**.",
            "**Lộ vai trò khi chết**: bật thì ai chết sẽ bị công khai vai, và người đã chết được xem vai của mọi người; tắt thì không ai biết vai người chết — kể cả hồn ma cũng không xem được vai người khác hay nghe lén bầy Sói.",
            "Cần ít nhất 4 người. Thiếu người thì bấm **＋ bot** / **Lấp đủ 8 người** — bot tự nhận vai, hành động và bỏ phiếu.",
        ]),
        ("💡 Mẹo", [
            "Chat có kênh chung, kênh riêng của Sói và kênh người chết. Nhật ký lưu cả ghi chú bí mật của riêng bạn (VD: kết quả soi).",
            "Bật 🔊 để nghe giọng quản trò đọc diễn biến.",
            "Nhấn vào người khác để vẫy tay, thả tim, ném cà chua… (ban đêm người còn sống không tương tác được).",
            "Người đã chết vẫn xem tiếp được nhưng không được tiết lộ gì cho người sống!",
        ]),
    ]

    def __init__(self, room):
        super().__init__(room)
        self.config = {
            "roles": default_roles(0),
            "auto_roles": True,
            "night_time": 45,
            "discussion_time": 120,
            "vote_time": 45,
            "reveal_on_death": True,
        }
        self.chat = []
        self._msg_id = 0
        self._token = 0
        self._reset()

    def _reset(self):
        self._token += 1  # vô hiệu hoá mọi bộ đếm giờ cũ
        self.phase = "lobby"
        self.round = 0
        self.deadline = None
        self.phase_total = None
        self.order = []
        self.roles = {}
        self.alive = set()
        self.death_info = {}
        self.ready = set()
        self.night = {}
        self.last_guarded = None
        self.potions = {"heal": True, "poison": True}
        self.votes = {}
        self.hunter = None
        self.hunter_next = None
        self.news = []
        self.log = []
        self.private = {}
        self.winner = None
        self.seer_known = {}
        self._bots_reset()

    # ------------------------------------------------------------------ tiện ích
    def _name(self, pid):
        p = self.room.players.get(pid)
        return p.name if p else "?"

    def _connected(self, pid):
        p = self.room.players.get(pid)
        return bool(p and p.connected)

    def _alive_with(self, role):
        return [p for p in self.order if p in self.alive and self.roles.get(p) == role]

    def _is_wolf(self, pid):
        return self.roles.get(pid) == "werewolf"

    def _in_game(self):
        return self.phase != "lobby"

    def _death_line(self, pid):
        if self.config["reveal_on_death"]:
            return f"{self._name(pid)} ({role_label(self.roles[pid])})"
        return self._name(pid)

    def _add_log(self, text, kind="info"):
        self.log.append({"t": time.time(), "text": text, "kind": kind})

    def _tell(self, pid, text, kind="private"):
        self.private.setdefault(pid, []).append({"t": time.time(), "text": text, "kind": kind})

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

    def _require_phase(self, *phases):
        if self.phase not in phases:
            raise GameError("Không thể làm việc này lúc này.")

    def _require_alive(self, pid, role=None):
        if pid not in self.alive:
            raise GameError("Bạn đã chết.")
        if role and self.roles.get(pid) != role:
            raise GameError("Bạn không có chức năng này.")

    def _target(self, data, allow_none=False):
        target = data.get("target")
        if target is None and allow_none:
            return None
        target = str(target)
        if target not in self.alive:
            raise GameError("Mục tiêu không hợp lệ.")
        return target

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
                log.exception("Lỗi khi chuyển giai đoạn")
            await self.room.broadcast_state()

    def _shorten(self, seconds):
        if self.deadline is not None:
            self.deadline = min(self.deadline, time.time() + seconds)

    def _stop_timer(self):
        self._token += 1
        self.deadline = None
        self.phase_total = None

    def dispose(self):
        self._token += 1
        self._disposed = True

    # ------------------------------------------------------------------ core hooks
    def can_remove(self, pid):
        return self.phase == "lobby" or pid not in self.roles

    def can_rename(self):
        return self.phase == "lobby"

    def status(self):
        if self.phase == "lobby":
            return {"label": "Đang chờ", "joinable": True}
        if self.phase == "end":
            return {"label": "Vừa kết thúc", "joinable": False}
        return {"label": f"Đang chơi · Ngày {self.round}", "joinable": False}

    def _auto_roles(self):
        if self.phase == "lobby" and self.config["auto_roles"]:
            self.config["roles"] = default_roles(len(self.room.players))

    async def on_player_join(self, player):
        self._auto_roles()
        self._post_chat("system", f"👋 {player.name} đã vào phòng.")

    async def on_player_removed(self, player):
        self._auto_roles()
        self._post_chat("system", f"🚪 {player.name} đã rời phòng.")

    async def on_player_disconnect(self, player):
        self._recheck()

    async def on_action(self, player, action, data):
        handler = getattr(self, "_act_" + action, None) if action.isidentifier() else None
        if handler is None:
            raise GameError("Hành động không hợp lệ.")
        handler(player.id, data)

    def _recheck(self):
        if self.phase == "reveal":
            self._check_reveal_ready()
        elif self.phase == "night":
            self._check_night_done()
        elif self.phase == "day":
            self._check_day_ready()
        elif self.phase == "vote":
            self._check_vote_done()

    # ------------------------------------------------------------------ phòng chờ
    def _validate_roles(self, n):
        if n < self.min_players:
            return f"Cần ít nhất {self.min_players} người chơi (hiện có {n})."
        roles = self.config["roles"]
        wolves = roles.get("werewolf", 0)
        if wolves < 1:
            return "Cần ít nhất 1 Ma Sói."
        if sum(roles.values()) > n:
            return "Số vai đặc biệt nhiều hơn số người chơi."
        if wolves * 2 >= n:
            return "Quá nhiều Ma Sói so với số người chơi."
        return None

    def _act_config(self, pid, data):
        self._require_host(pid)
        self._require_phase("lobby")
        cfg = self.config
        if data.get("auto_roles"):
            cfg["auto_roles"] = True
            cfg["roles"] = default_roles(len(self.room.players))
        roles = data.get("roles")
        if isinstance(roles, dict):
            for role, (lo, hi) in SPECIAL_LIMITS.items():
                if role in roles:
                    try:
                        cfg["roles"][role] = max(lo, min(hi, int(roles[role])))
                    except (TypeError, ValueError):
                        pass
            cfg["auto_roles"] = False
        for key, (lo, hi) in TIME_LIMITS.items():
            if key in data:
                try:
                    cfg[key] = max(lo, min(hi, int(data[key])))
                except (TypeError, ValueError):
                    pass
        if "reveal_on_death" in data:
            cfg["reveal_on_death"] = bool(data["reveal_on_death"])

    def _act_start(self, pid, data):
        self._require_host(pid)
        self._require_phase("lobby")
        pids = self.participants()
        err = self._validate_roles(len(pids))
        if err:
            raise GameError(err)
        deck = []
        for role in ROLE_ORDER:
            deck += [role] * self.config["roles"].get(role, 0)
        deck += ["villager"] * (len(pids) - len(deck))
        random.shuffle(deck)

        self._reset()
        self.chat = [m for m in self.chat if m["channel"] in ("all", "system")][-50:]
        self.order = pids
        self.roles = dict(zip(pids, deck))
        self.alive = set(pids)
        wolves = [p for p in pids if self._is_wolf(p)]
        for p in pids:
            role = self.roles[p]
            self._tell(p, f"Vai trò của bạn: {role_label(role)}. {ROLES[role]['desc']}", "role")
            if role == "werewolf":
                mates = [self._name(w) for w in wolves if w != p]
                self._tell(p, "Đồng bọn Sói: " + ", ".join(mates) if mates else "Bạn là con Sói duy nhất.", "wolf")
        self._add_log(f"🎬 Ván đấu bắt đầu với {len(pids)} người chơi.", "start")
        self._post_chat("system", "🎬 Ván đấu bắt đầu! Hãy xem vai trò của bạn.")
        self.phase = "reveal"
        self._set_timer(REVEAL_TIME, self._start_night)

    def _act_ready(self, pid, data):
        if self.phase == "reveal":
            self.ready.add(pid)
            self._check_reveal_ready()
        elif self.phase == "day":
            self._require_alive(pid)
            if pid in self.ready:
                self.ready.discard(pid)
            else:
                self.ready.add(pid)
            self._check_day_ready()
        else:
            raise GameError("Không thể làm việc này lúc này.")

    def _act_skip(self, pid, data):
        self._require_host(pid)
        if self.phase == "reveal":
            self._start_night()
        elif self.phase == "day":
            self._post_chat("system", "⏭ Chủ phòng đã kết thúc thảo luận sớm.")
            self._start_vote()
        else:
            raise GameError("Không thể bỏ qua giai đoạn này.")

    def _check_reveal_ready(self):
        needed = [p for p in self.order if self._connected(p)]
        if all(p in self.ready for p in needed):
            self._start_night()

    # ------------------------------------------------------------------ ban đêm
    def _start_night(self):
        self.round += 1
        self.phase = "night"
        self.ready = set()
        self.news = []
        self.night = {
            "wolf_votes": {}, "seer": None, "guard": None, "guard_done": False,
            "victim": None, "heal": False, "poison": None, "witch_done": False,
        }
        self._add_log(f"🌙 Đêm {self.round} buông xuống.", "night")
        self._set_timer(self.config["night_time"], self._end_night_actions)
        self._check_night_done()

    def _check_night_done(self):
        n = self.night
        wolves = [w for w in self._alive_with("werewolf") if self._connected(w)]
        votes = n["wolf_votes"]
        wolves_ok = all(w in votes for w in wolves) and len({votes[w] for w in wolves}) <= 1
        seer_ok = all(n["seer"] is not None or not self._connected(s) for s in self._alive_with("seer"))
        guard_ok = all(n["guard_done"] or not self._connected(g) for g in self._alive_with("bodyguard"))
        if wolves_ok and seer_ok and guard_ok:
            self._shorten(GRACE)

    def _act_wolf_vote(self, pid, data):
        self._require_phase("night")
        self._require_alive(pid, "werewolf")
        target = self._target(data)
        if self._is_wolf(target):
            raise GameError("Không thể cắn đồng bọn.")
        self.night["wolf_votes"][pid] = target
        self._check_night_done()

    def _act_seer(self, pid, data):
        self._require_phase("night")
        self._require_alive(pid, "seer")
        if self.night["seer"] is not None:
            raise GameError("Bạn đã soi trong đêm nay rồi.")
        target = self._target(data)
        if target == pid:
            raise GameError("Hãy soi người khác.")
        self.night["seer"] = target
        self.seer_known[target] = self._is_wolf(target)
        if self._is_wolf(target):
            self._tell(pid, f"🔮 Đêm {self.round}: {self._name(target)} LÀ MA SÓI! 🐺", "seer-wolf")
        else:
            self._tell(pid, f"🔮 Đêm {self.round}: {self._name(target)} không phải Ma Sói.", "seer-good")
        self._check_night_done()

    def _act_guard(self, pid, data):
        self._require_phase("night")
        self._require_alive(pid, "bodyguard")
        if self.night["guard_done"]:
            raise GameError("Bạn đã chọn trong đêm nay rồi.")
        target = self._target(data, allow_none=True)
        if target is not None and target == self.last_guarded:
            raise GameError("Không được bảo vệ cùng một người hai đêm liên tiếp.")
        self.night["guard"] = target
        self.night["guard_done"] = True
        if target:
            self._tell(pid, f"🛡️ Đêm {self.round}: bạn bảo vệ {self._name(target)}.")
        else:
            self._tell(pid, f"🛡️ Đêm {self.round}: bạn không bảo vệ ai.")
        self._check_night_done()

    def _end_night_actions(self):
        votes = [t for w, t in self.night["wolf_votes"].items() if w in self.alive and t in self.alive]
        victim = None
        if votes:
            tally = Counter(votes)
            top = max(tally.values())
            victim = random.choice([t for t, c in tally.items() if c == top])
        self.night["victim"] = victim
        if "witch" in self.roles.values():
            self.phase = "witch"
            witches = self._alive_with("witch")
            if witches and (self.potions["heal"] or self.potions["poison"]):
                self._set_timer(WITCH_TIME, self._resolve_night)
            else:
                # vẫn chờ một chút để không lộ thông tin Phù Thủy đã chết/hết thuốc
                self._set_timer(random.randint(5, 9), self._resolve_night)
        else:
            self._resolve_night()

    def _act_witch(self, pid, data):
        self._require_phase("witch")
        self._require_alive(pid, "witch")
        n = self.night
        if n["witch_done"]:
            raise GameError("Bạn đã quyết định rồi.")
        heal = bool(data.get("heal"))
        poison = self._target(data, allow_none=True) if data.get("target") is not None else None
        if heal and (not self.potions["heal"] or not n["victim"]):
            raise GameError("Không thể dùng thuốc cứu.")
        if poison is not None and (not self.potions["poison"] or poison == pid):
            raise GameError("Không thể dùng thuốc độc lên người này.")
        n["witch_done"] = True
        if heal:
            n["heal"] = True
            self.potions["heal"] = False
            self._tell(pid, f"🧪 Đêm {self.round}: bạn đã cứu {self._name(n['victim'])}.")
        if poison:
            n["poison"] = poison
            self.potions["poison"] = False
            self._tell(pid, f"☠️ Đêm {self.round}: bạn đã đầu độc {self._name(poison)}.")
        if not heal and not poison:
            self._tell(pid, f"🧪 Đêm {self.round}: bạn không dùng thuốc.")
        self._shorten(1.5)

    def _resolve_night(self):
        n = self.night
        deaths = []
        victim = n["victim"]
        if victim and victim in self.alive and victim != n["guard"] and not n["heal"]:
            deaths.append((victim, "wolf"))
        poison = n["poison"]
        if poison and poison in self.alive and all(p != poison for p, _ in deaths):
            deaths.append((poison, "poison"))
        self.last_guarded = n["guard"]
        for pid, cause in deaths:
            self._kill(pid, cause)
        if deaths:
            names = ", ".join(self._death_line(p) for p, _ in deaths)
            self.news = [f"Đêm qua, {names} đã chết."]
            self._add_log(f"☀️ Sáng ngày {self.round}: {names} đã chết trong đêm.", "death")
        else:
            self.news = ["Đêm qua bình yên, không ai chết cả."]
            self._add_log(f"☀️ Sáng ngày {self.round}: không ai chết.", "day")
        self._after_deaths([p for p, _ in deaths], "day")

    # ------------------------------------------------------------------ cái chết & thợ săn
    def _kill(self, pid, cause, by=None):
        if pid in self.alive:
            self.alive.discard(pid)
            self.death_info[pid] = {"cause": cause, "round": self.round, "by": by}
            self.ready.discard(pid)

    def _after_deaths(self, dead, next_phase):
        hunters = [p for p in dead if self.roles.get(p) == "hunter" and self.death_info[p]["cause"] != "poison"]
        if hunters and len(self.alive) > 0:
            self.hunter = hunters[0]
            self.hunter_next = next_phase
            self.phase = "hunter"
            self.news.append(f"🏹 {self._name(self.hunter)} là Thợ Săn — được bắn một phát trước khi gục ngã!")
            self._set_timer(HUNTER_TIME, lambda: self._hunter_shoot(None))
            return
        self._continue(next_phase)

    def _act_shoot(self, pid, data):
        self._require_phase("hunter")
        if pid != self.hunter:
            raise GameError("Bạn không phải Thợ Săn.")
        target = self._target(data, allow_none=True)
        self._hunter_shoot(target)

    def _hunter_shoot(self, target):
        hunter, self.hunter = self.hunter, None
        nxt = self.hunter_next
        if target and target in self.alive:
            self._kill(target, "hunter", by=hunter)
            line = f"💥 Thợ Săn {self._name(hunter)} đã bắn chết {self._death_line(target)}."
            self.news.append(line)
            self._add_log(line, "death")
            self._after_deaths([target], nxt)
        else:
            self.news.append(f"Thợ Săn {self._name(hunter)} đã không bắn ai.")
            self._add_log(f"🏹 Thợ Săn {self._name(hunter)} không bắn ai.")
            self._continue(nxt)

    def _continue(self, next_phase):
        winner = self._check_win()
        if winner:
            self._end_game(winner)
        elif next_phase == "day":
            self._start_day()
        else:
            self._start_night()

    def _check_win(self):
        wolves = len(self._alive_with("werewolf"))
        others = len(self.alive) - wolves
        if wolves == 0:
            return "village"
        if wolves >= others:
            return "wolf"
        return None

    def _end_game(self, winner):
        self._stop_timer()
        self.phase = "end"
        self.winner = winner
        if winner == "village":
            text = "🎉 Phe Dân Làng chiến thắng! Toàn bộ Ma Sói đã bị tiêu diệt."
        else:
            text = "🐺 Phe Ma Sói chiến thắng! Bầy Sói đã chiếm lấy ngôi làng."
        self.news.append(text)
        self._add_log(text, "end")
        self._post_chat("system", text)

    # ------------------------------------------------------------------ ban ngày
    def _start_day(self):
        self.phase = "day"
        self.ready = set()
        self._accuse = Counter()
        self._bot_talked = set()
        self._set_timer(self.config["discussion_time"], self._start_vote)

    def _check_day_ready(self):
        voters = [p for p in self.order if p in self.alive and self._connected(p)]
        if voters and all(p in self.ready for p in voters):
            self._start_vote()

    def _start_vote(self):
        self.phase = "vote"
        self.votes = {}
        self.ready = set()
        self._set_timer(self.config["vote_time"], self._end_vote)

    def _check_vote_done(self):
        voters = [p for p in self.order if p in self.alive and self._connected(p)]
        if all(p in self.votes for p in voters):
            self._shorten(GRACE)

    def _act_vote(self, pid, data):
        self._require_phase("vote")
        self._require_alive(pid)
        if data.get("target") == "skip":
            self.votes[pid] = "skip"
        else:
            target = self._target(data)
            if target == pid:
                raise GameError("Không thể tự bỏ phiếu cho mình.")
            self.votes[pid] = target
        self._check_vote_done()

    def _end_vote(self):
        tally = Counter(v for p, v in self.votes.items() if p in self.alive and (v == "skip" or v in self.alive))
        skip = tally.pop("skip", 0)
        executed = None
        if tally:
            top = max(tally.values())
            leaders = [t for t, c in tally.items() if c == top]
            if len(leaders) == 1 and top > skip:
                executed = leaders[0]
        parts = [f"{self._name(t)}: {c}" for t, c in tally.most_common()]
        if skip:
            parts.append(f"Bỏ qua: {skip}")
        summary = "Kết quả phiếu — " + (", ".join(parts) if parts else "không ai bỏ phiếu")
        if executed:
            self._kill(executed, "vote")
            self.news = [f"⚖️ Dân làng đã treo cổ {self._death_line(executed)}.", summary]
            self._add_log(f"⚖️ Ngày {self.round}: {self._death_line(executed)} bị treo cổ. ({summary})", "death")
        else:
            self.news = ["⚖️ Không ai bị treo cổ (hoà phiếu hoặc đa số bỏ qua).", summary]
            self._add_log(f"⚖️ Ngày {self.round}: không ai bị treo cổ. ({summary})", "day")
        self.phase = "verdict"
        dead = [executed] if executed else []
        self._set_timer(VERDICT_TIME, lambda: self._after_deaths(dead, "night"))

    # ------------------------------------------------------------------ khác
    def _act_play_again(self, pid, data):
        self._require_host(pid)
        self._require_phase("end")
        self._reset()
        self.chat = [m for m in self.chat if m["channel"] in ("all", "system")][-50:]
        self._post_chat("system", "🔁 Quay lại phòng chờ. Chủ phòng có thể bắt đầu ván mới.")
        self._auto_roles()

    def _chat_channel(self, pid):
        if self.phase in ("lobby", "end"):
            return "all"
        if pid not in self.roles:
            return "spec"  # người vào xem giữa ván: kênh riêng, người còn sống không thấy
        if pid not in self.alive:
            return "dead"
        if self.phase in ("night", "witch"):
            return "wolf" if self._is_wolf(pid) else None
        return "all"

    def _ghost_sees_roles(self):
        """Người đã chết có được xem vai của mọi người không — theo tuỳ chọn “Lộ vai trò khi chết”.
        Tắt tuỳ chọn thì hồn ma cũng chỉ biết những gì người sống biết (không xem vai, không nghe lén Sói)."""
        return self.config["reveal_on_death"]

    def _can_see(self, pid, channel):
        if channel in ("all", "system") or self.phase == "end":
            return True
        dead = pid in self.roles and pid not in self.alive
        if channel == "wolf":
            return self._is_wolf(pid) or (dead and self._ghost_sees_roles())
        if channel == "dead":
            return dead
        if channel == "spec":
            return pid not in self.roles or dead  # người xem không biết vai nên người chết đọc được cũng vô hại
        return False

    def can_voice(self, speaker, listener):
        if self.phase in ("lobby", "end"):
            return True
        if speaker not in self.roles:  # người xem chỉ nói với người xem / người đã chết
            return listener not in self.alive
        if listener not in self.roles:  # người xem chỉ nghe tiếng nói công khai ban ngày của người còn sống
            return speaker in self.alive and self.phase not in ("night", "witch")
        listener_alive = listener in self.alive
        if speaker not in self.alive:
            return not listener_alive  # hồn ma chỉ nói với hồn ma
        if self.phase in ("night", "witch"):
            if self._is_wolf(speaker):  # bầy Sói bàn bạc; hồn ma nghe lén được (nếu được xem vai)
                return self._is_wolf(listener) or (not listener_alive and self._ghost_sees_roles())
            return False  # dân làng đang ngủ
        return True

    def allow_fx(self, pid, target):
        if self.phase in ("night", "witch") and pid in self.alive:
            return False, "Ban đêm phải ngủ — không thể tương tác 🤫"
        return True, ""

    def _act_chat(self, pid, data):
        text = " ".join(str(data.get("text", "")).split())[:300]
        if not text:
            return
        channel = self._chat_channel(pid)
        if channel is None:
            raise GameError("Ban đêm dân làng phải ngủ — không thể trò chuyện 🤫")
        self._post_chat(channel, text, pid)

    # ------------------------------------------------------------------ trạng thái
    def _composition(self):
        if self.phase == "lobby":
            roles = dict(self.config["roles"])
            roles["villager"] = max(0, len(self.room.players) - sum(roles.values()))
        else:
            roles = dict(Counter(self.roles.values()))
        return {r: roles.get(r, 0) for r in ROLE_ORDER if roles.get(r, 0)}

    def _action_for(self, pid):
        ph = self.phase
        role = self.roles.get(pid)
        if ph == "reveal":
            return {"kind": "reveal", "done": pid in self.ready}
        if ph == "hunter" and pid == self.hunter:
            return {"kind": "hunter", "targets": [p for p in self.order if p in self.alive]}
        if ph in ("lobby", "end"):
            return None
        if pid not in self.alive:
            return {"kind": "spectate"}
        others = [p for p in self.order if p in self.alive and p != pid]
        n = self.night
        if ph == "night":
            if role == "werewolf":
                return {"kind": "wolf_vote", "targets": [p for p in others if not self._is_wolf(p)],
                        "selected": n["wolf_votes"].get(pid)}
            if role == "seer":
                if n["seer"] is None:
                    return {"kind": "seer", "targets": others}
                return {"kind": "sleep", "text": f"Bạn đã soi {self._name(n['seer'])}. Hãy chờ trời sáng."}
            if role == "bodyguard":
                if not n["guard_done"]:
                    return {"kind": "guard", "lastGuarded": self.last_guarded,
                            "targets": [p for p in self.order if p in self.alive and p != self.last_guarded]}
                who = self._name(n["guard"]) if n["guard"] else "không ai"
                return {"kind": "sleep", "text": f"Bạn đang canh giữ cho {who}."}
            return {"kind": "sleep"}
        if ph == "witch":
            if role == "witch" and not n["witch_done"] and (self.potions["heal"] or self.potions["poison"]):
                return {"kind": "witch", "victim": n["victim"],
                        "canHeal": self.potions["heal"] and n["victim"] is not None,
                        "canPoison": self.potions["poison"], "targets": others}
            return {"kind": "sleep"}
        if ph == "day":
            return {"kind": "discuss", "ready": pid in self.ready}
        if ph == "vote":
            return {"kind": "vote", "targets": others, "selected": self.votes.get(pid)}
        if ph == "hunter":
            return {"kind": "wait_hunter"}
        return None

    def _public_death(self, pid):
        info = self.death_info.get(pid)
        if not info:
            return None
        cause = info["cause"] if info["cause"] in ("vote", "hunter") else "night"
        return {"cause": cause, "round": info["round"], "by": info.get("by")}

    def view(self, pid):
        my_role = self.roles.get(pid)
        in_game = self._in_game() and pid in self.roles
        me_dead = in_game and pid not in self.alive
        see_all = self.phase == "end" or (me_dead and self._ghost_sees_roles())
        players = []
        for p in self.room.players.values():
            role = None
            playing = p.id in self.roles
            if playing and self._in_game():
                r = self.roles[p.id]
                dead = p.id not in self.alive
                if (p.id == pid or see_all or (my_role == "werewolf" and r == "werewolf")
                        or (dead and self.config["reveal_on_death"])):
                    role = r
            players.append({
                "id": p.id,
                "name": p.name,
                "connected": p.connected,
                "bot": p.is_bot,
                "look": p.look,
                "death": self._public_death(p.id),
                "host": p.id == self.room.host_id,
                "playing": playing or not self._in_game(),
                "alive": (p.id in self.alive) if self._in_game() else True,
                "role": role,
                "ready": p.id in self.ready,
            })
        if self._in_game():
            order = {pid_: i for i, pid_ in enumerate(self.order)}
            players.sort(key=lambda x: order.get(x["id"], 999))

        wolf_votes = None
        if self.phase in ("night", "witch") and (my_role == "werewolf" or see_all):
            wolf_votes = {k: v for k, v in self.night.get("wolf_votes", {}).items() if k in self.alive}
        votes = None
        if self.phase in ("vote", "verdict"):
            votes = {k: v for k, v in self.votes.items() if k in self.alive or self.death_info.get(k, {}).get("cause") == "vote"}
        victim = None
        if self.phase == "witch" and (my_role == "witch" or me_dead):
            victim = self.night.get("victim")

        ready_needed = 0
        if self.phase == "reveal":
            ready_needed = sum(1 for p in self.order if self._connected(p))
        elif self.phase == "day":
            ready_needed = sum(1 for p in self.order if p in self.alive and self._connected(p))

        return {
            "phase": self.phase,
            "round": self.round,
            "deadline": self.deadline,
            "total": self.phase_total,
            "now": time.time(),
            "me": {
                "id": pid,
                "host": pid == self.room.host_id,
                "role": my_role if self._in_game() else None,
                "alive": pid in self.alive if in_game else True,
                "playing": in_game,
                "potions": self.potions if my_role == "witch" else None,
            },
            "players": players,
            "config": self.config,
            "minPlayers": self.min_players,
            "maxPlayers": self.max_players,
            "composition": self._composition(),
            "news": self.news,
            "action": self._action_for(pid) if in_game else ({"kind": "watch"} if self._in_game() and self.phase != "end" else None),
            "votes": votes,
            "wolfVotes": wolf_votes,
            "victim": victim,
            "hunter": self.hunter,
            "readyCount": len(self.ready),
            "readyNeeded": ready_needed,
            "chat": [m for m in self.chat if self._can_see(pid, m["channel"])][-150:],
            "chatChannel": self._chat_channel(pid),
            "log": self.log[-100:],
            "private": self.private.get(pid, []),
            "winner": self.winner,
            "known": ({k: ("wolf" if v else "good") for k, v in self.seer_known.items()}
                      if my_role == "seer" or see_all else None),
            "nightMarks": {
                "seer": self.night.get("seer") if my_role == "seer" else None,
                "guard": self.night.get("guard") if my_role == "bodyguard" else None,
            } if self.phase in ("night", "witch") else None,
            "roleInfo": ROLES,
            "roleOrder": ROLE_ORDER,
            "startError": self._validate_roles(len(self.room.players)) if self.phase == "lobby" else None,
        }
