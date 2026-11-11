"""AI cho người chơi ảo (bot) trong Đua Xe Gõ Phím: mỗi chặng bot “gõ” với tốc độ quanh mức WPM của độ khó,
thỉnh thoảng khựng lại một chút như gõ nhầm rồi sửa."""
import random

# WPM trung bình theo độ khó, xác suất khựng mỗi giây.
LEVELS = {
    "easy": {"wpm": 25, "stumble": 0.35},
    "normal": {"wpm": 42, "stumble": 0.3},
    "hard": {"wpm": 65, "stumble": 0.22},
    "pro": {"wpm": 95, "stumble": 0.15},
}
CHEER = ["Về nhất rồi nhé 😎", "Tay nhanh hơn não 🤭", "Vroom vroom 🏎️", "Dễ ợt 💨"]
SAD = ["Bàn phím kẹt phím 😭", "Lần sau sẽ khác 😤", "Ơ xe hết xăng à 🥲"]


class DuaXeBotMixin:
    supports_bots = True

    def _bots_reset(self):
        self._bot = {}

    def _bots_init_race(self):
        lv = LEVELS[self.config["bot_level"]]
        self._bot = {}
        for pid in self.order:
            p = self.room.players.get(pid)
            if p and p.is_bot:
                # Bù thời gian khựng (trung bình ~0,72 giây mỗi lần) để WPM thực tế sát mức của độ khó.
                cps = lv["wpm"] * 5 / 60 / (1 - lv["stumble"] * 0.72) * random.uniform(0.85, 1.15)
                self._bot[pid] = {"cps": cps, "pos": 0.0, "pause": 0.0, "typos": 0}

    def _bots_step(self, dt, now):
        """Cho bot gõ thêm một đoạn. Trả về True nếu có bot vừa về đích."""
        lv = LEVELS[self.config["bot_level"]]
        finished = False
        n = len(self.text)
        for pid, b in self._bot.items():
            if pid in self.fin or pid not in self.room.players:
                continue
            if b["pause"] > now:
                continue
            self.err.discard(pid)
            if random.random() < lv["stumble"] * dt:
                b["pause"] = now + random.uniform(0.35, 1.1)
                if random.random() < 0.4:
                    # Gõ nhầm: khựng lại sửa (xe bốc khói), đứt chuỗi nitro. Còn lại chỉ là ngập ngừng.
                    b["typos"] += 1
                    self.typos[pid] = b["typos"]
                    self.streak[pid] = 0
                    self.err.add(pid)
                continue
            if self.charge.get(pid) and random.random() < 1.5 * dt:
                self._use_nitro(pid, now)
            b["pos"] = min(n, b["pos"] + b["cps"] * dt * random.uniform(0.6, 1.4))
            pos = int(b["pos"])
            if pos != self.typed.get(pid) and self._advance(pid, pos, pos, now):
                self._finish_player(pid)
                finished = True
                if random.random() < 0.3:
                    place = self.fin[pid]["place"]
                    self._post_chat("all", random.choice(CHEER if place == 1 else SAD), pid)
        return finished
