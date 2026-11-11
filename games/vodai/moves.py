"""Võ Đài Sinh Tử — hằng số dùng chung: máy chủ dùng để mô phỏng bot / kiểm tra đòn, trình duyệt nhận qua `view` (world, moves).

Toạ độ: sàn đấu rộng W đơn vị, x tính từ trái; y là độ cao so với mặt sàn (0 = đứng trên sàn, càng lớn càng cao).
Thời gian tính bằng giây, vận tốc đơn vị/giây.
"""

WORLD = {
    "W": 1000, "H_VIEW": 562, "FLOOR": 478,      # khung hình logic 1000×562, mặt sàn ở y màn hình = FLOOR
    "LEFT": 50, "RIGHT": 950,                     # biên trái / phải của sàn
    "WALK": 250, "BACK": 190,                     # tốc độ đi tới / lùi
    "JUMP": 900, "JUMP_VX": 240, "G": 2600,       # nhảy: vận tốc lên, vận tốc ngang, trọng lực
    "HALF": 26, "H": 124, "H_CROUCH": 96, "H_DOWN": 30,   # nửa bề ngang thân, chiều cao đứng / ngồi / nằm
    "PUSH": 54,                                   # hai võ sĩ không đứng gần nhau hơn khoảng này
    "MAXSEP": 640,                                # …và không xa nhau hơn khoảng này (camera luôn thấy cả hai)
    "FRICTION": 10,                               # giảm tốc khi bị đẩy lùi trên sàn
    "HP": 100, "START": [330, 670],
    "INTRO": 2.3, "VS": 2.6,                      # "ROUND n … FIGHT!"; màn VS trước hiệp 1
    "BLOCKSTUN": 0.18, "FALL_UP": 460,            # choáng khi đỡ đòn; vận tốc bật lên khi bị hạ
    "DOWN": 0.7, "RISE": 0.35,                    # nằm sàn / đứng dậy (bất tử)
    "CHIP": 0.2,                                  # chưởng bị đỡ vẫn mất 20% sát thương
}

