"""Bộ bài và tính điểm tay bài Poker (Texas Hold'em).

Lá bài là chuỗi 2 ký tự: hạng (23456789TJQKA) + chất (s ♠, h ♥, d ♦, c ♣), VD "As", "Td".
`score(cards)` nhận 2–7 lá, trả về tuple so sánh được: (loại bài, các hạng để phân định...).
"""
import random
from collections import Counter
from itertools import combinations

RANKS = "23456789TJQKA"
SUITS = "shdc"
RANK_VI = {11: "J", 12: "Q", 13: "K", 14: "A"}
CATEGORY = ["Mậu thầu", "Đôi", "Thú", "Sám cô", "Sảnh", "Thùng", "Cù lũ", "Tứ quý", "Thùng phá sảnh"]


def new_deck():
    deck = [r + s for r in RANKS for s in SUITS]
    random.shuffle(deck)
    return deck


def rank_of(card):
    return RANKS.index(card[0]) + 2


def rank_label(r):
    return RANK_VI.get(r, str(r))


def _straight_high(rset):
    for hi in range(14, 5, -1):
        if all(hi - i in rset for i in range(5)):
            return hi
    if {14, 2, 3, 4, 5} <= rset:
        return 5
    return 0


def score(cards):
    rs = [rank_of(c) for c in cards]
    by_suit = {}
    for c, r in zip(cards, rs):
        by_suit.setdefault(c[1], []).append(r)
    flush = next((sorted(v, reverse=True) for v in by_suit.values() if len(v) >= 5), None)
    if flush:
        sf = _straight_high(set(flush))
        if sf:
            return (8, sf)
    cnt = Counter(rs)
    desc = sorted(rs, reverse=True)
    quads = [r for r, n in cnt.items() if n == 4]
    if quads:
        q = quads[0]
        return (7, q, *[r for r in desc if r != q][:1])
    trips = sorted((r for r, n in cnt.items() if n == 3), reverse=True)
    pairs = sorted((r for r, n in cnt.items() if n == 2), reverse=True)
    if trips and (len(trips) > 1 or pairs):
        return (6, trips[0], max(trips[1:] + pairs))
    if flush:
        return (5, *flush[:5])
    st = _straight_high(set(rs))
    if st:
        return (4, st)
    if trips:
        t = trips[0]
        return (3, t, *[r for r in desc if r != t][:2])
    if len(pairs) >= 2:
        a, b = pairs[:2]
        return (2, a, b, *[r for r in desc if r not in (a, b)][:1])
    if pairs:
        a = pairs[0]
        return (1, a, *[r for r in desc if r != a][:3])
    return (0, *desc[:5])


def hand_name(sc):
    cat = sc[0]
    r = rank_label(sc[1])
    if cat == 8:
        return "Thùng phá sảnh lớn 👑" if sc[1] == 14 else f"Thùng phá sảnh tới {r}"
    if cat == 7:
        return f"Tứ quý {r}"
    if cat == 6:
        return f"Cù lũ {r} – {rank_label(sc[2])}"
    if cat == 5:
        return f"Thùng ({r} cao)"
    if cat == 4:
        return f"Sảnh tới {r}"
    if cat == 3:
        return f"Sám cô {r}"
    if cat == 2:
        return f"Thú {r} và {rank_label(sc[2])}"
    if cat == 1:
        return f"Đôi {r}"
    return f"Mậu thầu {r}"


def best_five(cards):
    """5 lá tạo nên tay bài mạnh nhất (để làm nổi bật khi lật bài)."""
    if len(cards) <= 5:
        return list(cards)
    best = max(combinations(cards, 5), key=score)
    return list(best)


def equity(hole, board, opponents, sims=150):
    """Ước lượng xác suất thắng (Monte Carlo) trước `opponents` tay bài ngẫu nhiên."""
    opponents = max(1, min(opponents, 4))
    known = set(hole) | set(board)
    rest = [r + s for r in RANKS for s in SUITS if r + s not in known]
    need = 5 - len(board)
    win = 0.0
    for _ in range(sims):
        draw = random.sample(rest, need + 2 * opponents)
        full = board + draw[:need]
        mine = score(hole + full)
        best_opp = max(score(draw[need + 2 * i:need + 2 * i + 2] + full) for i in range(opponents))
        if mine > best_opp:
            win += 1
        elif mine == best_opp:
            win += 0.5
    return win / sims
