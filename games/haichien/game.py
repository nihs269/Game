"""Hải Chiến (bắn tàu / Battleship) — 2 người, mỗi người giấu một hạm đội trên lưới rồi lần lượt bắn vào vùng biển
của đối phương. Bắn chìm hết hạm đội địch trước thì thắng.

Chế độ:
  • Cổ điển — lưới 10×10, 5 tàu thẳng: tàu sân bay (5), thiết giáp hạm (4), tuần dương hạm (3), tàu ngầm (3), khu trục hạm (2).
  • Tuỳ chỉnh — chọn cỡ bản đồ 8 / 10 / 12 / 14 và hạm đội tàu thẳng hoặc đa hình (chữ L, T, Z, ô vuông…), xem fleet.py.
Luật:
  • Xếp tàu: xoay 90° tuỳ ý, không chồng lên nhau (tuỳ chọn: không được đặt sát nhau, kể cả chéo).
  • Bắn: mỗi lượt 1 ô. Trúng thì (tuỳ chọn, mặc định bật) được bắn tiếp. Tàu bị bắn trúng hết các ô thì chìm và lộ hình.
  • Hết giờ lượt → máy bắn hộ. Người vào phòng sau chỉ xem (không thấy tàu chưa chìm của ai).
"""
import asyncio
import logging
import random
import time

from core.game_base import BaseGame, GameError
from .bots import HaiChienBotMixin
from .fleet import SIZES, build_fleet, cells_at, random_place, rotations, validate

log = logging.getLogger("gamehub.haichien")

COLORS = ["#4d8df7", "#ff6b6b"]
TURN_TIMES = (15, 20, 30, 45)
PLACE_TIMES = (60, 90, 120)
OFFLINE_TIME = 6