# Đòn đánh. st/ac/rc = thời gian ra đòn / có hiệu lực / thu đòn. Vùng trúng: từ tâm người đánh tới `reach` về phía trước,
# cao từ y0 tới y1 (tính từ chân). kb = lực đẩy lùi, up = hất lên, stun = thời gian choáng, down = ngã sàn.
MOVES = {
    "jab":   {"name": "Đấm", "icon": "👊", "st": 0.07, "ac": 0.08, "rc": 0.14, "dmg": 5, "reach": 80, "y0": 66, "y1": 112,
              "kb": 170, "up": 0, "stun": 0.28, "down": False},
    "kick":  {"name": "Đá cao", "icon": "🦶", "st": 0.13, "ac": 0.10, "rc": 0.22, "dmg": 8, "reach": 102, "y0": 70, "y1": 128,
              "kb": 280, "up": 0, "stun": 0.38, "down": False},
    "round": {"name": "Roundhouse", "icon": "🌪️", "st": 0.17, "ac": 0.12, "rc": 0.32, "dmg": 12, "reach": 106, "y0": 62, "y1": 130,
              "kb": 340, "up": 320, "stun": 0.8, "down": True},
    "throw": {"name": "Quật", "icon": "🤼", "throw": True, "st": 0.08, "ac": 0.07, "rc": 0.55, "dmg": 12, "reach": 66, "y0": 20,
              "y1": 120, "kb": 320, "up": 560, "stun": 0.9, "down": True},
    "upper": {"name": "Móc hàm", "icon": "💥", "st": 0.15, "ac": 0.10, "rc": 0.38, "dmg": 12, "reach": 74, "y0": 46, "y1": 160,
              "kb": 240, "up": 880, "stun": 0.9, "down": True},
    "sweep": {"name": "Quét chân", "icon": "🌀", "st": 0.12, "ac": 0.12, "rc": 0.32, "dmg": 7, "reach": 108, "y0": 0, "y1": 32,
              "kb": 120, "up": 260, "stun": 0.9, "down": True},
    "apunch": {"name": "Đấm trên không", "icon": "👊", "air": True, "st": 0.05, "ac": 0.16, "rc": 0.08, "dmg": 6, "reach": 72,
               "y0": 40, "y1": 100, "kb": 190, "up": 0, "stun": 0.3, "down": False},
    "akick": {"name": "Đá bay", "icon": "🦵", "air": True, "st": 0.06, "ac": 0.36, "rc": 0.05, "dmg": 9, "reach": 88,
              "y0": -10, "y1": 60, "kb": 270, "up": 0, "stun": 0.4, "down": False},
    # Tuyệt chiêu. dash = lao tới với tốc độ này trong lúc đòn có hiệu lực (hop = bật lên khi bắt đầu);
    # proj = chưởng (máy chủ mô phỏng); freeze = đóng băng (choáng lâu, không văng); teleport = dịch chuyển ra sau lưng đối thủ.
    "fkick": {"name": "Phi cước", "icon": "💨", "special": True, "dash": 700, "hop": 330, "st": 0.10, "ac": 0.32, "rc": 0.26,
              "dmg": 11, "reach": 84, "y0": 40, "y1": 104, "kb": 360, "up": 320, "stun": 0.8, "down": True, "cd": 1.8},
    "bicycle": {"name": "Đá xe đạp", "icon": "🚲", "special": True, "dash": 480, "hop": 120, "st": 0.12, "ac": 0.45, "rc": 0.3,
                "dmg": 13, "reach": 82, "y0": 40, "y1": 112, "kb": 300, "up": 300, "stun": 0.8, "down": True, "cd": 2.2},
    "slide": {"name": "Trượt chân", "icon": "🛷", "special": True, "dash": 820, "hop": 0, "st": 0.08, "ac": 0.30, "rc": 0.28,
              "dmg": 9, "reach": 92, "y0": 0, "y1": 40, "kb": 160, "up": 300, "stun": 0.9, "down": True, "cd": 1.8},
    "shoulder": {"name": "Húc vai", "icon": "💢", "special": True, "dash": 650, "hop": 0, "st": 0.10, "ac": 0.30, "rc": 0.30,
                 "dmg": 10, "reach": 72, "y0": 60, "y1": 118, "kb": 380, "up": 0, "stun": 0.55, "down": False, "cd": 1.8},
    "teleport": {"name": "Dịch chuyển", "icon": "🌀", "special": True, "teleport": True, "st": 0.18, "ac": 0.0, "rc": 0.22,
                 "dmg": 0, "reach": 0, "y0": 0, "y1": 0, "kb": 0, "up": 0, "stun": 0, "down": False, "cd": 2.4},
    "iceball": {"name": "Cầu băng", "icon": "❄️", "special": True, "proj": True, "freeze": True, "st": 0.22, "ac": 0.0, "rc": 0.32,
                "dmg": 4, "kb": 0, "up": 0, "stun": 1.6, "down": False, "cd": 3.5,
                "spd": 480, "py": 118, "r": 14, "ttl": 2.2},
    "fireball": {"name": "Cầu lửa", "icon": "🔥", "special": True, "proj": True, "st": 0.20, "ac": 0.0, "rc": 0.30, "dmg": 10,
                 "kb": 240, "up": 0, "stun": 0.5, "down": False, "cd": 1.6,
                 "spd": 560, "py": 118, "r": 14, "ttl": 2.0},
    "spear": {"name": "Móc câu", "icon": "🪝", "special": True, "proj": True, "st": 0.16, "ac": 0.0, "rc": 0.50, "dmg": 6,
              "kb": 0, "up": 0, "stun": 1.25, "down": False, "cd": 3.0, "pull": 82,
              "spd": 1150, "py": 112, "r": 9, "ttl": 0.5},
}

FATALITIES = ("uppercut", "lightning", "inferno")

