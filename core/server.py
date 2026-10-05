"""Nền tảng Game Hub: HTTP + WebSocket, quản lý phòng chơi và người chơi."""
import asyncio
import json
import logging
import os
import random
import re
import socket
import ssl
import sys
import time
import unicodedata

from aiohttp import WSMsgType, web

from core.game_base import GameError
from core.tls import ensure_cert
from games import discover_games

log = logging.getLogger("gamehub")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(ROOT, "static")
CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
EMPTY_ROOM_GRACE = 30           # mọi người mất kết nối → xoá phòng sau 30s (đủ để tải lại trang)
UNUSED_ROOM_GRACE = 120         # phòng vừa tạo mà chưa ai vào → xoá sau 2 phút
LOBBY_DISCONNECT_TIMEOUT = 90    # xoá người chơi rớt mạng khỏi phòng chờ sau 90s
LOBBY_PRESENCE_TTL = 25          # người ở sảnh không điểm danh quá 25s → coi như đã rời
LOBBY_PRESENCE_MAX = 1000
BOT_NAMES = ["Tí", "Tèo", "Mận", "Đào", "Sơn", "Hải", "Linh", "Khoa", "Vy", "Quân",
             "Nhi", "Tùng", "Hoa", "Long", "Trang", "Minh", "Yến", "Phát", "Bống", "Cốm"]


def _dumps(msg):
    return json.dumps(msg, ensure_ascii=False)


FX_KINDS = {"wave", "heart", "flower", "tomato", "highfive", "poke",
            "laugh", "angry", "cry", "shock", "think", "clap", "dance"}
_LOOK_KEY = re.compile(r"^[A-Za-z]{1,16}$")
_LOOK_VAL = re.compile(r"^#?[A-Za-z0-9_-]{1,16}$")


def clean_look(value):
    """Ngoại hình nhân vật: chỉ nhận các cặp khoá/giá trị ngắn, an toàn."""
    if not isinstance(value, dict):
        return None
    out = {}
    for k, v in list(value.items())[:16]:
        if isinstance(k, str) and isinstance(v, str) and _LOOK_KEY.match(k) and _LOOK_VAL.match(v):
            out[k] = v
    return out or None


def clean_name(value):
    name = " ".join(str(value or "").split())
    return name[:20]


class Player:
    def __init__(self, pid, name, is_bot=False):
        self.id = pid
        self.name = name
        self.is_bot = is_bot
        self.look = None
        self.ws = None
        self.disconnected_at = None
        self.last_fx = 0.0
        self.voice_on = False
        self.voice_muted = False

    @property
    def connected(self):
        return self.is_bot or (self.ws is not None and not self.ws.closed)

    @property
    def online_human(self):
        return not self.is_bot and self.ws is not None and not self.ws.closed


