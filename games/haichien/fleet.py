"""Hình dạng tàu, các hạm đội theo chế độ chơi, phép xoay và cách xếp tàu cho Hải Chiến.

Mỗi tàu là một “khối” gồm các ô (dx, dy) ở hướng gốc; vị trí đặt {x, y, rot} với rot = 0..3 (xoay 90° theo chiều
kim đồng hồ). Tàu thẳng (kind "line") chỉ có 2 hướng thực sự khác nhau (ngang / dọc).
"""
import random

# kiểu tàu → (tên, các ô ở hướng gốc, kiểu vẽ)
SHAPES = {
    "I5": ("Tàu sân bay", [(0, 0), (1, 0), (2, 0), (3, 0), (4, 0)], "line"),
    "I4": ("Thiết giáp hạm", [(0, 0), (1, 0), (2, 0), (3, 0)], "line"),
    "I3": ("Tuần dương hạm", [(0, 0), (1, 0), (2, 0)], "line"),
    "S3": ("Tàu ngầm", [(0, 0), (1, 0), (2, 0)], "line"),
    "I2": ("Khu trục hạm", [(0, 0), (1, 0)], "line"),
    "O4": ("Pháo đài nổi", [(0, 0), (1, 0), (0, 1), (1, 1)], "shape"),
    "L4": ("Tàu đổ bộ chữ L", [(0, 0), (1, 0), (2, 0), (2, 1)], "shape"),
    "T4": ("Tàu chỉ huy chữ T", [(0, 0), (1, 0), (2, 0), (1, 1)], "shape"),
    "Z4": ("Tàu tiếp vận chữ Z", [(0, 0), (1, 0), (1, 1), (2, 1)], "shape"),
    "L3": ("Xuồng góc chữ V", [(0, 0), (1, 0), (1, 1)], "shape"),
    "P5": ("Căn cứ nổi", [(0, 0), (1, 0), (0, 1), (1, 1), (0, 2)], "shape"),
}

SIZES = (8, 10, 12, 14)
CLASSIC = ["I5", "I4", "I3", "S3", "I2"]
LINE_FLEETS = {
    8: ["I4", "I3", "S3", "I2"],
    10: CLASSIC,
    12: ["I5", "I4", "I4", "I3", "S3", "I2", "I2"],
    14: ["I5", "I5", "I4", "I4", "I3", "S3", "S3", "I2", "I2"],
}
SHAPE_FLEETS = {
    8: ["O4", "L4", "L3", "I2"],
    10: ["I5", "O4", "L4", "T4", "S3", "I2"],
    12: ["I5", "P5", "O4", "L4", "T4", "Z4", "L3", "I2"],
    14: ["I5", "P5", "O4", "L4", "T4", "Z4", "I4", "L3", "S3", "I2"],
}


def build_fleet(mode, size, style):
    """(cỡ bản đồ, danh sách tàu [{id, type, name, cells, kind, size}])."""
    if mode != "custom":
        size, types = 10, CLASSIC
    else:
        size = size if size in SIZES else 10
        types = (SHAPE_FLEETS if style == "shape" else LINE_FLEETS)[size]
    fleet = []
    for i, t in enumerate(types):
        name, cells, kind = SHAPES[t]
        dup = types[:i].count(t)
        fleet.append({"id": f"s{i}", "type": t, "name": name + (f" {dup + 1}" if types.count(t) > 1 else ""),
                      "cells": cells, "kind": kind, "size": len(cells)})
    return size, fleet


def rotate(cells, rot):
    """Xoay các ô rot × 90° rồi dời về góc (0, 0)."""
    out = list(cells)
    for _ in range(rot % 4):
        out = [(-y, x) for x, y in out]
    mx = min(x for x, _ in out)
    my = min(y for _, y in out)
    return sorted((x - mx, y - my) for x, y in out)


def rotations(ship):
    """Các hướng khác nhau thực sự của một tàu (tàu thẳng: 2, ô vuông: 1…)."""
    seen, out = set(), []
    for r in range(4):
        key = tuple(rotate(ship["cells"], r))
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out


def cells_at(ship, p):
    return [(p["x"] + dx, p["y"] + dy) for dx, dy in rotate(ship["cells"], p.get("rot", 0))]


def validate(fleet, place, n, no_touch):
    """Thông báo lỗi nếu cách xếp không hợp lệ, hoặc None."""
    by_id = {s["id"]: s for s in fleet}
    if set(place) != set(by_id):
        return f"Hãy xếp đủ {len(fleet)} tàu."
    taken = {}
    for sid, p in place.items():
        s = by_id[sid]
        for x, y in cells_at(s, p):
            if not (0 <= x < n and 0 <= y < n):
                return f"{s['name']} nằm ra ngoài vùng biển."
            if (x, y) in taken:
                return f"{s['name']} chồng lên {by_id[taken[(x, y)]]['name']}."
            taken[(x, y)] = sid
    if no_touch:
        for (x, y), sid in taken.items():
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    other = taken.get((x + dx, y + dy))
                    if other and other != sid:
                        return f"{by_id[sid]['name']} đang sát {by_id[other]['name']} (luật không đặt sát nhau)."
    return None


def random_place(fleet, n, no_touch):
    order = sorted(fleet, key=lambda s: -s["size"])
    for _ in range(3000):
        place, blocked, ok = {}, set(), True
        for s in order:
            rots = rotations(s)
            for _ in range(300):
                r = random.choice(rots)
                shape = rotate(s["cells"], r)
                w = max(x for x, _ in shape) + 1
                h = max(y for _, y in shape) + 1
                p = {"x": random.randrange(n - w + 1), "y": random.randrange(n - h + 1), "rot": r}
                cs = cells_at(s, p)
                if any(c in blocked for c in cs):
                    continue
                place[s["id"]] = p
                for cx, cy in cs:
                    if no_touch:
                        blocked |= {(cx + dx, cy + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)}
                    else:
                        blocked.add((cx, cy))
                break
            else:
                ok = False
                break
        if ok and not validate(fleet, place, n, no_touch):
            return place
    raise RuntimeError("không xếp được hạm đội")