# Dàn võ sĩ Mortal Kombat 4. moves = tuyệt chiêu ở 3 ô [↓→J / U, ←→J / I, →→K / O]; sp = (biểu tượng, tên) hiển thị;
# fx = kiểu hình chưởng / dây móc ở trình duyệt. Ngoại hình vẽ ở static/app.js (CHAR_LOOKS).
CHARS = [
    {"id": "scorpion", "name": "Scorpion", "moves": ["fireball", "spear", "teleport"], "fx": ["hellfire", "kunai"],
     "sp": [["🔥", "Lửa địa ngục"], ["🪝", "Móc câu"], ["🌀", "Dịch chuyển"]]},
    {"id": "subzero", "name": "Sub-Zero", "moves": ["iceball", "fireball", "slide"], "fx": ["ice", "ice"],
     "sp": [["❄️", "Cầu băng"], ["🧊", "Mảnh băng"], ["🛷", "Trượt chân"]]},
    {"id": "raiden", "name": "Raiden", "moves": ["fireball", "teleport", "fkick"], "fx": ["bolt", ""],
     "sp": [["⚡", "Tia sét"], ["🌀", "Dịch chuyển"], ["🚀", "Phi thân"]]},
    {"id": "liukang", "name": "Liu Kang", "moves": ["fireball", "bicycle", "fkick"], "fx": ["dragon", ""],
     "sp": [["🐉", "Hỏa long"], ["🚲", "Đá xe đạp"], ["💨", "Phi cước"]]},
    {"id": "reptile", "name": "Reptile", "moves": ["fireball", "spear", "slide"], "fx": ["acid", "tongue"],
     "sp": [["🟢", "Phun axit"], ["👅", "Lưỡi dài"], ["🛷", "Trượt chân"]]},
    {"id": "sonya", "name": "Sonya Blade", "her": True, "moves": ["fireball", "shoulder", "bicycle"], "fx": ["ring", ""],
     "sp": [["💗", "Vòng năng lượng"], ["👊", "Đấm sóng vuông"], ["🚲", "Đá xe đạp"]]},
    {"id": "jax", "name": "Jax", "moves": ["fireball", "shoulder", "fkick"], "fx": ["missile", ""],
     "sp": [["🚀", "Tên lửa"], ["💢", "Đấm lao"], ["💨", "Phi cước"]]},
    {"id": "johnny", "name": "Johnny Cage", "moves": ["fireball", "fkick", "shoulder"], "fx": ["green", ""],
     "sp": [["🟩", "Cầu xanh"], ["👟", "Đá bóng ma"], ["🥊", "Đấm bóng ma"]]},
    {"id": "kai", "name": "Kai", "moves": ["fireball", "bicycle", "fkick"], "fx": ["sky", ""],
     "sp": [["🔵", "Cầu lửa trời"], ["🔄", "Xoay ngược"], ["💨", "Phi cước"]]},
    {"id": "tanya", "name": "Tanya", "her": True, "moves": ["fireball", "bicycle", "fkick"], "fx": ["pinkfire", ""],
     "sp": [["🔥", "Cầu lửa"], ["🌀", "Đá khoan"], ["💨", "Phi cước"]]},
    {"id": "jarek", "name": "Jarek", "moves": ["fireball", "shoulder", "slide"], "fx": ["blade", ""],
     "sp": [["✴️", "Phi đao ba lưỡi"], ["💣", "Lăn cầu"], ["🛷", "Trượt chân"]]},
    {"id": "reiko", "name": "Reiko", "moves": ["fireball", "teleport", "fkick"], "fx": ["star", ""],
     "sp": [["✳️", "Phi tiêu"], ["🌀", "Dịch chuyển"], ["💨", "Phi cước"]]},
    {"id": "fujin", "name": "Fujin", "moves": ["fireball", "spear", "fkick"], "fx": ["wind", "wind"],
     "sp": [["🌪️", "Lốc xoáy"], ["💨", "Gió hút"], ["🦅", "Lao gió"]]},
    {"id": "quanchi", "name": "Quan Chi", "moves": ["fireball", "teleport", "fkick"], "fx": ["skull", ""],
     "sp": [["💀", "Sọ xanh"], ["🌀", "Dịch chuyển"], ["🦵", "Đá bay"]]},
    {"id": "shinnok", "name": "Shinnok", "moves": ["fireball", "spear", "teleport"], "fx": ["dark", "hand"],
     "sp": [["🟣", "Hắc cầu"], ["✋", "Bàn tay ma"], ["🌀", "Dịch chuyển"]]},
    {"id": "noob", "name": "Noob Saibot", "moves": ["fireball", "teleport", "slide"], "fx": ["shadow", ""],
     "sp": [["⚫", "Cầu bóng tối"], ["🌀", "Dịch chuyển"], ["🛷", "Trượt chân"]]},
]
CHAR_IDS = {c["id"]: c for c in CHARS}


def height(state, y=0.0):
    """Chiều cao vùng nhận đòn theo tư thế."""
    if state in ("down", "ko", "fall"):
        return WORLD["H_DOWN"]
    if state in ("crouch", "cblock"):
        return WORLD["H_CROUCH"]
    return WORLD["H"]


def reaches(ax, ay, face, mv, vx, vy, vstate, slack=0.0):
    """Đòn `mv` của người đứng ở (ax, ay) quay mặt `face` có chạm người ở (vx, vy) tư thế `vstate` không."""
    m = MOVES[mv]
    half = WORLD["HALF"]
    lo, hi = (ax + 8, ax + m["reach"]) if face > 0 else (ax - m["reach"], ax - 8)
    if hi + slack < vx - half or lo - slack > vx + half:
        return False
    return ay + m["y0"] - slack < vy + height(vstate) and ay + m["y1"] + slack > vy
