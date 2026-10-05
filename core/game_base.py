"""Giao diện chung mà mọi game phải tuân theo.

Mỗi game là một package trong thư mục `games/`, export biến `GAME` là một lớp
kế thừa `BaseGame`, và có thư mục `static/` chứa giao diện (index.html, ...).
Nền tảng (core) chỉ lo phòng chơi, kết nối và gửi trạng thái; toàn bộ luật chơi
nằm trong game.
"""


class GameError(Exception):
    """Lỗi hiển thị cho người chơi (ví dụ: hành động không hợp lệ)."""


class BaseGame:
    id = "base"
    name = "Base game"
    description = ""
    icon = "🎲"
    min_players = 1
    max_players = 16
    static_dir = None  # được gán tự động khi nạp game
    supports_bots = False  # True nếu game có AI điều khiển người chơi ảo
    # Hướng dẫn chơi hiện ở sảnh và nút ❓ trong phòng: danh sách (tiêu đề, nội dung),
    # nội dung là một đoạn văn hoặc list các gạch đầu dòng; **chữ đậm** được hỗ trợ.
    guide = []

    def __init__(self, room):
        self.room = room

    @classmethod
    def meta(cls):
        return {
            "id": cls.id,
            "name": cls.name,
            "description": cls.description,
            "icon": cls.icon,
            "minPlayers": cls.min_players,
            "maxPlayers": cls.max_players,
            "bots": cls.supports_bots,
            "guide": [{"title": t, "body": b} for t, b in cls.guide],
        }

    max_spectators = 20  # số người xem tối đa được vào thêm khi ván đang diễn ra

    # --- Quy tắc vào / rời phòng -------------------------------------------
    def can_join(self):
        """(ok, lý do) — người chơi MỚI có được vào phòng lúc này không. Mặc định luôn cho vào:
        nếu ván đang diễn ra, người mới chỉ xem (game không cho họ hành động, không gửi bí mật của người khác)."""
        return True, ""

    def room_limit(self):
        """Số người tối đa trong phòng lúc này: khi ván đang diễn ra (status không “joinable”) thì
        nhận thêm người xem ngoài số người chơi tối đa."""
        if self.status().get("joinable", True):
            return self.max_players
        return self.max_players + self.max_spectators

    def participants(self):
        """Những người được vào chơi khi bắt đầu ván: theo thứ tự vào phòng, tối đa max_players
        (người vào xem lúc trước có thể làm phòng đông hơn số người chơi)."""
        return list(self.room.players.keys())[:self.max_players]

    def can_remove(self, pid):
        """Người chơi có thể bị xoá khỏi phòng (rời / bị kick) lúc này không."""
        return True

    def can_rename(self):
        return True

    def status(self):
        return {"label": "Đang chờ", "joinable": True}

    # --- Sự kiện -------------------------------------------------------------
    async def on_player_join(self, player):
        pass

    async def on_player_connect(self, player):
        pass

    async def on_player_disconnect(self, player):
        pass

    async def on_player_removed(self, player):
        pass

    async def on_action(self, player, action, data):
        raise GameError("Hành động không hợp lệ.")

    # --- Trạng thái gửi cho từng người chơi ----------------------------------
    def view(self, pid):
        return {}

    def can_voice(self, speaker, listener):
        """Người `speaker` có được nói (voice chat) tới `listener` lúc này không."""
        return True

    def allow_fx(self, pid, target):
        """(ok, lý do) — người chơi có được tương tác/biểu cảm lúc này không."""
        return True, ""

    def on_fx(self, from_pid, to_pid, kind):
        """Gọi sau khi một hiệu ứng tương tác được phát đi."""

    def on_state_broadcast(self):
        """Gọi (đồng bộ) sau mỗi lần gửi trạng thái — nơi tiện để lên lịch cho bot."""

    def dispose(self):
        pass