class Room:
    def __init__(self, code, game_cls):
        self.code = code
        self.game_cls = game_cls
        self.players = {}  # pid -> Player, giữ thứ tự vào phòng
        self.host_id = None
        self.lock = asyncio.Lock()
        self.last_active = time.time()
        self.empty_since = None   # lúc phòng bắt đầu không còn người thật nào kết nối
        self.ever_joined = False
        self.game = game_cls(self)

    @property
    def host(self):
        return self.players.get(self.host_id)

    def humans_online(self, exclude=None):
        return [p for p in self.players.values() if p.online_human and p is not exclude]

    def add_player(self, player):
        self.players[player.id] = player
        if self.host_id is None:
            self.host_id = player.id

    def remove_player(self, pid):
        self.players.pop(pid, None)
        if self.host_id == pid:
            self._pick_new_host()

    def _pick_new_host(self):
        humans = [p for p in self.players.values() if not p.is_bot]
        candidates = [p for p in humans if p.online_human] or humans
        self.host_id = candidates[0].id if candidates else None

    def ensure_host_online(self):
        host = self.host
        if host is None or not host.online_human:
            online = [p for p in self.players.values() if p.online_human]
            if online:
                self.host_id = online[0].id

    def add_bot(self):
        if not self.game.supports_bots:
            raise GameError("Game này chưa hỗ trợ bot.")
        ok, reason = self.game.can_join()
        if not ok:
            raise GameError("Chỉ thêm bot được khi đang ở phòng chờ.")
        if len(self.players) >= self.game_cls.max_players:
            raise GameError("Phòng đã đầy.")
        taken = {p.name.lower() for p in self.players.values()}
        names = [f"Bot {n}" for n in BOT_NAMES if f"bot {n.lower()}" not in taken]
        name = random.choice(names) if names else f"Bot {len(self.players) + 1}"
        bot = Player(f"bot-{random.getrandbits(40):x}", name, is_bot=True)
        self.add_player(bot)
        return bot

    async def send(self, player, msg):
        if player.ws is not None and not player.ws.closed:
            try:
                await player.ws.send_str(_dumps(msg))
            except Exception:  # kết nối vừa đứt
                pass

    async def toast(self, pid, message, kind="info"):
        player = self.players.get(pid)
        if player:
            await self.send(player, {"type": "toast", "message": message, "kind": kind})

    async def broadcast(self, msg):
        for player in list(self.players.values()):
            await self.send(player, msg)

    async def emit_fx(self, from_pid, to_pid, kind):
        """Phát một hiệu ứng tương tác (vẫy tay, ném cà chua...) cho mọi người."""
        if kind not in FX_KINDS or from_pid not in self.players:
            return False
        if to_pid is not None and to_pid not in self.players:
            return False
        ok, _ = self.game.allow_fx(from_pid, to_pid)
        if not ok:
            return False
        await self.broadcast({"type": "fx", "from": from_pid, "to": to_pid, "kind": kind})
        try:
            self.game.on_fx(from_pid, to_pid, kind)
        except Exception:
            log.exception("Lỗi on_fx")
        return True

    async def broadcast_state(self):
        for player in list(self.players.values()):
            if player.connected:
                try:
                    state = self.game.view(player.id)
                except Exception:
                    log.exception("Lỗi khi tạo trạng thái cho %s", player.name)
                    continue
                await self.send(player, {"type": "state", "state": state, "voice": self.voice_info(player.id)})
        try:
            self.game.on_state_broadcast()
        except Exception:
            log.exception("Lỗi on_state_broadcast")

    def voice_info(self, pid):
        """Ai đang trong voice, mình được nói tới ai và nghe được ai (theo luật của game)."""
        peers = [p for p in self.players.values() if p.voice_on and p.online_human]
        ids = [p.id for p in peers]
        can = self.game.can_voice
        return {
            "peers": ids,
            "muted": [p.id for p in peers if p.voice_muted],
            "to": [q for q in ids if q != pid and can(pid, q)],
            "from": [q for q in ids if q != pid and can(q, pid)],
        }

    def summary(self):
        status = self.game.status()
        host = self.host
        return {
            "code": self.code,
            "game": self.game_cls.id,
            "gameName": self.game_cls.name,
            "icon": self.game_cls.icon,
            "players": len(self.players),
            "online": sum(1 for p in self.players.values() if p.online_human),
            "bots": sum(1 for p in self.players.values() if p.is_bot),
            "maxPlayers": self.game_cls.max_players,
            "host": host.name if host else "",
            "status": status.get("label", ""),
            "joinable": status.get("joinable", True),
        }