class HaiChienGame(HaiChienBotMixin, BaseGame):
    id = "haichien"
    name = "Hải Chiến"
    icon = "⚓"
    description = "Bắn tàu 1 đấu 1: giấu hạm đội trên biển, đoán vị trí tàu địch và nã pháo cho tới khi đánh chìm toàn bộ!"
    min_players = 2
    max_players = 2
    max_spectators = 20
    guide = [
        ("🎯 Mục tiêu", "**Đánh chìm toàn bộ hạm đội địch** trước khi hạm đội của bạn bị đánh chìm."),
        ("🗺️ Chế độ", [
            "**Cổ điển**: lưới 10×10, 5 tàu thẳng — tàu sân bay (5 ô), thiết giáp hạm (4), tuần dương hạm (3), tàu ngầm (3), khu trục hạm (2).",
            "**Tuỳ chỉnh**: chọn cỡ bản đồ **8×8 · 10×10 · 12×12 · 14×14** (bản đồ to thì nhiều tàu hơn) và hạm đội **tàu thẳng** hoặc **đa hình** — pháo đài nổi 2×2, tàu chữ L, chữ T, chữ Z, căn cứ nổi…",
        ]),
        ("🚢 Xếp tàu", [
            "Bấm một tàu ở bến rồi bấm lên lưới để đặt; bấm vào tàu đã đặt để nhấc lên. Phím **R** hoặc nút **Xoay** để xoay 90°.",
            "Không nghĩ ra? Bấm **🎲 Xếp ngẫu nhiên**. Xếp xong bấm **Sẵn sàng**.",
        ]),
        ("💥 Bắn", [
            "Đến lượt, bấm vào một ô trên **vùng biển địch** để phóng tên lửa.",
            "🔥 **Trúng** — (mặc định) được **bắn tiếp**. 💦 **Trượt** — đến lượt đối thủ.",
            "Bắn trúng hết các ô của một tàu thì tàu **chìm** và lộ hình. Mẹo: trúng rồi thì bắn các ô xung quanh — tàu đa hình có thể rẽ ngang!",
        ]),
        ("⚙️ Tuỳ chọn (chủ phòng)", "Chế độ & cỡ bản đồ, bắn trúng được bắn tiếp, không đặt tàu sát nhau, thời gian xếp tàu và mỗi lượt bắn, độ khó bot."),
    ]

    def __init__(self, room):
        super().__init__(room)
        self.config = {"mode": "classic", "size": 10, "style": "line", "chain": True, "no_touch": False,
                       "turn_time": 20, "place_time": 90, "bot_level": "normal"}
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
        self.first = 0
        self._reset_game()
        self.phase = "lobby"

    def _reset_game(self):
        self._token += 1
        self.deadline = self.phase_total = None
        self.order = []
        self.names = {}
        self.n, self.fleet = build_fleet(self.config["mode"], self.config["size"], self.config["style"])
        self.ship = {s["id"]: s for s in self.fleet}
        self.place = {}            # pid → {ship_id: {x, y, rot}}
        self.ready = set()
        self.shots = {}            # pid → {(x, y): "miss" | "hit"} — các phát pid đã bắn vào đối thủ
        self.sunk = {}             # pid → [ship_id] — tàu CỦA pid đã chìm
        self.stats = {}
        self.stage = None          # place · battle
        self.cur = None
        self.winner = None
        self.last = None
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

    def _foe(self, pid):
        return next((p for p in self.order if p != pid), None)

    def _cells(self, sid, p):
        return cells_at(self.ship[sid], p)

    def _ship_at(self, owner, x, y):
        for sid, p in self.place.get(owner, {}).items():
            if (x, y) in self._cells(sid, p):
                return sid
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
                log.exception("Lỗi hẹn giờ Hải Chiến")
            await self.room.broadcast_state()

    def _stop_timer(self):
        self._token += 1
        self.deadline = self.phase_total = None

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
        return {"label": "Đang hải chiến", "joinable": False}

    async def on_player_join(self, player):
        self._post_chat("system", f"👋 {player.name} đã vào phòng.")

    async def on_player_removed(self, player):
        self.names[player.id] = player.name
        self._post_chat("system", f"🚪 {player.name} đã rời phòng.")

    async def on_player_disconnect(self, player):
        if self.phase == "play" and self.stage == "battle" and player.id == self.cur:
            self._turn_timer()

    async def on_player_connect(self, player):
        if self.phase == "play" and self.stage == "battle" and player.id == self.cur:
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
        for key in ("chain", "no_touch"):
            if key in data:
                self.config[key] = bool(data[key])
        for key, allowed in (("turn_time", TURN_TIMES), ("place_time", PLACE_TIMES)):
            if key in data:
                try:
                    v = int(data[key])
                except (TypeError, ValueError):
                    continue
                if v in allowed:
                    self.config[key] = v
        if data.get("bot_level") in ("easy", "normal", "hard"):
            self.config["bot_level"] = data["bot_level"]
        if data.get("mode") in ("classic", "custom"):
            self.config["mode"] = data["mode"]
        if data.get("style") in ("line", "shape"):
            self.config["style"] = data["style"]
        if "size" in data:
            try:
                v = int(data["size"])
            except (TypeError, ValueError):
                v = None
            if v in SIZES:
                self.config["size"] = v

    def _start_error(self):
        n = len(self.room.players)
        if n < 2:
            return "Cần 2 người — mời bạn bè hoặc thêm bot để đấu với máy."
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
        self.order = self.participants()[:2]
        for p in self.order:
            self.names[p] = self._name(p)
            self.place[p] = {}
            self.shots[p] = {}
            self.sunk[p] = []
            self.stats[p] = {"shots": 0, "hits": 0, "streak": 0, "best": 0}
            self.wins.setdefault(p, 0)
        self.stage = "place"
        mode = "Cổ điển" if self.config["mode"] != "custom" else f"Tuỳ chỉnh {self.n}×{self.n}, {'đa hình' if self.config['style'] == 'shape' else 'tàu thẳng'}"
        self._post_chat("system", f"⚓ Ván {self.game_no} ({mode}, {len(self.fleet)} tàu): {self._name(self.order[0])} ⚔️ {self._name(self.order[1])} — hãy xếp hạm đội!")
        self._add_log(f"⚓ Ván {self.game_no} bắt đầu — xếp hạm đội.", "start")
        self._event("place", None)
        self._set_timer(self.config["place_time"], self._auto_place)

    def _act_next_round(self, pid, data):
        self.first = 1 - self.first      # đổi người bắn trước
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
        self._finish(None, "Chủ phòng kết thúc ván")

    # ------------------------------------------------------------------ xếp tàu
    def _act_place(self, pid, data):
        if self.phase != "play" or self.stage != "place" or pid not in self.order:
            raise GameError("Không phải lúc xếp tàu.")
        raw = data.get("ships") or {}
        place = {}
        try:
            for sid, p in raw.items():
                if sid not in self.ship:
                    continue
                place[sid] = {"x": int(p["x"]), "y": int(p["y"]), "rot": int(p.get("rot", 0)) % 4}
        except (TypeError, ValueError, KeyError, AttributeError):
            raise GameError("Cách xếp tàu không hợp lệ.")
        err = validate(self.fleet, place, self.n, self.config["no_touch"])
        if err:
            raise GameError(err)
        self.place[pid] = place
        self.ready.add(pid)
        self._event("ready", pid)
        self._add_log(f"✅ {self._name(pid)} đã xếp xong hạm đội.", "ready")
        if len(self.ready) == 2:
            self._begin_battle()

    def _act_unready(self, pid, data):
        if self.phase == "play" and self.stage == "place" and pid in self.ready:
            self.ready.discard(pid)

    def _auto_place(self):
        if self.stage != "place":
            return
        for p in self.order:
            if p not in self.ready:
                self.place[p] = random_place(self.fleet, self.n, self.config["no_touch"])
                self.ready.add(p)
                self._add_log(f"🎲 Hết giờ — hạm đội của {self._name(p)} được xếp ngẫu nhiên.", "ready")
        self._begin_battle()

    def _begin_battle(self):
        self._stop_timer()
        self.stage = "battle"
        self.cur = self.order[self.first % 2]
        self._event("battle", self.cur)
        self._add_log(f"⚔️ Khai hoả! {self._name(self.cur)} bắn trước.", "start")
        self._turn_timer()

    # ------------------------------------------------------------------ bắn
    def _turn_timer(self):
        secs = self.config["turn_time"] if self._connected(self.cur) else OFFLINE_TIME
        self._set_timer(secs, self._auto_fire)

    def _auto_fire(self):
        if self.stage != "battle":
            return
        x, y = self._bot_pick(self.cur, "easy" if self._connected(self.cur) else "normal")
        self._fire(self.cur, x, y, auto=True)

    def _act_fire(self, pid, data):
        if self.phase != "play" or self.stage != "battle" or pid != self.cur:
            raise GameError("Chưa tới lượt bạn bắn.")
        try:
            x, y = int(data.get("x")), int(data.get("y"))
        except (TypeError, ValueError):
            raise GameError("Ô không hợp lệ.")
        if not (0 <= x < self.n and 0 <= y < self.n):
            raise GameError("Ô không hợp lệ.")
        if (x, y) in self.shots[pid]:
            raise GameError("Ô này đã bắn rồi.")
        self._fire(pid, x, y)

    def _fire(self, pid, x, y, auto=False):
        self._stop_timer()
        foe = self._foe(pid)
        sid = self._ship_at(foe, x, y)
        st = self.stats[pid]
        st["shots"] += 1
        result = "miss"
        sunk = None
        if sid:
            result = "hit"
            self.shots[pid][(x, y)] = "hit"
            st["hits"] += 1
            st["streak"] += 1
            st["best"] = max(st["best"], st["streak"])
            if all(self.shots[pid].get(c) == "hit" for c in self._cells(sid, self.place[foe][sid])):
                self.sunk[foe].append(sid)
                sunk = {"id": sid, "cells": self._cells(sid, self.place[foe][sid])}
                result = "sunk"
        else:
            self.shots[pid][(x, y)] = "miss"
            st["streak"] = 0
        self.last = {"pid": pid, "x": x, "y": y, "result": result}
        self._event("shot", pid, x=x, y=y, result=result, sunk=sunk, auto=auto)
        coord = f"{'ABCDEFGHIJKLMN'[y]}{x + 1}"
        if result == "sunk":
            self._add_log(f"💥 {self._name(pid)} bắn {coord} — đánh chìm {self.ship[sid]['name']} của {self._name(foe)}!", "sunk")
        elif result == "hit":
            self._add_log(f"🔥 {self._name(pid)} bắn {coord} — trúng!", "hit")
        else:
            self._add_log(f"💦 {self._name(pid)} bắn {coord} — trượt.", "miss")
        if len(self.sunk[foe]) == len(self.fleet):
            self._finish(pid, f"Đánh chìm toàn bộ hạm đội của {self._name(foe)}")
            return
        if result == "miss" or not self.config["chain"]:
            self.cur = foe
        self._turn_timer()

    def _finish(self, pid, reason):
        self._stop_timer()
        self.phase = "end"
        self.stage = None
        self.winner = pid
        self.win_reason = reason
        if pid:
            self.wins[pid] = self.wins.get(pid, 0) + 1
            st = self.stats[pid]
            acc = round(100 * st["hits"] / max(1, st["shots"]))
            text = f"🏆 {self._name(pid)} thắng ván {self.game_no}! ({reason} · {st['shots']} phát, chính xác {acc}%)"
        else:
            text = f"🏁 Ván {self.game_no} dừng."
        self._add_log(text, "end")
        self._post_chat("system", text)
        self._event("win", pid)

    # ------------------------------------------------------------------ chat
    def _act_chat(self, pid, data):
        text = " ".join(str(data.get("text", "")).split())[:300]
        if text:
            self._post_chat("all", text, pid)

    # ------------------------------------------------------------------ trạng thái
    def _board_view(self, owner, viewer):
        """Vùng biển của `owner` như `viewer` nhìn thấy: các phát bắn của đối thủ + tàu (của mình hoặc đã chìm)."""
        foe = self._foe(owner)
        ended = self.phase == "end"
        shots = [{"x": x, "y": y, "r": r} for (x, y), r in (self.shots.get(foe) or {}).items()]
        ships = []
        for sid, p in (self.place.get(owner) or {}).items():
            sunk = sid in self.sunk.get(owner, [])
            if viewer == owner or sunk or ended:
                ships.append({"id": sid, "type": self.ship[sid]["type"], "kind": self.ship[sid]["kind"],
                              "name": self.ship[sid]["name"], **p, "cells": self._cells(sid, p), "sunk": sunk})
        return {"owner": owner, "shots": shots, "ships": ships, "sunk": list(self.sunk.get(owner, [])),
                "afloat": len(self.fleet) - len(self.sunk.get(owner, []))}

    def view(self, pid):
        playing = self.phase in ("play", "end")
        order = list(self.order) if playing else []
        order += [p for p in self.room.players if p not in order]
        players = []
        for i, p_id in enumerate(order):
            p = self.room.players.get(p_id)
            st = self.stats.get(p_id) or {}
            players.append({
                "id": p_id,
                "name": p.name if p else self.names.get(p_id, "?"),
                "bot": bool(p and p.is_bot),
                "connected": bool(p and p.connected),
                "look": p.look if p else None,
                "host": p_id == self.room.host_id,
                "playing": p_id in self.order,
                "color": COLORS[self.order.index(p_id)] if p_id in self.order else None,
                "ready": p_id in self.ready,
                "wins": self.wins.get(p_id, 0),
                "shots": st.get("shots", 0),
                "hits": st.get("hits", 0),
                "best": st.get("best", 0),
            })
        boards = {p: self._board_view(p, pid) for p in self.order} if self.order else {}
        return {
            "phase": self.phase,
            "stage": self.stage,
            "gameNo": self.game_no,
            "me": {"id": pid, "host": pid == self.room.host_id, "playing": pid in self.order,
                   "ready": pid in self.ready},
            "players": players,
            "order": self.order,
            "turn": self.cur if self.stage == "battle" else None,
            "boards": boards,
            "fleet": [{**f, "rots": rotations(f)} for f in self.fleet],
            "n": self.n,
            "last": self.last,
            "winner": self.winner,
            "winReason": getattr(self, "win_reason", ""),
            "deadline": self.deadline,
            "total": self.phase_total,
            "now": time.time(),
            "events": self.events[-15:],
            "config": self.config,
            "choices": {"turn_time": TURN_TIMES, "place_time": PLACE_TIMES, "size": SIZES},
            "preview": [{"name": f["name"], "type": f["type"], "kind": f["kind"], "cells": f["cells"], "size": f["size"]}
                        for f in build_fleet(self.config["mode"], self.config["size"], self.config["style"])[1]],
            "previewN": build_fleet(self.config["mode"], self.config["size"], self.config["style"])[0],
            "minPlayers": self.min_players,
            "maxPlayers": self.max_players,
            "startError": self._start_error() if self.phase != "play" else None,
            "chat": self.chat[-150:],
            "log": self.log[-100:],
        }
