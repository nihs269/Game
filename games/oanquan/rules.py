"""Luật rải / ăn của Ô Ăn Quan, viết thành hàm thuần để máy chủ, bot và bài thử cùng dùng.

Bàn cho n người (2–4) là một vòng 6n ô: mỗi người giữ một cạnh gồm ô quan ở đầu cạnh và 5 ô dân.
Ghế s có ô quan 6s và hàng dân 6s+1 .. 6s+5 (2 người: ô 0 và 6 là quan, 1..5 và 7..11 là dân).
Đi “chiều +1” là tăng chỉ số ô (vòng lại sau ô cuối). `dan[i]` là số quân dân trong ô i,
`quan[i]` là 1 nếu ô quan i còn quân quan.
"""
SIDE = 6                # mỗi cạnh: 1 ô quan + 5 ô dân
QUAN_NON = 5            # luật quan non: ô quan còn ít hơn chừng này dân thì chưa được ăn
MAX_PICKS = 80          # chặn vòng rải vô tận (rất hiếm)


def is_quan(i):
    return i % SIDE == 0


def row(seat):
    return tuple(range(SIDE * seat + 1, SIDE * seat + SIDE))


def quan_cells(n):
    return tuple(SIDE * s for s in range(n))


def new_board(n=2, per_cell=5):
    dan = ([0] + [per_cell] * (SIDE - 1)) * n
    quan = ([1] + [0] * (SIDE - 1)) * n
    return dan, quan


def filled(dan, quan, i):
    return dan[i] > 0 or quan[i] > 0


def legal_moves(dan, seat):
    return [(c, d) for c in row(seat) if dan[c] > 0 for d in (1, -1)]


def sow(dan, quan, start, d, quan_non=False):
    """Bốc ô `start` rải theo chiều `d`. Trả về (dan mới, quan mới, dân ăn được, quan ăn được, các bước).

    Các bước (để giao diện diễn lại): ["pick", ô, số quân bốc], ["drop", ô], ["eat", ô, dân, quan], ["stop", ô].
    Rải xong quân cuối:
      • ô kế tiếp là ô dân có quân → bốc lên rải tiếp;
      • ô kế tiếp là ô quan còn quân → mất lượt (không được bốc ô quan);
      • ô kế tiếp trống → ăn ô sau nó (nếu có quân); sau đó cứ cách một ô trống lại có ô có quân thì ăn tiếp;
      • gặp hai ô trống liền → hết lượt.
    """
    dan, quan = list(dan), list(quan)
    cells = len(dan)
    steps = []
    got_dan = got_quan = 0
    i = start
    hand = dan[i]
    dan[i] = 0
    steps.append(["pick", i, hand])
    picks = 1
    while True:
        while hand:
            i = (i + d) % cells
            dan[i] += 1
            hand -= 1
            steps.append(["drop", i])
        nxt = (i + d) % cells
        if filled(dan, quan, nxt):
            if is_quan(nxt) or picks >= MAX_PICKS:
                steps.append(["stop", nxt])
                break
            hand = dan[nxt]
            dan[nxt] = 0
            i = nxt
            picks += 1
            steps.append(["pick", nxt, hand])
            continue
        # Ô kế tiếp trống: ăn ô sau nó, rồi ăn dây chuyền.
        while True:
            tgt = (nxt + d) % cells
            if not filled(dan, quan, tgt):
                steps.append(["stop", tgt])
                break
            if quan_non and quan[tgt] and dan[tgt] < QUAN_NON:
                steps.append(["stop", tgt])
                break
            steps.append(["eat", tgt, dan[tgt], quan[tgt]])
            got_dan += dan[tgt]
            got_quan += quan[tgt]
            dan[tgt] = quan[tgt] = 0
            nxt = (tgt + d) % cells
            if filled(dan, quan, nxt):
                break
        break
    return dan, quan, got_dan, got_quan, steps


def finished(dan, quan):
    """Hết quan, tàn dân: mọi ô quan đều trống."""
    return all(not filled(dan, quan, q) for q in range(0, len(dan), SIDE))