class Hub:
    def __init__(self, games):
        self.games = {g.id: g for g in games}
        self.rooms = {}
        self.lobby = {}  # người đang mở trang sảnh: pid -> {name, look, seen}

    def online(self):
        """Người thật đang hoạt động: trong phòng (đang kết nối) hoặc đang ở sảnh (điểm danh gần đây)."""
        now = time.time()
        for pid in [k for k, v in self.lobby.items() if now - v["seen"] > LOBBY_PRESENCE_TTL]:
            del self.lobby[pid]
        out = {}
        for room in self.rooms.values():
            for p in room.players.values():
                if p.online_human and p.id not in out:
                    out[p.id] = {
                        "id": p.id, "name": p.name, "look": p.look,
                        "room": {"code": room.code, "game": room.game_cls.id, "gameName": room.game_cls.name,
                                 "icon": room.game_cls.icon, "joinable": room.game.status().get("joinable", True)},
                    }
        for pid, v in self.lobby.items():
            if pid not in out:
                out[pid] = {"id": pid, "name": v["name"], "look": v["look"], "room": None}
        return sorted(out.values(), key=lambda x: (x["room"] is None, x["name"].lower()))[:500]

    def create_room(self, game_id):
        game_cls = self.games.get(game_id)
        if game_cls is None:
            raise KeyError(game_id)
        while True:
            code = "".join(random.choice(CODE_CHARS) for _ in range(4))
            if code not in self.rooms:
                break
        room = Room(code, game_cls)
        self.rooms[code] = room
        log.info("Tạo phòng %s (%s)", code, game_cls.name)
        return room

    def close_room(self, code):
        room = self.rooms.pop(code, None)
        if room:
            room.game.dispose()
            log.info("Đóng phòng %s", code)

    async def join(self, ws, data):
        """Trả về (room, player, lỗi)."""
        code = str(data.get("room", "")).strip().upper()
        room = self.rooms.get(code)
        if room is None:
            return None, None, _fatal("room_not_found", "Phòng không tồn tại hoặc đã đóng.")
        name = clean_name(data.get("name"))
        if not name:
            return None, None, _fatal("bad_name", "Vui lòng nhập tên của bạn.")
        pid = str(data.get("pid", ""))[:64] or f"p{random.getrandbits(48):x}"

        async with room.lock:
            player = room.players.get(pid)
            if player is None:
                same_name = next((p for p in room.players.values() if p.name.lower() == name.lower()), None)
                if same_name is not None:
                    if same_name.connected:
                        return None, None, _fatal("name_taken", f"Tên “{name}” đã có người dùng trong phòng này.")
                    player = same_name  # vào lại bằng tên cũ (vd: đổi thiết bị / mất phiên)
                else:
                    ok, reason = room.game.can_join()
                    if not ok:
                        return None, None, _fatal("cannot_join", reason)
                    if len(room.players) >= room.game.room_limit():
                        return None, None, _fatal("full", "Phòng đã đầy.")
                    player = Player(pid, name)
                    room.add_player(player)
                    await room.game.on_player_join(player)
            look = clean_look(data.get("look"))
            if look:
                player.look = look
            if player.name != name and room.game.can_rename():
                if not any(p is not player and p.name.lower() == name.lower() for p in room.players.values()):
                    player.name = name

            old_ws = player.ws
            player.ws = ws
            player.voice_on = False
            player.disconnected_at = None
            room.last_active = time.time()
            room.ever_joined = True
            room.empty_since = None
            if old_ws is not None and old_ws is not ws and not old_ws.closed:
                try:
                    await old_ws.send_str(_dumps(_fatal("replaced", "Bạn đã mở phòng này ở một tab/thiết bị khác.")))
                except Exception:
                    pass
                asyncio.ensure_future(old_ws.close())
            room.ensure_host_online()
            await room.send(player, {
                "type": "joined", "pid": player.id, "name": player.name,
                "room": room.code, "game": room.game_cls.id,
            })
            await room.game.on_player_connect(player)
            await room.broadcast_state()
        return room, player, None

    async def remove(self, room, player, kicked=False):
        """Gọi khi đang giữ room.lock."""
        if player.id not in room.players:
            return
        if not room.game.can_remove(player.id):
            raise GameError("Không thể rời/xoá người chơi khi ván đang diễn ra.")
        room.remove_player(player.id)
        ws, player.ws = player.ws, None
        await room.game.on_player_removed(player)
        if ws is not None and not ws.closed:
            if kicked:
                try:
                    await ws.send_str(_dumps(_fatal("kicked", "Bạn đã bị chủ phòng mời ra khỏi phòng.")))
                except Exception:
                    pass
            asyncio.ensure_future(ws.close())

    async def cleanup_loop(self):
        while True:
            await asyncio.sleep(5)
            now = time.time()
            for code, room in list(self.rooms.items()):
                try:
                    async with room.lock:
                        online = room.humans_online()
                        if online:
                            room.empty_since = None
                        else:
                            room.empty_since = room.empty_since or now
                            grace = EMPTY_ROOM_GRACE if room.ever_joined else UNUSED_ROOM_GRACE
                            if now - room.empty_since >= grace:
                                self.close_room(code)
                                continue
                        changed = False
                        for p in list(room.players.values()):
                            if (not p.connected and p.disconnected_at
                                    and now - p.disconnected_at > LOBBY_DISCONNECT_TIMEOUT
                                    and room.game.can_remove(p.id)):
                                room.remove_player(p.id)
                                await room.game.on_player_removed(p)
                                changed = True
                        if room.host and not room.host.online_human and online:
                            room.ensure_host_online()
                            changed = True
                        if changed:
                            await room.broadcast_state()
                except Exception:
                    log.exception("Lỗi dọn phòng %s", code)


