"""Lớp Nhạc Cụ — cùng nhau học chơi sáo trúc, piano và violin ngay trên trình duyệt.

Mỗi người tự chọn nhạc cụ. Âm thanh được tổng hợp ở trình duyệt (WebAudio), máy chủ
chỉ chuyển tiếp nốt nhạc để cả phòng nghe nhau đàn (phòng tập tự do), ghi nhận tiến
độ học bài và điều khiển hai kiểu thi:
  - Thi tài: cả phòng cùng chơi một bài theo nhịp, trình duyệt tự chấm điểm rồi gửi lên.
  - Đoán nốt: nghe một nốt (sau nốt Đô chuẩn) rồi chơi lại đúng nốt đó, nhanh thì thêm điểm.
Danh sách bài nằm trong static/songs.json, dùng chung cho cả máy chủ lẫn giao diện.
"""
import asyncio
import json
import logging
import os
import random
import time

from core.game_base import BaseGame, GameError

log = logging.getLogger("gamehub.nhaccu")

with open(os.path.join(os.path.dirname(__file__), "static", "songs.json"), encoding="utf-8") as _f:
    SONGS = {s["id"]: s for s in json.load(_f)}

INSTRUMENTS = {"piano": "🎹 Piano", "sao": "🪈 Sáo trúc", "violin": "🎻 Violin"}
SPEEDS = (0.5, 0.75, 1.0)
DIATONIC = (0, 2, 4, 5, 7, 9, 11)
COUNTDOWN = 4.0          # đếm ngược trước khi bài thi bắt đầu
SONG_GRACE = 3.0         # chờ thêm sau nốt cuối để mọi người gửi điểm
RESULT_TIME = 25         # bảng kết quả tự đóng sau 25 giây
EAR_LEAD = 1.5           # câu hỏi đoán nốt: chờ trước khi phát âm
EAR_GAP = 1.0            # khoảng cách giữa nốt Đô chuẩn và nốt cần đoán
EAR_ANSWER = 10.0        # thời gian trả lời (tính từ lúc phát nốt cần đoán)
EAR_REVEAL = 3.0
NOTE_RATE = 30           # tối đa 30 nốt/giây mỗi người trong phòng tập
HISTORY_MAX = 20


def song_seconds(song, speed=1.0):
    beats = 0.0
    for tok in song["notes"].split():
        _, _, dur = tok.partition("-")
        beats += float(dur) if dur else 1.0
    return beats * 60.0 / song["bpm"] / speed


def song_note_count(song):
    return sum(1 for tok in song["notes"].split() if not tok.startswith("R"))


