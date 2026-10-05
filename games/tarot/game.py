"""Bói Tarot — cả phòng cùng xem một người rút bài, lật bài và đọc ý nghĩa.

Mỗi lượt một người ngồi “ghế xem bói”: chọn kiểu trải bài, đặt câu hỏi, xáo bài
rồi tự tay rút từ xấp 78 lá úp. Lá bài chỉ lộ mặt khi được lật, nên kể cả người
rút cũng không biết trước. Ai muốn xem thì bấm xếp hàng, xong lượt sẽ đến người kế.
Dữ liệu 78 lá (tên, ý nghĩa xuôi/ngược) nằm trong static/cards.json, dùng chung
cho cả máy chủ lẫn giao diện.
"""
import asyncio
import json
import logging
import os
import random
import time

from core.game_base import BaseGame, GameError

log = logging.getLogger("gamehub.tarot")

with open(os.path.join(os.path.dirname(__file__), "static", "cards.json"), encoding="utf-8") as _f:
    CARDS = json.load(_f)
DECK_SIZE = len(CARDS)

# slots: (tên vị trí, cột, hàng) trên lưới trải bài
SPREADS = {
    "one": {"name": "Thông điệp hôm nay", "icon": "✨", "hint": "1 lá — lời nhắn cho ngày hôm nay",
            "slots": [("Thông điệp", 1, 1)]},
    "time": {"name": "Quá khứ · Hiện tại · Tương lai", "icon": "⏳", "hint": "3 lá — dòng chảy của sự việc",
             "slots": [("Quá khứ", 1, 1), ("Hiện tại", 2, 1), ("Tương lai", 3, 1)]},
    "love": {"name": "Tình yêu", "icon": "💞", "hint": "3 lá — bạn, người ấy và mối quan hệ",
             "slots": [("Bạn", 1, 1), ("Người ấy", 3, 1), ("Mối quan hệ", 2, 1)]},
    "mind": {"name": "Tâm · Thân · Trí", "icon": "🧘", "hint": "3 lá — soi chiếu bản thân",
             "slots": [("Tâm trí", 1, 1), ("Cơ thể", 2, 1), ("Tinh thần", 3, 1)]},
    "choice": {"name": "Hai lựa chọn", "icon": "🔀", "hint": "5 lá — nên chọn con đường nào?",
               "slots": [("Hiện tại", 2, 1), ("Lựa chọn A", 1, 1), ("Lựa chọn B", 3, 1),
                         ("Kết quả A", 1, 2), ("Kết quả B", 3, 2)]},
    "cross": {"name": "Chữ thập", "icon": "✚", "hint": "5 lá — nhìn toàn cảnh vấn đề",
              "slots": [("Hiện tại", 2, 2), ("Nguyên nhân", 2, 1), ("Quá khứ", 1, 2),
                        ("Tương lai", 3, 2), ("Lời khuyên", 2, 3)]},
}

SHUFFLE_TIME = 2.6
OFFLINE_TIME = 20       # người đang xem bói rớt mạng quá lâu → nhường lượt
NEXT_TIME = 60          # xem xong mà có người đang xếp hàng → tự chuyển lượt
HISTORY_MAX = 30