def _fatal(code, message):
    return {"type": "error", "fatal": True, "code": code, "message": message}


# --------------------------------------------------------------------------- HTTP

async def ws_handler(request):
    hub = request.app["hub"]
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(request)
    room = player = None
    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                data = json.loads(msg.data)
            except ValueError:
                continue
            if not isinstance(data, dict):
                continue
            kind = data.get("type")

            if player is None:
                if kind != "join":
                    continue
                room, player, err = await hub.join(ws, data)
                if err:
                    await ws.send_str(_dumps(err))
                    await ws.close()
                    break
                continue

            if player.ws is not ws:  # đã bị tab khác thay thế
                break
            room.last_active = time.time()

            if kind == "voice":
                async with room.lock:
                    player.voice_on = bool(data.get("on"))
                    player.voice_muted = bool(data.get("muted"))
                    await room.broadcast_state()
                continue
            if kind == "rtc":
                target = room.players.get(str(data.get("to", "")))
                if target is not None and target.voice_on and player.voice_on and isinstance(data.get("data"), dict):
                    await room.send(target, {"type": "rtc", "from": player.id, "data": data["data"]})
                continue

            if kind == "action":
                action = str(data.get("action", ""))
                payload = data.get("data")
                if not isinstance(payload, dict):
                    payload = {}
                if action == "fx":
                    kind = str(payload.get("kind", ""))
                    target = payload.get("target")
                    target = str(target) if target is not None else None
                    now = time.time()
                    if kind not in FX_KINDS or now - player.last_fx < 0.5:
                        continue
                    ok, reason = room.game.allow_fx(player.id, target)
                    if not ok:
                        await room.toast(player.id, reason or "Không thể tương tác lúc này.", "error")
                        continue
                    player.last_fx = now
                    await room.emit_fx(player.id, target, kind)
                    continue
                try:
                    async with room.lock:
                        if action == "set_look":
                            player.look = clean_look(payload.get("look"))
                        elif action == "kick":
                            if player.id != room.host_id:
                                raise GameError("Chỉ chủ phòng mới được mời người khác ra.")
                            target = room.players.get(str(payload.get("pid", "")))
                            if target is None or target is player:
                                raise GameError("Người chơi không hợp lệ.")
                            await hub.remove(room, target, kicked=True)
                        elif action in ("add_bot", "remove_bots"):
                            if player.id != room.host_id:
                                raise GameError("Chỉ chủ phòng mới được thêm/xoá bot.")
                            if action == "add_bot":
                                count = max(1, min(17, int(payload.get("count", 1) or 1)))
                                for _ in range(count):
                                    if len(room.players) >= room.game_cls.max_players:
                                        break
                                    bot = room.add_bot()
                                    await room.game.on_player_join(bot)
                            else:
                                for bot in [p for p in room.players.values() if p.is_bot]:
                                    await hub.remove(room, bot)
                        else:
                            # Game trả về False khi đã tự gửi dữ liệu nhẹ (VD nét vẽ) — không cần gửi lại toàn bộ trạng thái.
                            if await room.game.on_action(player, action, payload) is False:
                                continue
                        await room.broadcast_state()
                except GameError as e:
                    await room.toast(player.id, str(e), "error")
                except Exception:
                    log.exception("Lỗi xử lý hành động %s", action)
                    await room.toast(player.id, "Có lỗi xảy ra trên máy chủ.", "error")
            elif kind == "leave":
                async with room.lock:
                    try:
                        await hub.remove(room, player)
                    except GameError:
                        pass  # đang chơi: giữ chỗ, chỉ ngắt kết nối
                    if not room.humans_online(exclude=player):
                        hub.close_room(room.code)  # người thật cuối cùng đã rời → xoá phòng ngay
                    else:
                        await room.broadcast_state()
                break
    finally:
        if room is not None and player is not None and player.ws is ws:
            player.ws = None
            player.voice_on = False
            player.disconnected_at = time.time()
            room.last_active = time.time()
            if hub.rooms.get(room.code) is room:  # phòng đã bị xoá thì thôi
                async with room.lock:
                    room.ensure_host_online()
                    try:
                        await room.game.on_player_disconnect(player)
                    except Exception:
                        log.exception("Lỗi on_player_disconnect")
                    await room.broadcast_state()
    return ws


