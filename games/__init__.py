"""Tự động nạp mọi game trong thư mục này.

Để thêm game mới: tạo `games/<ten_game>/__init__.py` export `GAME` (lớp kế thừa
core.game_base.BaseGame) và thư mục `games/<ten_game>/static/index.html`.
"""
import importlib
import logging
import os
import pkgutil

log = logging.getLogger("gamehub")


def discover_games():
    games = []
    for info in pkgutil.iter_modules(__path__):
        if not info.ispkg:
            continue
        try:
            module = importlib.import_module(f"{__name__}.{info.name}")
        except Exception:
            log.exception("Không nạp được game %s", info.name)
            continue
        cls = getattr(module, "GAME", None)
        if cls is None:
            continue
        cls.static_dir = os.path.join(os.path.dirname(module.__file__), "static")
        games.append(cls)
    return games