class TarotGame(BaseGame):
    id = "tarot"
    name = "Bói Tarot"
    icon = "🔮"
    description = "Cùng nhau rút bài Tarot: đặt câu hỏi, tự tay rút từ 78 lá úp, lật bài và xem ý nghĩa. Mỗi người một lượt, cả phòng cùng xem."
    min_players = 1
    max_players = 12
    guide = [
        ("🔮 Lều xem bói", "Mỗi lượt một người ngồi “ghế xem bói”, cả phòng cùng xem bài được rút và lật. Ai muốn xem thì bấm **Xếp hàng**, xong lượt sẽ đến người kế tiếp."),
        ("✨ Các bước", [
            "**Đặt câu hỏi** (không bắt buộc) — càng cụ thể càng dễ luận.",
            "**Chọn cách trải bài**: 1 lá thông điệp, Quá khứ · Hiện tại · Tương lai, Tình yêu, Tâm · Thân · Trí, Hai lựa chọn hoặc Chữ thập 5 lá.",
            "**Xáo bài** rồi tự tay **rút** từng lá trong xấp 78 lá úp — chưa ai biết lá đó là gì, kể cả bạn.",
            "**Lật bài** từng lá (hoặc lật hết) để xem ý nghĩa theo vị trí và phần **Tổng quan**.",
        ]),
        ("📚 Bộ bài", "22 lá **Ẩn Chính** (những bài học lớn) và 56 lá **Ẩn Phụ** chia 4 chất: 🔥 Gậy (hành động), 🏆 Cốc (cảm xúc), ⚔️ Kiếm (lý trí), 💰 Tiền (vật chất). Tra ý nghĩa từng lá ở tab **Bộ bài**."),
        ("🔄 Lá ngược", "Lá rút ra bị lộn ngược mang nghĩa ngược lại hoặc năng lượng bị tắc nghẽn. Chủ phòng có thể tắt lá ngược."),
        ("⏱ Nhường lượt", [
            "Người đang xem mất kết nối quá 20 giây sẽ bị nhường lượt.",
            "Xem xong mà có người đang chờ thì sau 60 giây tự chuyển lượt. Chủ phòng có thể bỏ qua một lượt.",
            "Các lượt đã xem được lưu ở tab **Lịch sử**.",
        ]),
        ("💡 Lưu ý", "Tarot chỉ mang tính giải trí và gợi mở suy ngẫm — đừng dùng nó thay cho những quyết định quan trọng nhé!"),
    ]

    def __init__(self, room):
        super().__init__(room)
        self.config = {"reversed": True}
        self.queue = []
        self.reading = None
        self.history = []
        self.counts = {}
        self.chat = []
        self.events = []
        self._msg_id = 0
        self._seq = 0
        self._rid = 0
        self._token = 0
        self.deadline = None
        self.phase_total = None
        self.timer_kind = None

    # ------------------------------------------------------------------ tiện ích
    def _name(self, pid):
        p = self.room.players.get(pid)
        return p.name if p else "?"

    def _connected(self, pid):
        p = self.room.players.get(pid)
        return bool(p and p.connected)

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

    def _require_querent(self, pid, *stages):
        r = self.reading
        if r is None or r["querent"] != pid:
            raise GameError("Bạn không phải người đang xem bói.")
        if stages and r["stage"] not in stages:
            raise GameError("Chưa thể làm việc này lúc này.")
        return r

    @staticmethod
    def _card_label(cid, rev):
        return CARDS[cid]["name"] + (" (ngược)" if rev else "")

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
            self._token += 1
            self.deadline = self.phase_total = self.timer_kind = None
            try:
                fn()
                self._retime()
            except GameError:
                pass
            except Exception:
                log.exception("Lỗi hẹn giờ Tarot")
            await self.room.broadcast_state()

    def _stop_timer(self):
        self._token += 1
        self.deadline = self.phase_total = self.timer_kind = None

    def _retime(self):
        """Đặt lại hẹn giờ phù hợp với trạng thái hiện tại (giữ nguyên nếu cùng loại)."""
        r = self.reading
        if r is None:
            self._stop_timer()
            return
        if r["stage"] == "shuffle":
            return
        if not self._connected(r["querent"]):
            kind, secs, fn = "offline", OFFLINE_TIME, self._abandon
        elif r["stage"] == "done" and self.queue:
            kind, secs, fn = "next", NEXT_TIME, self._advance
        else:
            self._stop_timer()
            return
        if self.timer_kind != kind:
            self._set_timer(secs, fn, kind)

    def dispose(self):
        self._token += 1

    # ------------------------------------------------------------------ core hooks
    def status(self):
        if self.reading:
            return {"label": f"🔮 Đang xem cho {self._name(self.reading['querent'])}", "joinable": True}
        return {"label": "Đang chờ", "joinable": True}

    async def on_player_join(self, player):
        self._post_chat("system", f"👋 {player.name} bước vào lều xem bói.")

    async def on_player_connect(self, player):
        self._retime()

    async def on_player_disconnect(self, player):
        self._retime()

    async def on_player_removed(self, player):
        self._post_chat("system", f"🚪 {player.name} đã rời lều.")
        if player.id in self.queue:
            self.queue.remove(player.id)
        if self.reading and self.reading["querent"] == player.id:
            self._advance()
        self._retime()

    async def on_action(self, player, action, data):
        handler = getattr(self, "_act_" + action, None) if action.isidentifier() else None
        if handler is None:
            raise GameError("Hành động không hợp lệ.")
        handler(player.id, data)
        self._retime()

    # ------------------------------------------------------------------ hàng chờ
    def _act_queue(self, pid, data):
        r = self.reading
        if pid in self.queue:
            raise GameError("Bạn đã xếp hàng rồi.")
        if r and r["querent"] == pid and r["stage"] != "done":
            raise GameError("Bạn đang xem bói rồi.")
        self.queue.append(pid)
        if r is None or r["querent"] == pid:
            self._advance()
        else:
            self._post_chat("system", f"🙋 {self._name(pid)} xếp hàng xem bói (thứ {len(self.queue)}).")

    def _act_unqueue(self, pid, data):
        if pid not in self.queue:
            raise GameError("Bạn chưa xếp hàng.")
        self.queue.remove(pid)

    def _advance(self):
        """Kết thúc lượt hiện tại và mời người kế tiếp trong hàng."""
        self.reading = None
        while self.queue:
            pid = self.queue.pop(0)
            if pid in self.room.players:
                self._start_reading(pid)
                return

    def _start_reading(self, pid):
        self._rid += 1
        self.reading = {
            "id": self._rid, "querent": pid, "stage": "setup", "spread": None, "question": "",
            "deck": [], "picks": [], "flipped": [],
        }
        self._event("turn", pid)
        self._post_chat("system", f"🔮 Đến lượt {self._name(pid)} ngồi vào ghế xem bói.")

    def _abandon(self):
        r = self.reading
        if r is None:
            return
        if r["stage"] != "done":
            self._post_chat("system", f"💤 {self._name(r['querent'])} vắng mặt quá lâu — nhường lượt cho người sau.")
        self._advance()

    # ------------------------------------------------------------------ một lượt xem bói
    def _act_begin(self, pid, data):
        r = self._require_querent(pid, "setup")
        spread = str(data.get("spread", ""))
        if spread not in SPREADS:
            raise GameError("Hãy chọn một cách trải bài.")
        question = " ".join(str(data.get("question", "")).split())[:140]
        order = list(range(DECK_SIZE))
        random.shuffle(order)
        rev = self.config["reversed"]
        r.update({
            "stage": "shuffle", "spread": spread, "question": question,
            "deck": [(cid, rev and random.random() < 0.5) for cid in order],
            "picks": [], "flipped": [],
        })
        self._event("shuffle", pid)
        q = f" — “{question}”" if question else ""
        self._post_chat("system", f"🔀 {self._name(pid)} xáo bài cho trải bài {SPREADS[spread]['name']}{q}")
        self._set_timer(SHUFFLE_TIME, self._to_pick, "shuffle")

    def _to_pick(self):
        if self.reading and self.reading["stage"] == "shuffle":
            self.reading["stage"] = "pick"

    def _act_pick(self, pid, data):
        r = self._require_querent(pid, "pick")
        try:
            pos = int(data.get("pos"))
        except (TypeError, ValueError):
            raise GameError("Lá bài không hợp lệ.")
        if not 0 <= pos < DECK_SIZE or pos in r["picks"]:
            raise GameError("Lá này không rút được.")
        r["picks"].append(pos)
        r["flipped"].append(False)
        self._event("pick", pid, pos=pos, slot=len(r["picks"]) - 1)
        if len(r["picks"]) >= len(SPREADS[r["spread"]]["slots"]):
            r["stage"] = "reveal"

    def _act_flip(self, pid, data):
        r = self._require_querent(pid, "reveal")
        try:
            slot = int(data.get("slot"))
        except (TypeError, ValueError):
            raise GameError("Vị trí không hợp lệ.")
        if not 0 <= slot < len(r["flipped"]) or r["flipped"][slot]:
            return
        self._flip(r, slot)

    def _act_flip_all(self, pid, data):
        r = self._require_querent(pid, "reveal")
        for slot, done in enumerate(r["flipped"]):
            if not done:
                self._flip(r, slot)

    def _flip(self, r, slot):
        r["flipped"][slot] = True
        cid, rev = r["deck"][r["picks"][slot]]
        self._event("flip", r["querent"], slot=slot, card=cid, rev=rev)
        if all(r["flipped"]):
            self._finish_reading(r)

    def _finish_reading(self, r):
        r["stage"] = "done"
        cards = [list(r["deck"][pos]) for pos in r["picks"]]
        pid = r["querent"]
        self.counts[pid] = self.counts.get(pid, 0) + 1
        self.history.append({
            "id": r["id"], "t": time.time(), "pid": pid, "name": self._name(pid),
            "spread": r["spread"], "question": r["question"], "cards": cards,
        })
        if len(self.history) > HISTORY_MAX:
            self.history = self.history[-HISTORY_MAX:]
        self._event("done", pid)
        names = ", ".join(self._card_label(c, rv) for c, rv in cards)
        self._post_chat("system", f"🃏 Bài của {self._name(pid)}: {names}.")

    def _act_finish(self, pid, data):
        r = self.reading
        if r is None:
            raise GameError("Không có ai đang xem bói.")
        if r["querent"] != pid:
            self._require_host(pid)
            if r["stage"] != "done":
                self._post_chat("system", f"⏭ Chủ phòng đã bỏ qua lượt của {self._name(r['querent'])}.")
        self._advance()

    # ------------------------------------------------------------------ khác
    def _act_config(self, pid, data):
        self._require_host(pid)
        if "reversed" in data:
            self.config["reversed"] = bool(data.get("reversed"))

    def _act_chat(self, pid, data):
        text = " ".join(str(data.get("text", "")).split())[:300]
        if text:
            self._post_chat("all", text, pid)

    # ------------------------------------------------------------------ trạng thái
    def view(self, pid):
        r = self.reading
        reading = None
        if r:
            slots = []
            for i, pos in enumerate(r["picks"]):
                cid, rev = r["deck"][pos]
                shown = r["flipped"][i]
                slots.append({"pos": pos, "card": cid if shown else None, "rev": rev if shown else None})
            reading = {
                "id": r["id"], "querent": r["querent"], "stage": r["stage"],
                "spread": r["spread"], "question": r["question"], "slots": slots,
            }
        players = [{
            "id": p.id, "name": p.name, "bot": p.is_bot, "connected": p.connected, "look": p.look,
            "host": p.id == self.room.host_id, "count": self.counts.get(p.id, 0),
            "queue": self.queue.index(p.id) + 1 if p.id in self.queue else 0,
        } for p in self.room.players.values()]
        return {
            "me": {"id": pid, "host": pid == self.room.host_id},
            "players": players,
            "reading": reading,
            "queue": self.queue,
            "spreads": {k: {**v, "slots": [list(s) for s in v["slots"]]} for k, v in SPREADS.items()},
            "deckSize": DECK_SIZE,
            "config": self.config,
            "deadline": self.deadline,
            "total": self.phase_total,
            "timerKind": self.timer_kind,
            "now": time.time(),
            "history": self.history[-HISTORY_MAX:],
            "events": self.events[-12:],
            "chat": self.chat[-150:],
        }
