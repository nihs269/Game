"""Chiến Binh Tí Hon — bắn súng nhìn ngang, nhiều người đánh nhau thời gian thực, nhặt súng trên bản đồ.

Chế độ:
  • Đấu Đơn  — ai cũng là địch, hạ đủ số mạng (hoặc nhiều nhất khi hết giờ) thì thắng.
  • Đấu Đội  — hai đội Đỏ / Xanh, đội nào hạ đủ số mạng trước thắng.
  • Cướp Cờ — mang cờ của đội địch về căn cứ nhà (khi cờ nhà đang ở chỗ) để ghi điểm.

Cách đồng bộ (giống Đá Bóng):
  • Trình duyệt tự mô phỏng nhân vật của mình (chạy, nhảy, rơi qua bục — không trễ), ~30 lần/giây gửi vị trí lên.
  • Bắn: trình duyệt báo hướng ngắm; máy chủ tạo viên đạn, mô phỏng đạn / lựu đạn / vụ nổ 60 lần/giây,
    tính trúng đạn, máu, giáp, nhặt đồ, cờ. Máy chủ phát toàn cảnh 30 lần/giây.
  • Bot do máy chủ điều khiển, dùng đúng vật lý của người chơi.
"""
import asyncio
import itertools
import logging
import math
import random
import time

from core.game_base import BaseGame, GameError
from .bots import BotBrain
from .world import (DROP_LIFE, GRENADE, ITEM_RESPAWN, ITEMS, MAPS, MAX_ARMOR, MAX_HP, PHYS, PICK_R, RESPAWN,
                    SPAWN_SAFE, WEAPONS, dist, seg_hits_box, step_body)

log = logging.getLogger("gamehub.chienbinh")

TICK = 1 / 60
SEND_EVERY = 2                      # phát toàn cảnh mỗi 2 nhịp (30 lần/giây)
INTRO = 3.0
OVER = 4.0
MODES = ("ffa", "team", "ctf")
MODE_NAMES = {"ffa": "Đấu Đơn", "team": "Đấu Đội", "ctf": "Cướp Cờ"}
LIMITS = {"ffa": (10, 15, 25), "team": (20, 30, 50), "ctf": (3, 5, 7)}
TIMES = (120, 180, 300, 420)
BOT_LEVELS = ("easy", "normal", "hard")
TEAM_COLORS = ["#ff5a5f", "#4d8df7"]
TEAM_NAMES = ["Đỏ", "Xanh"]
FFA_COLORS = ["#ff5a5f", "#4d8df7", "#3cc47c", "#ffc23c", "#b07cff", "#ff8fc7", "#2fd0d0", "#ff9f43", "#9be15d", "#e0e0e0"]
STATES = {"idle", "run", "jump", "fall"}
FLAG_RETURN = 15.0
FLAG_R = 42
SHOULDER = 37                       # tâm xoay của súng: cao hơn bàn chân chừng này
FIRE_SLACK = 0.75                   # nhận phát bắn sớm hơn thời gian nạp một chút (bù dao động mạng)


def _num(v, default=0.0):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return default
    return default if v != v or v in (math.inf, -math.inf) else v