class NhacCuGame(BaseGame):
    id = "nhaccu"
    name = "Lớp Nhạc Cụ"
    icon = "🎼"
    description = "Học chơi sáo trúc, piano và violin: tập theo bài có hướng dẫn thế bấm, đàn chung cả phòng, thi chơi đúng nhịp và luyện tai đoán nốt."
    min_players = 1
    max_players = 12
    guide = [
        ("🎼 Chọn nhạc cụ", [
            "**🎹 Piano** — bấm phím bằng chuột/cảm ứng hoặc bàn phím máy tính: hàng **Z X C V B N M** là Đô→Si, hàng **Q W E R T Y U I** là quãng tám trên, phím đen ở hàng số/hàng giữa.",
            "**🪈 Sáo trúc (sáo Đô 6 lỗ)** — bàn phím: **Space** = Đô (bịt cả 6 lỗ), **A** = Rê, **S** = Mi, **D** = Fa, **J** = Sol, **K** = La, **L** = Si (mở hết) — mỗi phím mở dần lỗ từ dưới lên, giữ A S cũng được mà chỉ giữ S cũng được. Hàng **Q W E U I O** và **Shift+Space** là quãng tám trên (thổi mạnh). Hoặc nhấn giữ nút nốt bên dưới.",
            "**🎻 Violin** — 4 dây Sol Rê La Mi. Mỗi hàng phím là một dây: **1–5** dây Mi, **Q–T** dây La, **A–G** dây Rê, **Z–B** dây Sol (phím đầu là dây buông, tiếp theo là ngón 1→4). Giữ **Shift** để lên nửa cung. Nhấn giữ để kéo vĩ.",
        ]),
        ("🎶 Phòng tập", "Ai đàn gì cả phòng đều nghe thấy — rủ nhau hoà tấu! Khuông nhạc hiện các nốt vừa chơi để làm quen cách đọc nốt."),
        ("📘 Học bài", [
            "Chọn bài rồi bấm **Nghe mẫu** để nghe trước.",
            "**Chờ nốt**: nốt kế tiếp sáng lên kèm hướng dẫn bấm, bài chỉ chạy tiếp khi bạn chơi đúng — tập chậm không vội.",
            "**Theo nhịp**: nốt rơi xuống vạch theo đúng tốc độ bài (có thể giảm còn 50% / 75%).",
            "Xong bài được chấm ⭐ tới ⭐⭐⭐ — cả phòng thấy bạn đang học bài gì.",
        ]),
        ("🏆 Thi tài", "Chủ phòng chọn bài và tốc độ, cả phòng cùng chơi theo nhịp. Nốt đúng lúc được **Hoàn hảo** (100) hoặc **Tốt** (60), chuỗi liên tiếp được thưởng thêm. Ai nhiều điểm nhất thắng."),
        ("👂 Đoán nốt", "Mỗi câu phát nốt **Đô** chuẩn rồi một nốt bí ẩn — hãy chơi lại đúng nốt đó trên nhạc cụ của bạn (hoặc bấm tên nốt). Đúng được 100 điểm, càng nhanh càng được thưởng thêm. Chỉ được trả lời một lần mỗi câu."),
        ("💡 Mẹo", "Chỉ cần đúng tên nốt (Đô, Rê, Mi…), quãng tám nào cũng được tính. Có thể đổi cách ghi nốt giữa **Đô Rê Mi** và **C D E** ở nút 🔤."),
    ]

    def __init__(self, room):
        super().__init__(room)
        self.inst = {}           # pid -> nhạc cụ đang chọn
        self.activity = {}       # pid -> {"song", "pct"} bài đang học
        self.stars = {}          # pid -> {song_id: số sao tốt nhất}
        self.wins = {}           # pid -> số lần thắng thi tài / đoán nốt
        self.round = None
        self.history = []
        self.chat = []
        self._msg_id = 0
        self._rid = 0
        self._token = 0
        self.deadline = None
        self.phase_total = None
        self._note_times = {}    # pid -> [mốc thời gian các nốt gần đây]

    # ------------------------------------------------------------------ tiện ích
    def _name(self, pid):
        p = self.room.players.get(pid)
        return p.name if p else "?"

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

    def _inst_of(self, pid):
        return self.inst.get(pid, "piano")

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
            self._token += 1
            self.deadline = self.phase_total = None
            try:
                fn()
            except GameError:
                pass
            except Exception:
                log.exception("Lỗi hẹn giờ Lớp Nhạc Cụ")
            await self.room.broadcast_state()

    def _stop_timer(self):
        self._token += 1
        self.deadline = self.phase_total = None

    def dispose(self):
        self._token += 1

    # ------------------------------------------------------------------ core hooks
    def status(self):
        r = self.round
        if r and r["phase"] != "result":
            return {"label": "🏆 Đang thi tài" if r["kind"] == "song" else "👂 Đang đoán nốt", "joinable": True}
        return {"label": "🎶 Phòng tập", "joinable": True}

    async def on_player_join(self, player):
        self._post_chat("system", f"👋 {player.name} vào lớp nhạc.")

    async def on_player_removed(self, player):
        pid = player.id
        self._post_chat("system", f"🚪 {player.name} đã rời lớp.")
        for d in (self.inst, self.activity, self.stars, self.wins, self._note_times):
            d.pop(pid, None)
        r = self.round
        if r and pid in r["players"]:
            r["players"].remove(pid)
            r["scores"].pop(pid, None)
            if not r["players"] and r["phase"] != "result":
                self._stop_timer()
                self.round = None
            elif r["kind"] == "song" and r["phase"] == "play":
                self._maybe_finish_song()
            elif r["kind"] == "ear" and r["phase"] == "question":
                self._maybe_reveal()

    async def on_action(self, player, action, data):
        handler = getattr(self, "_act_" + action, None) if action.isidentifier() else None
        if handler is None:
            raise GameError("Hành động không hợp lệ.")
        result = handler(player.id, data)
        if asyncio.iscoroutine(result):
            result = await result
        return result

    # ------------------------------------------------------------------ phòng tập
    def _act_inst(self, pid, data):
        inst = str(data.get("inst", ""))
        if inst not in INSTRUMENTS:
            raise GameError("Nhạc cụ không hợp lệ.")
        self.inst[pid] = inst

    async def _act_note(self, pid, data):
        """Nốt nhạc trong phòng tập: chuyển ngay cho người khác, không gửi lại toàn bộ trạng thái."""
        try:
            midi = int(data.get("m"))
        except (TypeError, ValueError):
            return False
        if not 24 <= midi <= 108:
            return False
        on = bool(data.get("on"))
        if on:
            now = time.time()
            times = [t for t in self._note_times.get(pid, []) if now - t < 1.0]
            if len(times) >= NOTE_RATE:
                return False
            times.append(now)
            self._note_times[pid] = times
        msg = {"type": "note", "pid": pid, "m": midi, "on": on, "i": self._inst_of(pid)}
        for p in list(self.room.players.values()):
            if p.id != pid:
                await self.room.send(p, msg)
        return False

    def _act_progress(self, pid, data):
        song = str(data.get("song", ""))
        if song not in SONGS:
            self.activity.pop(pid, None)
            return
        try:
            pct = max(0, min(100, int(data.get("pct", 0))))
        except (TypeError, ValueError):
            pct = 0
        self.activity[pid] = {"song": song, "pct": pct}

    def _act_lesson_done(self, pid, data):
        song = str(data.get("song", ""))
        if song not in SONGS:
            raise GameError("Bài không hợp lệ.")
        try:
            stars = max(1, min(3, int(data.get("stars", 1))))
        except (TypeError, ValueError):
            stars = 1
        mine = self.stars.setdefault(pid, {})
        best = mine.get(song, 0)
        mine[song] = max(best, stars)
        self.activity.pop(pid, None)
        mode = "theo nhịp" if data.get("mode") == "tempo" else "chờ nốt"
        inst = INSTRUMENTS[self._inst_of(pid)]
        new = " — kỷ lục mới!" if stars > best and best else ""
        self._post_chat("system", f"🎉 {self._name(pid)} hoàn thành “{SONGS[song]['name']}” bằng {inst} ({mode}) {'⭐' * stars}{new}")

    # ------------------------------------------------------------------ thi tài
    def _participants(self):
        return [p.id for p in self.room.players.values() if p.connected]

    def _new_round(self, kind, **extra):
        players = self._participants()
        if not players:
            raise GameError("Chưa có ai để thi.")
        self._rid += 1
        self.round = {"id": self._rid, "kind": kind, "players": players, "scores": {}, **extra}

    def _act_start_song(self, pid, data):
        self._require_host(pid)
        if self.round and self.round["phase"] != "result":
            raise GameError("Đang có lượt thi rồi.")
        song = SONGS.get(str(data.get("song", "")))
        if song is None:
            raise GameError("Hãy chọn một bài.")
        try:
            speed = float(data.get("speed", 1.0))
        except (TypeError, ValueError):
            speed = 1.0
        if speed not in SPEEDS:
            speed = 1.0
        self.activity.clear()
        start = time.time() + COUNTDOWN
        self._new_round("song", song=song["id"], speed=speed, phase="play", startAt=start,
                        endAt=start + song_seconds(song, speed), total=song_note_count(song))
        pct = "" if speed == 1.0 else f" (tốc độ {int(speed * 100)}%)"
        self._post_chat("system", f"🏆 Thi tài: “{song['name']}”{pct} — chuẩn bị!")
        self._set_timer(COUNTDOWN + song_seconds(song, speed) + SONG_GRACE, self._finish_song)

    async def _act_live(self, pid, data):
        """Điểm tạm thời trong lúc thi — chỉ phát nhẹ cho cả phòng."""
        r = self.round
        if not r or r["kind"] != "song" or r["phase"] != "play" or pid not in r["players"]:
            return False
        try:
            score = max(0, min(10 ** 6, int(data.get("score", 0))))
            combo = max(0, min(10 ** 4, int(data.get("combo", 0))))
        except (TypeError, ValueError):
            return False
        r.setdefault("live", {})[pid] = score
        await self.room.broadcast({"type": "live", "pid": pid, "score": score, "combo": combo})
        return False

    def _act_score(self, pid, data):
        r = self.round
        if not r or r["kind"] != "song" or r["phase"] != "play" or pid not in r["players"]:
            return
        total = r["total"]

        def num(key, hi):
            try:
                return max(0, min(hi, int(data.get(key, 0))))
            except (TypeError, ValueError):
                return 0
        hit = num("hit", total)
        perfect = min(hit, num("perfect", total))
        combo = min(hit, num("combo", total))
        # Mỗi nốt trúng được thêm tối đa 100 điểm thưởng chuỗi → chặn điểm gửi lên quá vô lý.
        score = min(num("score", 10 ** 6), perfect * 100 + (hit - perfect) * 60 + hit * 100)
        r["scores"][pid] = {"score": score, "hit": hit, "perfect": perfect, "combo": combo}
        self._maybe_finish_song()

    def _maybe_finish_song(self):
        r = self.round
        if r and r["phase"] == "play" and all(p in r["scores"] for p in r["players"]):
            self._stop_timer()
            self._finish_song()

    def _finish_song(self):
        r = self.round
        if not r or r["phase"] != "play":
            return
        for p in r["players"]:
            r["scores"].setdefault(p, {"score": r.get("live", {}).get(p, 0), "hit": 0, "perfect": 0, "combo": 0, "missing": True})
        self._to_result(f"“{SONGS[r['song']]['name']}”")

    def _to_result(self, title):
        r = self.round
        r["phase"] = "result"
        ranking = sorted(r["players"], key=lambda p: -r["scores"].get(p, {}).get("score", 0))
        r["ranking"] = ranking
        top = r["scores"].get(ranking[0], {}).get("score", 0) if ranking else 0
        winners = [p for p in ranking if top > 0 and r["scores"][p]["score"] == top]
        if len(r["players"]) > 1:
            for p in winners:
                self.wins[p] = self.wins.get(p, 0) + 1
        icon = "🏆" if r["kind"] == "song" else "👂"
        self.history.append({
            "id": r["id"], "t": time.time(), "kind": r["kind"], "title": title,
            "rows": [{"name": self._name(p), "inst": self._inst_of(p), "score": r["scores"].get(p, {}).get("score", 0)} for p in ranking],
        })
        self.history = self.history[-HISTORY_MAX:]
        if winners:
            names = ", ".join(self._name(p) for p in winners)
            self._post_chat("system", f"{icon} {title}: {names} dẫn đầu với {top} điểm!")
        else:
            self._post_chat("system", f"{icon} {title} kết thúc — chưa ai ghi điểm.")
        self._set_timer(RESULT_TIME, self._close_round)

    def _close_round(self):
        self.round = None

    def _act_close(self, pid, data):
        r = self.round
        if not r:
            return
        self._require_host(pid)
        if r["phase"] != "result":
            self._post_chat("system", "⏹ Chủ phòng đã dừng lượt thi.")
        self._stop_timer()
        self.round = None

    # ------------------------------------------------------------------ đoán nốt
    def _act_start_ear(self, pid, data):
        self._require_host(pid)
        if self.round and self.round["phase"] != "result":
            raise GameError("Đang có lượt thi rồi.")
        level = "hard" if data.get("level") == "hard" else "easy"
        try:
            count = max(3, min(15, int(data.get("count", 8))))
        except (TypeError, ValueError):
            count = 8
        self.activity.clear()
        self._new_round("ear", level=level, count=count, q=0, answers={}, phase="question")
        self._post_chat("system", f"👂 Đoán nốt {count} câu ({'đủ 12 nốt' if level == 'hard' else '7 nốt tự nhiên'}) — lắng nghe nhé!")
        self._next_question()

    def _next_question(self):
        r = self.round
        if not r or r["kind"] != "ear":
            return
        if r["q"] >= r["count"]:
            self._to_result("Đoán nốt")
            return
        pool = list(range(12)) if r["level"] == "hard" else list(DIATONIC)
        if r.get("pc") in pool and len(pool) > 1:
            pool.remove(r["pc"])
        r["q"] += 1
        r["pc"] = random.choice(pool)
        r["octave"] = random.choice((4, 4, 5))
        r["phase"] = "question"
        r["answers"] = {}
        r["startAt"] = time.time() + EAR_LEAD
        r["askAt"] = r["startAt"] + EAR_GAP
        self._set_timer(EAR_LEAD + EAR_GAP + EAR_ANSWER, self._reveal)

    def _act_answer(self, pid, data):
        r = self.round
        if not r or r["kind"] != "ear" or r["phase"] != "question" or pid not in r["players"]:
            return
        if pid in r["answers"]:
            raise GameError("Bạn đã trả lời câu này rồi.")
        now = time.time()
        if now < r["askAt"]:
            raise GameError("Nghe hết nốt bí ẩn đã nhé!")
        try:
            pc = int(data.get("pc")) % 12
        except (TypeError, ValueError):
            raise GameError("Nốt không hợp lệ.")
        correct = pc == r["pc"]
        points = 0
        if correct:
            points = 100 + int(100 * max(0.0, 1 - (now - r["askAt"]) / EAR_ANSWER))
        r["answers"][pid] = {"pc": pc, "ok": correct, "pts": points}
        sc = r["scores"].setdefault(pid, {"score": 0, "right": 0})
        sc["score"] += points
        sc["right"] += 1 if correct else 0
        self._maybe_reveal()

    def _maybe_reveal(self):
        r = self.round
        if r and r["phase"] == "question" and all(p in r["answers"] for p in r["players"]):
            self._stop_timer()
            self._reveal()

    def _reveal(self):
        r = self.round
        if not r or r["kind"] != "ear" or r["phase"] != "question":
            return
        r["phase"] = "reveal"
        for p in r["players"]:
            r["scores"].setdefault(p, {"score": 0, "right": 0})
        self._set_timer(EAR_REVEAL, self._next_question)

    # ------------------------------------------------------------------ khác
    def _act_chat(self, pid, data):
        text = " ".join(str(data.get("text", "")).split())[:300]
        if text:
            self._post_chat("all", text, pid)

    # ------------------------------------------------------------------ trạng thái
    def _round_view(self, pid):
        r = self.round
        if not r:
            return None
        out = {k: v for k, v in r.items() if k not in ("answers", "pc", "octave", "live")}
        if r["kind"] == "ear":
            secret = r["phase"] != "question"
            out["answered"] = list(r["answers"].keys())
            out["mine"] = r["answers"].get(pid)
            if secret:
                out["pc"] = r["pc"]
                out["answers"] = r["answers"]
            # Trình duyệt cần cao độ để tự phát âm; giao diện chỉ hiện tên nốt khi đã lộ đáp án.
            out["tone"] = 12 * (r["octave"] + 1) + r["pc"]
        else:
            out["live"] = r.get("live", {})
        return out

    def view(self, pid):
        players = [{
            "id": p.id, "name": p.name, "bot": p.is_bot, "connected": p.connected, "look": p.look,
            "host": p.id == self.room.host_id, "inst": self._inst_of(p.id),
            "stars": sum(self.stars.get(p.id, {}).values()), "wins": self.wins.get(p.id, 0),
            "activity": self.activity.get(p.id),
        } for p in self.room.players.values()]
        return {
            "me": {"id": pid, "host": pid == self.room.host_id, "stars": self.stars.get(pid, {})},
            "players": players,
            "round": self._round_view(pid),
            "deadline": self.deadline,
            "total": self.phase_total,
            "now": time.time(),
            "history": self.history,
            "chat": self.chat[-150:],
        }