async def api_games(request):
    hub = request.app["hub"]
    return web.json_response([g.meta() for g in hub.games.values()])


async def api_rooms(request):
    hub = request.app["hub"]
    rooms = sorted(hub.rooms.values(), key=lambda r: -r.last_active)
    return web.json_response([r.summary() for r in rooms])


async def api_presence(request):
    """Trang sảnh điểm danh định kỳ ({pid, name, look}); {pid, leave: true} khi đóng trang."""
    hub = request.app["hub"]
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    pid = str(body.get("pid", ""))[:64]
    if not pid:
        return web.json_response({"error": "Thiếu mã người chơi."}, status=400)
    if body.get("leave"):
        hub.lobby.pop(pid, None)
        return web.json_response({"ok": True})
    if pid not in hub.lobby and len(hub.lobby) >= LOBBY_PRESENCE_MAX:
        return web.json_response({"ok": False})
    hub.lobby[pid] = {"name": clean_name(body.get("name")) or "Khách", "look": clean_look(body.get("look")),
                      "seen": time.time()}
    return web.json_response({"ok": True})


async def api_online(request):
    return web.json_response(request.app["hub"].online())


async def api_room(request):
    hub = request.app["hub"]
    room = hub.rooms.get(request.match_info["code"].upper())
    if room is None:
        return web.json_response({"error": "Phòng không tồn tại."}, status=404)
    return web.json_response(room.summary())


async def api_create_room(request):
    hub = request.app["hub"]
    try:
        body = await request.json()
    except Exception:
        body = {}
    game_id = str((body or {}).get("game", ""))
    try:
        room = hub.create_room(game_id)
    except KeyError:
        return web.json_response({"error": "Game không tồn tại."}, status=400)
    return web.json_response(room.summary())


# --------------------------------------------------------------------------- giọng đọc tiếng Việt
# Máy chủ tạo MP3 để giọng giống nhau trên mọi trình duyệt (Chrome không có sẵn giọng Việt). Hai giọng,
# mỗi giọng cố định MỘT nguồn — không bao giờ tự đổi sang giọng khác, tránh câu giọng Bắc câu giọng Nam:
#   north — giọng Bắc “Hoài My” của Microsoft (cần `pip install edge-tts`); dịch vụ thỉnh thoảng lỗi
#           ngẫu nhiên nên thử lại vài lần.
#   south — giọng Nam của Google Dịch: nhanh, ổn định.
# Cả hai đều cần máy chủ có Internet.

TTS_ACCENTS = ("north", "south")
TTS_NORTH_VOICE = "vi-VN-HoaiMyNeural"
TTS_NORTH_TRIES = 6
TTS_NORTH_HEDGE = 1.5     # giây
TTS_NORTH_DEADLINE = 15   # giây
TTS_CACHE_MAX = 300
_tts_cache = {}
_tts_inflight = {}  # nhiều người cùng xin một câu (quản trò nói cho cả phòng) → chỉ tạo một lần


async def _tts_edge(text, voice):
    try:
        import edge_tts
    except ImportError:
        return None
    data = bytearray()
    async for chunk in edge_tts.Communicate(text, voice).stream():
        if chunk["type"] == "audio":
            data += chunk["data"]
    return bytes(data)


def _tts_chunks(text, limit=190):
    """Google Dịch chỉ nhận tối đa ~200 ký tự mỗi lần: cắt theo câu / dấu phẩy / khoảng trắng."""
    parts = []
    rest = text
    while len(rest) > limit:
        cut = max(rest.rfind(sep, 0, limit) for sep in (". ", "! ", "? ", ", ", " "))
        cut = cut + 1 if cut > 0 else limit
        parts.append(rest[:cut].strip())
        rest = rest[cut:].strip()
    return parts + ([rest] if rest else [])


async def _tts_google(session, text):
    data = bytearray()
    for part in _tts_chunks(text):
        async with session.get("https://translate.google.com/translate_tts",
                               params={"ie": "UTF-8", "tl": "vi", "client": "tw-ob", "q": part},
                               headers={"User-Agent": "Mozilla/5.0"}) as r:
            if r.status != 200 or r.content_type != "audio/mpeg":
                raise RuntimeError(f"Google TTS {r.status}")
            data += await r.read()  # các đoạn MP3 nối tiếp nhau vẫn phát liền mạch
    return bytes(data)