class ChienBinhGame(BaseGame):
    id = "chienbinh"
    name = "Chiến Binh Tí Hon"
    icon = "🔫"
    description = "Bắn súng nhìn ngang, đánh nhau thời gian thực: nhặt súng trên bản đồ, ném lựu đạn. Đấu Đơn · Đấu Đội · Cướp Cờ!"
    min_players = 2
    max_players = 10
    supports_bots = True
    guide = [
        ("🎯 Chế độ", [
            "**Đấu Đơn** — ai cũng là địch. Hạ đủ số mạng trước (hoặc nhiều nhất khi hết giờ) thì thắng.",
            "**Đấu Đội** — hai đội 🔴 Đỏ và 🔵 Xanh. Đội nào hạ đủ số mạng trước thì thắng.",
            "**Cướp Cờ** — chạm vào cờ đội địch để cướp, mang về căn cứ nhà **khi cờ nhà vẫn còn ở chỗ** để ghi điểm. "
            "Người cầm cờ bị hạ thì cờ rơi xuống: đội nhà chạm vào là cờ về căn cứ, để yên 15 giây cờ cũng tự về.",
        ]),
        ("🕹️ Điều khiển (máy tính)", [
            "**Chạy**: A / D · **Nhảy**: W hoặc Space · **Rơi xuống khỏi bục**: S",
            "**Ngắm**: di chuột · **Bắn**: giữ chuột trái",
            "**Lựu đạn**: G hoặc chuột phải · **Đổi súng nằm dưới chân**: E",
        ]),
        ("📱 Điện thoại", "Nút trên màn hình để chạy, nhảy, rơi, ném lựu đạn, đổi súng. **Chạm và giữ** vào bản đồ để ngắm và bắn về chỗ đó (nên xoay ngang)."),
        ("🎁 Nhặt đồ", [
            "Súng nằm rải trên bản đồ: 💨 Tiểu liên · 💥 Shotgun · 🎯 Bắn tỉa · 🚀 Rocket · ⚡ Laser (xuyên người). Mỗi súng có số đạn, hết đạn thì về súng lục.",
            "Đang cầm súng lục thì chạm vào súng là nhặt luôn; đang cầm súng khác thì bấm **E** để đổi.",
            "❤️ Hộp cứu thương +50 máu · 🛡️ Áo giáp đỡ bớt sát thương · 💣 thêm 2 lựu đạn.",
            "Bị hạ thì **rơi súng** đang cầm ra — ai nhanh chân thì nhặt!",
        ]),
        ("💀 Hồi sinh", "Bị hạ thì 3 giây sau hồi sinh ở căn cứ, được bất tử 1,6 giây. Rocket và lựu đạn nổ trúng mình cũng mất máu (một nửa)."),
        ("⚙️ Tuỳ chọn (chủ phòng)", "Chế độ, bản đồ, thời gian, điểm để thắng, độ khó bot. Người chơi tự chọn đội trong phòng chờ."),
    ]

    def __init__(self, room):
        super().__init__(room)
        self.config = {"mode": "team", "map": "congtruong", "time": 300, "limit": 30, "bot_level": "normal"}
        self.chat = []
        self.log = []
        self.events = []
        self._dirty = False
        self._msg_id = 0
        self._seq = 0
        self._token = 0
        self._disposed = False
        self._ids = itertools.count(1)
        self.names = {}
        self.team_pref = {}
        self.wins = {}
        self.game_no = 0
        self._reset_game()
        self.phase = "lobby"

    def _reset_game(self):
        self._token += 1
        self.order = []
        self.f = {}               # pid → trạng thái chiến binh
        self.brains = {}
        self.colors = {}
        self.team = {}
        self.stats = {}           # pid → {k, d, caps, best}
        self.score = [0, 0]
        self.bullets = []
        self.grenades = []
        self.items = []
        self.spot_next = []
        self.flags = []
        self.fx = []
        self.stage = None         # intro · fight · over
        self.stage_until = 0.0
        self.time_left = 0.0
        self.map = MAPS[self.config["map"]]
        self.winner = None        # pid (Đấu Đơn) hoặc 0/1 (đội) hoặc None (hoà)
        self.ranking = []
        self.end_reason = None

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

    @property
    def teams(self):
        return self.config["mode"] in ("team", "ctf")

    def _enemy(self, a, b):
        if a == b:
            return False
        return not self.teams or self.team.get(a) != self.team.get(b)

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
        return {"label": f"Đang bắn — {MODE_NAMES[self.config['mode']]}", "joinable": False}

    async def on_player_join(self, player):
        self._post_chat("system", f"👋 {player.name} đã vào phòng.")

    async def on_player_removed(self, player):
        self.names[player.id] = player.name
        self.team_pref.pop(player.id, None)
        self._post_chat("system", f"🚪 {player.name} đã rời phòng.")

    async def on_action(self, player, action, data):
        handler = getattr(self, "_act_" + action, None) if action.isidentifier() else None
        if handler is None:
            raise GameError("Hành động không hợp lệ.")
        result = handler(player.id, data if isinstance(data, dict) else {})
        if self._dirty and self.phase == "play":
            # Vòng lặp sẽ gửi trạng thái ở nhịp kế tiếp.
            return False
        return result

    # ------------------------------------------------------------------ phòng chờ
    def _act_config(self, pid, data):
        self._require_host(pid)
        if self.phase == "play":
            raise GameError("Không thể đổi luật khi đang chơi.")
        if data.get("mode") in MODES and data["mode"] != self.config["mode"]:
            self.config["mode"] = data["mode"]
            self.config["limit"] = LIMITS[data["mode"]][1]
        if data.get("map") in MAPS:
            self.config["map"] = data["map"]
        if data.get("bot_level") in BOT_LEVELS:
            self.config["bot_level"] = data["bot_level"]
        try:
            if "time" in data and int(data["time"]) in TIMES:
                self.config["time"] = int(data["time"])
            if "limit" in data and int(data["limit"]) in LIMITS[self.config["mode"]]:
                self.config["limit"] = int(data["limit"])
        except (TypeError, ValueError):
            pass

    def _act_team(self, pid, data):
        if self.phase == "play":
            raise GameError("Đang trong ván — ván sau hãy đổi đội.")
        t = data.get("team")
        target = data.get("pid") or pid
        if target != pid:
            # Chủ phòng được xếp đội cho bot.
            p = self.room.players.get(target)
            if pid != self.room.host_id or not p or not p.is_bot:
                raise GameError("Bạn chỉ đổi đội được cho mình.")
        if t in (0, 1):
            self.team_pref[target] = t
        else:
            self.team_pref.pop(target, None)

    def _lobby_teams(self):
        """Đội dự kiến của mọi người trong phòng (theo lựa chọn, ai chưa chọn thì xếp cho cân)."""
        pids = list(self.room.players.keys())[:self.max_players]
        out = {}
        counts = [0, 0]
        for p in pids:
            t = self.team_pref.get(p)
            if t in (0, 1):
                out[p] = t
                counts[t] += 1
        for p in pids:
            if p not in out:
                t = 0 if counts[0] <= counts[1] else 1
                out[p] = t
                counts[t] += 1
        return out

    def _start_error(self):
        if len(self.room.players) < 2:
            return "Cần ít nhất 2 người — thêm bot nhé!"
        if self.teams:
            counts = [0, 0]
            for t in self._lobby_teams().values():
                counts[t] += 1
            if not all(counts):
                return "Mỗi đội cần ít nhất 1 người."
        return None

    def _act_start(self, pid, data):
        self._require_host(pid)
        if self.phase == "play":
            raise GameError("Ván đang diễn ra.")
        err = self._start_error()
        if err:
            raise GameError(err)
        teams = self._lobby_teams()
        self._reset_game()
        self.game_no += 1
        self.phase = "play"
        self.order = self.participants()
        mp = self.map
        for i, p in enumerate(self.order):
            self.names[p] = self._name(p)
            self.team[p] = teams.get(p, i % 2) if self.teams else -1
            self.colors[p] = TEAM_COLORS[self.team[p]] if self.teams else FFA_COLORS[i % len(FFA_COLORS)]
            self.stats[p] = {"k": 0, "d": 0, "caps": 0, "best": 0, "streak": 0}
            self.wins.setdefault(p, 0)
            self.f[p] = {"x": 0.0, "y": 0.0, "vx": 0.0, "vy": 0.0, "kx": 0.0, "ground": True, "drop_until": 0.0,
                         "aim": 0.0, "s": "idle", "hp": MAX_HP, "armor": 0, "wpn": "pistol", "ammo": 0, "gren": 1,
                         "alive": True, "respawn_at": 0.0, "life": 0, "inv_until": 0.0, "last_fire": 0.0, "t": 0.0,
                         "flag": None}
            player = self.room.players.get(p)
            if player and player.is_bot:
                self.brains[p] = BotBrain(self.config["bot_level"])
        for p in self.order:
            self._spawn(p, first=True)
        self.items = []
        self.spot_next = [0.0] * len(mp["items"])
        for i in range(len(mp["items"])):
            self._spawn_item(i)
        if self.config["mode"] == "ctf":
            self.flags = [{"state": "home", "x": b[0], "y": b[1], "by": None, "at": 0.0} for b in mp["bases"]]
        self.time_left = float(self.config["time"])
        self.stage = "intro"
        self.stage_until = time.time() + INTRO
        mode = MODE_NAMES[self.config["mode"]]
        self._post_chat("system", f"🔫 Ván {self.game_no}: {mode} — bản đồ {mp['name']}!")
        self._add_log(f"🔫 Ván {self.game_no}: {mode} · {mp['name']} · {self._limit_text()}", "start")
        self._event("intro")
        self._token += 1
        asyncio.ensure_future(self._tick_loop(self._token))

    def _limit_text(self):
        lim = self.config["limit"]
        return f"{lim} lần cướp cờ" if self.config["mode"] == "ctf" else f"{lim} mạng"

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
        self._finish("stop")

    # ------------------------------------------------------------------ hồi sinh & vật phẩm
    def _spawn(self, pid, first=False):
        mp = self.map
        f = self.f[pid]
        t = self.team[pid]
        if self.teams:
            spots = [s for s in mp["spawns"] if s[2] == t]
        else:
            spots = list(mp["spawns"])
        # Chọn chỗ xa kẻ địch nhất (thêm chút ngẫu nhiên).
        enemies = [(o["x"], o["y"]) for q, o in self.f.items() if q != pid and o["alive"] and self._enemy(pid, q)]

        def score(s):
            d = min((dist(s[0], s[1], ex, ey) for ex, ey in enemies), default=2000)
            return d + random.uniform(0, 250)
        if first and self.teams:
            idx = [q for q in self.order if self.team[q] == t].index(pid)
            s = spots[idx % len(spots)]
        elif first:
            s = spots[self.order.index(pid) % len(spots)]
        else:
            s = max(spots, key=score)
        now = time.time()
        f.update(x=float(s[0]), y=float(s[1]), vx=0.0, vy=0.0, kx=0.0, ground=True, drop_until=0.0, s="idle",
                 hp=MAX_HP, armor=0, wpn="pistol", ammo=0, gren=1, alive=True, inv_until=now + (0 if first else SPAWN_SAFE),
                 t=now, flag=None, aim=0.0 if s[0] < mp["w"] / 2 else math.pi)
        f["life"] += 1
        if pid in self.brains:
            self.brains[pid].reset()

    def _spawn_item(self, spot):
        x, y = self.map["items"][spot]
        kinds = list(ITEMS)
        kind = random.choices(kinds, weights=[ITEMS[k]["w"] for k in kinds])[0]
        self.items.append({"id": next(self._ids), "x": float(x), "y": float(y), "kind": kind, "spot": spot,
                           "ammo": WEAPONS[kind]["ammo"] if kind in WEAPONS else None, "until": None})

    def _drop_weapon(self, f):
        if f["wpn"] != "pistol" and f["ammo"] > 0:
            self.items.append({"id": next(self._ids), "x": f["x"], "y": f["y"], "kind": f["wpn"], "spot": None,
                               "ammo": f["ammo"], "until": time.time() + DROP_LIFE})

    def _take_item(self, pid, it, swap=False):
        """Thử nhặt vật phẩm. Trả về True nếu đã nhặt."""
        f = self.f[pid]
        k = it["kind"]
        if k == "medkit":
            if f["hp"] >= MAX_HP:
                return False
            f["hp"] = min(MAX_HP, f["hp"] + 50)
        elif k == "armor":
            if f["armor"] >= MAX_ARMOR:
                return False
            f["armor"] = MAX_ARMOR
        elif k == "grenade":
            if f["gren"] >= GRENADE["max"]:
                return False
            f["gren"] = min(GRENADE["max"], f["gren"] + 2)
        else:
            if f["wpn"] == k:
                f["ammo"] = min(WEAPONS[k]["ammo"] * 2, f["ammo"] + (it["ammo"] or 0))
            elif f["wpn"] == "pistol" or swap:
                if swap:
                    self._drop_weapon(f)
                f["wpn"], f["ammo"] = k, it["ammo"] or WEAPONS[k]["ammo"]
            else:
                return False
        self.items.remove(it)
        if it["spot"] is not None:
            self.spot_next[it["spot"]] = time.time() + ITEM_RESPAWN
        self.fx.append(["pick", pid, k])
        return True

    # ------------------------------------------------------------------ vòng lặp
    async def _tick_loop(self, token):
        nxt = time.perf_counter()
        n = 0
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
                    log.exception("Lỗi vòng lặp Chiến Binh")
                n += 1
                if self.phase == "play" and (n % SEND_EVERY == 0 or self.fx):
                    await self.room.broadcast(self._world_msg())
                    self.fx = []
                if self._dirty:
                    self._dirty = False
                    await self.room.broadcast_state()

    def _tick(self):
        now = time.time()
        if self.stage == "intro":
            if now >= self.stage_until:
                self.stage = "fight"
                self._event("fight")
            return
        if self.stage == "over":
            self._step_projectiles(now)
            if now >= self.stage_until:
                self._end_game()
            return
        self.time_left -= TICK
        self._step_bots(now)
        for pid, f in self.f.items():
            if not f["alive"] and now >= f["respawn_at"]:
                self._spawn(pid)
                self.fx.append(["spawn", pid])
        self._step_projectiles(now)
        self._step_items(now)
        if self.flags:
            self._step_flags(now)
        self._check_win()

    # ------------------------------------------------------------------ bot
    def _step_bots(self, now):
        for pid, brain in self.brains.items():
            f = self.f[pid]
            if not f["alive"]:
                continue
            move, jump, drop, aim, fire, nade, swap = brain.think(self, pid, now)
            step_body(f, move, jump, drop, TICK, self.map, now)
            f["aim"] = aim
            f["s"] = "jump" if f["vy"] < 0 else "fall" if not f["ground"] else "run" if move else "idle"
            f["t"] = now
            if fire:
                self._fire(pid, aim, now)
            if nade:
                self._throw(pid, aim, now)
            if swap:
                self._act_swap(pid, {})

    # ------------------------------------------------------------------ bắn
    def _muzzle(self, f, aim):
        return f["x"] + math.cos(aim) * 36, f["y"] - SHOULDER + math.sin(aim) * 36

    def _fire(self, pid, aim, now):
        f = self.f[pid]
        if not f["alive"] or self.stage != "fight":
            return False
        w = WEAPONS[f["wpn"]]
        if now - f["last_fire"] < w["cd"] * (FIRE_SLACK if pid not in self.brains else 1):
            return False
        f["last_fire"] = now
        f["inv_until"] = 0.0        # bắn là hết bất tử
        mx, my = self._muzzle(f, aim)
        for i in range(w["pellets"]):
            if w["pellets"] > 1:
                a = aim + (i / (w["pellets"] - 1) - 0.5) * w["spread"] + random.uniform(-0.03, 0.03)
            else:
                a = aim + random.uniform(-w["spread"], w["spread"])
            self.bullets.append({"id": next(self._ids), "x": mx, "y": my, "vx": math.cos(a) * w["speed"],
                                 "vy": math.sin(a) * w["speed"], "kind": f["wpn"], "owner": pid, "born": now,
                                 "life": w["life"], "hit": set()})
        self.fx.append(["shot", pid, f["wpn"]])
        if w["ammo"] is not None:
            f["ammo"] -= 1
            if f["ammo"] <= 0:
                f["wpn"], f["ammo"] = "pistol", 0
                self.fx.append(["empty", pid])
        return True

    def _throw(self, pid, aim, now):
        f = self.f[pid]
        if not f["alive"] or self.stage != "fight" or f["gren"] <= 0 or now - f.get("last_nade", 0) < 0.6:
            return False
        f["last_nade"] = now
        f["gren"] -= 1
        f["inv_until"] = 0.0
        mx, my = self._muzzle(f, aim)
        sp = GRENADE["speed"]
        self.grenades.append({"id": next(self._ids), "x": mx, "y": my, "vx": math.cos(aim) * sp + f["vx"] * 0.4,
                              "vy": math.sin(aim) * sp - 120, "owner": pid, "boom": now + GRENADE["fuse"]})
        self.fx.append(["toss", pid])
        return True

    def _hitbox(self, f):
        hw = PHYS["HW"]
        return f["x"] - hw, f["y"] - PHYS["HH"], f["x"] + hw, f["y"]

    def _step_projectiles(self, now):
        mp = self.map
        dt = TICK
        keep = []
        for b in self.bullets:
            x0, y0 = b["x"], b["y"]
            x1, y1 = x0 + b["vx"] * dt, y0 + b["vy"] * dt
            dead = now - b["born"] > b["life"] or not (-50 < x1 < mp["w"] + 50) or y1 < -400
            # Trúng người: lấy người bị chạm sớm nhất trên đoạn bay.
            hits = []
            for pid, f in self.f.items():
                if not f["alive"] or pid in b["hit"] or not self._enemy(b["owner"], pid):
                    continue
                t = seg_hits_box(x0, y0, x1, y1, *self._hitbox(f))
                if t is not None:
                    hits.append((t, pid))
            hits.sort()
            w = WEAPONS[b["kind"]]
            if b["kind"] == "rocket":
                t_hit = None
                if hits:
                    t_hit = hits[0][0]
                elif y1 >= mp["ground"]:
                    t_hit = (mp["ground"] - y0) / (y1 - y0) if y1 != y0 else 0
                else:
                    for px, py, pw in mp["plats"]:
                        if (y0 - py) * (y1 - py) <= 0 and y0 != y1:
                            t = (py - y0) / (y1 - y0)
                            xx = x0 + (x1 - x0) * t
                            if px <= xx <= px + pw and (t_hit is None or t < t_hit):
                                t_hit = t
                if t_hit is not None or dead:
                    t = t_hit if t_hit is not None else 1.0
                    self._explode(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w["splash"], w["dmg"], b["owner"], "rocket")
                    continue
            else:
                stop = False
                for t, pid in hits:
                    if not self.f[pid]["alive"]:
                        continue
                    self._damage(pid, w["dmg"], b["owner"], b["kind"], b["vx"], b["vy"], x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
                    b["hit"].add(pid)
                    if not w.get("pierce"):
                        stop = True
                        break
                if stop or dead or y1 >= mp["ground"]:
                    if not stop and y1 >= mp["ground"]:
                        self.fx.append(["dust", round(x1), mp["ground"]])
                    continue
            b["x"], b["y"] = x1, y1
            keep.append(b)
        self.bullets = keep
        # Lựu đạn: bay vồng, nảy trên đất và bục, hết giờ thì nổ.
        keep = []
        for g in self.grenades:
            if now >= g["boom"]:
                self._explode(g["x"], g["y"] - 6, GRENADE["splash"], GRENADE["dmg"], g["owner"], "grenade")
                continue
            g["vy"] += GRENADE["g"] * dt
            nx = g["x"] + g["vx"] * dt
            ny = g["y"] + g["vy"] * dt
            if nx < 8 or nx > mp["w"] - 8:
                g["vx"] = -g["vx"] * 0.6
                nx = max(8, min(mp["w"] - 8, nx))
            if g["vy"] > 0:
                top = mp["ground"] if ny >= mp["ground"] else None
                for px, py, pw in mp["plats"]:
                    if g["y"] <= py <= ny and px <= nx <= px + pw and (top is None or py < top):
                        top = py
                if top is not None:
                    ny = top
                    g["vy"] = -g["vy"] * GRENADE["bounce"] if g["vy"] > 160 else 0.0
                    g["vx"] *= 0.7
            g["x"], g["y"] = nx, ny
            keep.append(g)
        self.grenades = keep

    def _explode(self, x, y, radius, dmg, owner, kind):
        self.fx.append(["ex", round(x), round(y), radius])
        for pid, f in list(self.f.items()):
            if not f["alive"]:
                continue
            if pid != owner and not self._enemy(owner, pid):
                continue
            cx, cy = f["x"], f["y"] - PHYS["HH"] / 2
            d = dist(x, y, cx, cy)
            if d > radius + 20:
                continue
            k = max(0.3, 1 - max(0.0, d - 20) / radius)
            amount = dmg * k * (0.5 if pid == owner else 1)
            ang = math.atan2(cy - y, cx - x)
            self._damage(pid, amount, owner, kind, math.cos(ang) * 900 * k, (math.sin(ang) - 0.6) * 900 * k, cx, cy, splash=True)

    def _damage(self, pid, amount, owner, kind, kvx, kvy, hx, hy, splash=False):
        f = self.f[pid]
        now = time.time()
        if not f["alive"] or now < f["inv_until"] or self.stage != "fight":
            return
        amount = int(round(amount))
        if f["armor"] > 0:
            soak = min(f["armor"], int(amount * 2 / 3))
            f["armor"] -= soak
            amount -= soak
        f["hp"] -= amount
        # Bị đẩy lùi: bot áp dụng ngay; người thật nhận qua gói tin "hit" rồi trình duyệt tự cộng vào.
        norm = math.hypot(kvx, kvy) or 1
        push = 900 if splash else {"sniper": 260, "shotgun": 120, "laser": 90}.get(kind, 60)
        kx = kvx / norm * push if not splash else kvx
        ky = (kvy / norm * push * 0.4 - 80) if not splash else kvy
        if pid in self.brains:
            f["kx"] += kx
            f["vy"] = min(f["vy"], 0) + ky
            f["ground"] = False if ky < -100 else f["ground"]
        self.fx.append(["hit", pid, amount, round(hx), round(hy), round(kx), round(ky)])
        if f["hp"] <= 0:
            self._kill(pid, owner, kind)

    def _kill(self, pid, owner, kind):
        f = self.f[pid]
        now = time.time()
        f["alive"] = False
        f["hp"] = 0
        f["respawn_at"] = now + RESPAWN
        self._drop_weapon(f)
        self._drop_flag(pid)
        st = self.stats[pid]
        st["d"] += 1
        st["streak"] = 0
        streak = 0
        if owner != pid and owner in self.stats:
            ks = self.stats[owner]
            ks["k"] += 1
            ks["streak"] += 1
            ks["best"] = max(ks["best"], ks["streak"])
            streak = ks["streak"]
            if self.config["mode"] == "team":
                self.score[self.team[owner]] += 1
        self.bullets = [b for b in self.bullets if b["owner"] != pid or b["kind"] == "rocket"]
        self.fx.append(["die", pid])
        self._event("kill", owner, v=pid, w=kind, streak=streak)
        if streak in (3, 5, 8):
            self._add_log(f"🔥 {self._name(owner)} hạ liên tiếp {streak} người!", "streak")

    # ------------------------------------------------------------------ nhặt đồ
    def _step_items(self, now):
        for i, t in enumerate(self.spot_next):
            if t and now >= t and not any(it["spot"] == i for it in self.items):
                self.spot_next[i] = 0.0
                self._spawn_item(i)
        self.items = [it for it in self.items if it["until"] is None or now < it["until"]]
        for pid, f in self.f.items():
            if not f["alive"]:
                continue
            for it in list(self.items):
                if abs(f["x"] - it["x"]) < PICK_R and -70 < f["y"] - it["y"] < 30:
                    self._take_item(pid, it)

    def _act_swap(self, pid, data):
        f = self.f.get(pid)
        if self.phase != "play" or not f or not f["alive"]:
            return False
        near = [it for it in self.items if it["kind"] in WEAPONS and it["kind"] != f["wpn"]
                and abs(f["x"] - it["x"]) < PICK_R + 10 and -70 < f["y"] - it["y"] < 30]
        if near:
            self._take_item(pid, min(near, key=lambda it: abs(f["x"] - it["x"])), swap=True)
        return False

    # ------------------------------------------------------------------ cướp cờ
    def _drop_flag(self, pid):
        f = self.f.get(pid)
        if not f or f["flag"] is None:
            return
        fl = self.flags[f["flag"]]
        fl.update(state="dropped", x=f["x"], y=f["y"], by=None, at=time.time())
        f["flag"] = None
        self._event("drop", pid, team=self.flags.index(fl))

    def _flag_home(self, t):
        bx, by = self.map["bases"][t]
        self.flags[t].update(state="home", x=bx, y=by, by=None, at=0.0)

    def _step_flags(self, now):
        for t, fl in enumerate(self.flags):
            if fl["state"] == "dropped" and now - fl["at"] > FLAG_RETURN:
                self._flag_home(t)
                self._event("return", None, team=t)
            if fl["state"] == "carried":
                c = self.f.get(fl["by"])
                if c:
                    fl["x"], fl["y"] = c["x"], c["y"]
        for pid, f in self.f.items():
            if not f["alive"]:
                continue
            my = self.team[pid]
            for t, fl in enumerate(self.flags):
                if fl["state"] == "carried":
                    continue
                if dist(f["x"], f["y"], fl["x"], fl["y"]) > FLAG_R + 10:
                    continue
                if t != my and f["flag"] is None:
                    fl.update(state="carried", by=pid)
                    f["flag"] = t
                    self._event("take", pid, team=t)
                    self._add_log(f"🚩 {self._name(pid)} cướp được cờ đội {TEAM_NAMES[t]}!", "flag")
                elif t == my and fl["state"] == "dropped":
                    self._flag_home(t)
                    self._event("return", pid, team=t)
            # Mang cờ địch về căn cứ nhà khi cờ nhà đang ở chỗ → ghi điểm.
            if f["flag"] is not None and self.flags[my]["state"] == "home":
                bx, by = self.map["bases"][my]
                if dist(f["x"], f["y"], bx, by) < FLAG_R + 10:
                    enemy = f["flag"]
                    f["flag"] = None
                    self._flag_home(enemy)
                    self.score[my] += 1
                    self.stats[pid]["caps"] += 1
                    self._event("cap", pid, team=my)
                    self._add_log(f"🏁 {self._name(pid)} mang cờ về — đội {TEAM_NAMES[my]} ghi điểm! ({self.score[0]}–{self.score[1]})", "cap")

    # ------------------------------------------------------------------ thắng thua
    def _check_win(self):
        lim = self.config["limit"]
        mode = self.config["mode"]
        if mode == "ffa":
            top = max(self.order, key=lambda p: self.stats[p]["k"]) if self.order else None
            if top and self.stats[top]["k"] >= lim:
                self._over("limit")
                return
        elif max(self.score) >= lim:
            self._over("limit")
            return
        if self.time_left <= 0:
            self._over("time")

    def _over(self, reason):
        if self.stage == "over":
            return
        self.end_reason = reason
        mode = self.config["mode"]
        self.ranking = sorted(self.order, key=lambda p: (-self.stats[p]["k"] - 3 * self.stats[p]["caps"], self.stats[p]["d"]))
        if mode == "ffa":
            best = self.stats[self.ranking[0]]["k"] if self.ranking else 0
            tops = [p for p in self.ranking if self.stats[p]["k"] == best]
            self.winner = tops[0] if len(tops) == 1 and best > 0 else None
            if self.winner:
                self.wins[self.winner] = self.wins.get(self.winner, 0) + 1
                text = f"🏆 {self._name(self.winner)} thắng với {best} mạng!"
            else:
                text = "🤝 Hoà — không ai hơn ai!"
        else:
            a, b = self.score
            self.winner = 0 if a > b else 1 if b > a else None
            if self.winner is not None:
                for p in self.order:
                    if self.team[p] == self.winner:
                        self.wins[p] = self.wins.get(p, 0) + 1
                text = f"🏆 Đội {TEAM_NAMES[self.winner]} thắng {max(a, b)}–{min(a, b)}!"
            else:
                text = f"🤝 Hai đội hoà {a}–{b}!"
        if reason == "time":
            text = "⏰ Hết giờ! " + text
        elif reason == "stop":
            text = "🛑 Ván bị dừng. " + text
        self.stage = "over"
        self.stage_until = time.time() + OVER
        self._add_log(text, "end")
        self._post_chat("system", text)
        self._event("over", self.winner if isinstance(self.winner, str) else None, team=self.winner if isinstance(self.winner, int) else None)

    def _finish(self, reason):
        self._over(reason)
        self._end_game()

    def _end_game(self):
        self._token += 1
        self.phase = "end"
        self.stage = None
        self.bullets, self.grenades = [], []
        self._event("win", self.winner if isinstance(self.winner, str) else None)

    # ------------------------------------------------------------------ hành động khi chơi
    def _mine(self, pid, data):
        f = self.f.get(pid)
        if self.phase != "play" or not f or pid in self.brains or not f["alive"]:
            return None
        if int(_num(data.get("l"), -1)) != f["life"]:
            return None
        return f

    def _act_pos(self, pid, data):
        f = self._mine(pid, data)
        if f is None or self.stage == "intro":
            return False
        now = time.time()
        ts = max(now - 0.3, min(now, _num(data.get("ts"), now)))
        if ts <= f["t"]:
            return False
        mp = self.map
        s = str(data.get("s") or "idle")
        f.update(x=max(0.0, min(float(mp["w"]), _num(data.get("x"), f["x"]))),
                 y=max(-300.0, min(float(mp["ground"]), _num(data.get("y"), f["y"]))),
                 vx=max(-1500.0, min(1500.0, _num(data.get("vx")))), vy=max(-1500.0, min(1500.0, _num(data.get("vy")))),
                 aim=_num(data.get("a"), f["aim"]), s=s if s in STATES else "idle", t=ts)
        return False

    def _act_fire(self, pid, data):
        f = self._mine(pid, data)
        if f is None:
            return False
        x, y = _num(data.get("x"), f["x"]), _num(data.get("y"), f["y"])
        if dist(x, y, f["x"], f["y"]) < 90:      # vị trí lúc bắn (mới hơn gói vị trí gần nhất)
            f["x"], f["y"] = x, y
        f["aim"] = _num(data.get("a"), f["aim"])
        self._fire(pid, f["aim"], time.time())
        return False

    def _act_nade(self, pid, data):
        f = self._mine(pid, data)
        if f is None:
            return False
        f["aim"] = _num(data.get("a"), f["aim"])
        self._throw(pid, f["aim"], time.time())
        return False

    def _act_chat(self, pid, data):
        text = " ".join(str(data.get("text", "")).split())[:300]
        if text:
            self._post_chat("all", text, pid)

    # ------------------------------------------------------------------ gửi đi
    def _world_msg(self):
        p = {}
        now = time.time()
        for pid, f in self.f.items():
            p[pid] = [round(f["x"], 1), round(f["y"], 1), round(f["vx"]), round(f["vy"]), round(f["aim"], 3), f["s"],
                      max(0, f["hp"]), f["armor"], f["wpn"], f["ammo"], f["gren"], 1 if f["alive"] else 0, f["life"],
                      1 if now < f["inv_until"] else 0, round(f["t"], 3),
                      round(max(0.0, f["respawn_at"] - now), 1) if not f["alive"] else 0, f["flag"]]
        return {
            "type": "cw", "g": self.game_no, "ts": round(now, 3), "tl": round(self.time_left, 1),
            "p": p,
            "b": [[b["id"], round(b["x"]), round(b["y"]), round(b["vx"]), round(b["vy"]), b["kind"]] for b in self.bullets],
            "gr": [[g["id"], round(g["x"]), round(g["y"]), round(g["vx"]), round(g["vy"])] for g in self.grenades],
            "it": [[it["id"], round(it["x"]), round(it["y"]), it["kind"]] for it in self.items],
            "fl": [[fl["state"], round(fl["x"]), round(fl["y"]), fl["by"]] for fl in self.flags],
            "fx": self.fx,
        }

    def view(self, pid):
        playing = self.phase in ("play", "end")
        order = list(self.order) if playing else []
        order += [p for p in self.room.players if p not in order]
        lobby_teams = self._lobby_teams() if self.phase != "play" else {}
        players = []
        for p_id in order:
            p = self.room.players.get(p_id)
            st = self.stats.get(p_id, {})
            in_game = p_id in self.order
            t = self.team.get(p_id) if in_game and self.phase == "play" else lobby_teams.get(p_id, self.team.get(p_id))
            players.append({
                "id": p_id,
                "name": p.name if p else self.names.get(p_id, "?"),
                "bot": bool(p and p.is_bot),
                "connected": bool(p and p.connected),
                "look": p.look if p else None,
                "host": p_id == self.room.host_id,
                "playing": in_game,
                "team": t if self.teams else -1,
                "picked": p_id in self.team_pref,
                "color": self.colors.get(p_id) or (TEAM_COLORS[t] if self.teams and t in (0, 1) else None),
                "k": st.get("k", 0), "d": st.get("d", 0), "caps": st.get("caps", 0), "best": st.get("best", 0),
                "wins": self.wins.get(p_id, 0),
            })
        f = self.f.get(pid)
        return {
            "phase": self.phase,
            "stage": self.stage,
            "stageUntil": self.stage_until,
            "gameNo": self.game_no,
            "me": {"id": pid, "host": pid == self.room.host_id, "playing": pid in self.order,
                   "life": f["life"] if f else 0, "spawn": [f["x"], f["y"]] if f else None},
            "players": players,
            "mode": self.config["mode"],
            "map": self.map if self.phase != "lobby" else MAPS[self.config["map"]],
            "score": self.score,
            "timeLeft": self.time_left,
            "winner": self.winner,
            "ranking": self.ranking,
            "endReason": self.end_reason,
            "now": time.time(),
            "events": self.events[-20:],
            "config": self.config,
            "choices": {"mode": MODES, "map": [[k, m["name"]] for k, m in MAPS.items()], "time": TIMES,
                        "limit": LIMITS[self.config["mode"]], "bot_level": BOT_LEVELS},
            "modeNames": MODE_NAMES,
            "teamColors": TEAM_COLORS,
            "teamNames": TEAM_NAMES,
            "phys": PHYS,
            "weapons": WEAPONS,
            "grenade": GRENADE,
            "items": ITEMS,
            "maxHp": MAX_HP,
            "maxArmor": MAX_ARMOR,
            "maxPlayers": self.max_players,
            "startError": self._start_error() if self.phase != "play" else None,
            "chat": self.chat[-150:],
            "log": self.log[-100:],
        }