async def _tts_make(accent, text):
    if accent == "south":
        from aiohttp import ClientSession, ClientTimeout
        async with ClientSession(timeout=ClientTimeout(total=8)) as session:
            return await _tts_google(session, text)
    try:
        import edge_tts  # noqa: F401
    except ImportError:
        raise RuntimeError("chưa cài edge-tts (pip install edge-tts)")
    # Dịch vụ lỗi chập chờn: lần thành công ~1s, lần lỗi ~3s mới báo. Nên “gửi dự phòng”: sau HEDGE
    # giây chưa xong thì gửi thêm một yêu cầu song song, lấy cái về trước; tối đa TTS_NORTH_TRIES lần.
    loop = asyncio.get_running_loop()
    deadline = loop.time() + TTS_NORTH_DEADLINE
    running = set()
    started = 0
    try:
        while loop.time() < deadline:
            if started < TTS_NORTH_TRIES and len(running) < 2:
                running.add(asyncio.ensure_future(_tts_edge(text, TTS_NORTH_VOICE)))
                started += 1
            if not running:
                break
            wait = TTS_NORTH_HEDGE if started < TTS_NORTH_TRIES else deadline - loop.time()
            done, running = await asyncio.wait(running, timeout=max(0.05, min(wait, deadline - loop.time())),
                                               return_when=asyncio.FIRST_COMPLETED)
            for fut in done:
                try:
                    audio = fut.result()
                except Exception as e:  # không nhận được âm thanh / mất mạng…
                    log.debug("edge-tts lỗi: %s", e)
                    continue
                if audio:
                    return audio
    finally:
        for fut in running:
            fut.cancel()
    return None


async def api_tts(request):
    """Đọc câu tiếng Việt (tối đa 300 ký tự) thành MP3. ?accent=north|south"""
    text = unicodedata.normalize("NFC", " ".join(request.query.get("text", "").split()))[:300]
    accent = request.query.get("accent", "north")
    if accent not in TTS_ACCENTS:
        accent = "north"
    if not text:
        return web.json_response({"error": "Thiếu nội dung."}, status=400)
    key = (accent, text)
    audio = _tts_cache.get(key)
    if not audio:
        job = _tts_inflight.get(key)
        if job is None:
            job = _tts_inflight[key] = asyncio.ensure_future(_tts_make(accent, text))
            job.add_done_callback(lambda _: _tts_inflight.pop(key, None))
        try:
            audio = await asyncio.shield(job)
        except Exception as e:
            log.warning("Không tạo được giọng đọc (%s): %s", accent, e)
            audio = None
        if not audio:
            return web.json_response({"error": "Không tạo được giọng đọc (máy chủ cần kết nối Internet)."}, status=502)
        if len(_tts_cache) >= TTS_CACHE_MAX:
            _tts_cache.pop(next(iter(_tts_cache)))
        _tts_cache[key] = audio
    return web.Response(body=audio, content_type="audio/mpeg", headers={"Cache-Control": "max-age=86400"})


async def api_info(request):
    port = request.app["port"]
    https_port = request.app.get("https_port")
    ips = lan_ips()
    return web.json_response({
        "port": port, "httpsPort": https_port,
        "urls": [f"http://{ip}:{port}" for ip in ips],
        "https": [f"https://{ip}:{https_port}" for ip in ips] if https_port else [],
    })


def lan_ips():
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    return [ip for ip in ips if not ip.startswith("127.")]


@web.middleware
async def no_cache(request, handler):
    resp = await handler(request)
    if request.path.endswith((".html", ".js", ".css", "/")):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


def make_app(port):
    games = discover_games()
    hub = Hub(games)
    app = web.Application(middlewares=[no_cache])
    app["hub"] = hub
    app["port"] = port

    async def index(request):
        return web.FileResponse(os.path.join(STATIC_DIR, "index.html"))

    app.router.add_get("/", index)
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/api/games", api_games)
    app.router.add_get("/api/rooms", api_rooms)
    app.router.add_post("/api/rooms", api_create_room)
    app.router.add_get("/api/rooms/{code}", api_room)
    app.router.add_get("/api/info", api_info)
    app.router.add_get("/api/tts", api_tts)
    app.router.add_post("/api/presence", api_presence)
    app.router.add_get("/api/online", api_online)
    app.router.add_static("/static/", STATIC_DIR)

    for game in games:
        def make_index(g):
            async def handler(request):
                return web.FileResponse(os.path.join(g.static_dir, "index.html"))
            return handler

        def make_redirect(g):
            async def handler(request):
                raise web.HTTPFound(f"/g/{g.id}/" + (f"?{request.query_string}" if request.query_string else ""))
            return handler

        app.router.add_get(f"/g/{game.id}", make_redirect(game))
        app.router.add_get(f"/g/{game.id}/", make_index(game))
        app.router.add_static(f"/g/{game.id}/", game.static_dir)

    async def start_cleanup(app_):
        app_["cleanup"] = asyncio.ensure_future(hub.cleanup_loop())

    async def stop_cleanup(app_):
        app_["cleanup"].cancel()

    app.on_startup.append(start_cleanup)
    app.on_cleanup.append(stop_cleanup)
    return app, games


def _quiet_connection_reset(loop, context):
    """Windows hay báo ConnectionResetError khi trình duyệt ngắt kết nối đột ngột — vô hại, bỏ qua."""
    if isinstance(context.get("exception"), ConnectionResetError):
        return
    loop.default_exception_handler(context)


def run(host="0.0.0.0", port=8080, https=False, https_port=None):
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        except Exception:
            pass
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("aiohttp.access").setLevel(logging.WARNING)
    app, games = make_app(port)
    ips = lan_ips()

    ssl_ctx = None
    if https:
        try:
            cert, key = ensure_cert(os.path.join(ROOT, ".certs"), ips)
            ssl_ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
            ssl_ctx.load_cert_chain(cert, key)
        except Exception as e:  # thiếu thư viện cryptography, ...
            log.warning("Không bật được HTTPS (%s) — voice chat chỉ dùng được trên localhost.", e)
            ssl_ctx = None
    app["https_port"] = None

    def banner(bound_https):
        print("=" * 64)
        print(" 🎲 GAME HUB đã sẵn sàng!")
        print(f"   Game: {', '.join(g.name for g in games) or '(chưa có)'}")
        print(f"   Máy này:      http://localhost:{port}")
        for ip in ips:
            print(f"   Bạn bè (LAN): http://{ip}:{port}")
        if bound_https:
            print(" 🎙️  Muốn nói chuyện bằng mic? Dùng địa chỉ HTTPS:")
            for ip in ips:
                print(f"   https://{ip}:{bound_https}")
            print("   (trình duyệt sẽ cảnh báo chứng chỉ tự ký → bấm 'Nâng cao' → 'Tiếp tục')")
        print(" Nhấn Ctrl+C để dừng.")
        print("=" * 64)

    async def serve():
        asyncio.get_running_loop().set_exception_handler(_quiet_connection_reset)
        runner = web.AppRunner(app)
        await runner.setup()
        try:
            try:
                await web.TCPSite(runner, host, port).start()
            except OSError:
                print("=" * 64)
                print(f" ❌ Cổng {port} đang bị chương trình khác dùng.")
                print("    • Có thể Game Hub đang chạy ở cửa sổ/tab khác → hãy tắt nó (Ctrl+C) rồi chạy lại.")
                print(f"    • Hoặc chọn cổng khác:  python main.py --port {port + 10}")
                print("=" * 64)
                return
            bound_https = None
            if ssl_ctx:
                # Cổng HTTPS mặc định = cổng + 1; nếu bận thì tự tìm cổng trống kế tiếp.
                first = https_port or port + 1
                for candidate in range(first, first + 20):
                    if candidate == port:
                        continue
                    try:
                        await web.TCPSite(runner, host, candidate, ssl_context=ssl_ctx).start()
                        bound_https = candidate
                        break
                    except OSError:
                        continue
                if bound_https is None:
                    log.warning("Không tìm được cổng trống cho HTTPS — voice chat chỉ dùng được trên localhost.")
                elif bound_https != first:
                    log.info("Cổng %s đang bận, HTTPS chuyển sang cổng %s.", first, bound_https)
            app["https_port"] = bound_https
            banner(bound_https)
            while True:
                await asyncio.sleep(1)
        finally:
            await runner.cleanup()

    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        pass
