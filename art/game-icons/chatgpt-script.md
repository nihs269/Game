# Tạo ảnh bìa ngang cho từng game bằng ChatGPT

Ảnh bìa nằm ở đầu mỗi thẻ game ngoài sảnh, **thay cho biểu tượng emoji và đoạn tóm tắt** hiện tại.
Thẻ game sau này chỉ còn: **ảnh bìa** → tên game → số người chơi → nút Hướng dẫn / Tạo phòng.
Vì không còn đoạn tóm tắt, **ảnh phải tự kể được game chơi gì**: một cảnh đang chơi, nhìn là hiểu.

Hiện có **20 game**. Mục tiêu: cả bộ trông **cùng một phong cách**, như các ảnh bìa trong một cửa hàng game.

## Cách nhanh nhất: mỗi game một file lệnh

Thư mục `prompts\` có sẵn **20 file**, mỗi file là lệnh hoàn chỉnh cho đúng một game (đã gồm cảnh, màu và mọi luật):
`prompts\werewolf.txt`, `prompts\uno.txt`… Mở file, chép **toàn bộ** nội dung, dán vào ChatGPT, tải ảnh về và lưu
thành `<tên file>.png` (ví dụ `werewolf.txt` → `werewolf.png`).

- Mỗi file dùng độc lập được, không cần gửi Tin nhắn 1 trước.
- Nên tạo cả bộ trong **cùng một cuộc trò chuyện** để các ảnh cùng phong cách. Từ ảnh thứ hai trở đi, thêm một dòng ở đầu:
  `Same art style as the previous covers in this chat.`

Cách bên dưới (Tin nhắn 1 + tin nhắn ngắn cho từng game) cho ra kết quả tương tự, dùng khi muốn gõ ít hơn.

## Cách làm (tin nhắn chung + tin nhắn ngắn)

1. Mở **một cuộc trò chuyện mới** với ChatGPT và dán **Tin nhắn 1** (luật chung).
2. Với mỗi game, dán **tin nhắn mẫu** ở cuối Tin nhắn 1, thay phần trong `"..."` bằng mô tả cảnh trong bảng.
3. Làm **cùng một cuộc trò chuyện** cho cả bộ để giữ nguyên phong cách. Nếu ảnh bắt đầu lệch, đính kèm 2–3 ảnh đẹp nhất
   đã làm và nhắn: `Match the style of these attached covers exactly.`
4. Tải ảnh về, lưu theo mục **Lưu file** ở cuối.

---

## Tin nhắn 1: luật chung

```
I am making a set of 20 cover images for the game cards of a casual multiplayer browser game website
(Vietnamese friends playing together). For every image in this chat, follow these RULES exactly:

1. LANDSCAPE 1536x1024 (3:2). A full-bleed illustration filling the whole canvas: no border, no frame,
   no rounded corners, no margin.
2. The image must explain the game at a glance: show a moment of actual gameplay as described.
   Keep everything important inside the central 80% (the edges may be cropped slightly on small screens).
3. Style: cute, colorful, glossy 3D cartoon (like modern mobile game key art), soft lighting, clean shapes,
   bold readable silhouettes that still read clearly when the image is shown about 300 pixels wide.
   People, when present, are cute chibi characters with big heads, of varied looks.
4. Color: I give a main color mood for each cover. Saturated but not neon. Slightly darker toward the
   bottom edge so it sits nicely on a dark navy website.
5. ABSOLUTELY NO text, letters, numbers, logos, watermarks or UI elements, unless I explicitly allow a symbol.
6. Original artwork only: do not copy any existing game's logo, characters, card designs or branding.
7. Keep the SAME art style, lighting, camera feel and level of detail across all covers in this chat.

Reply "OK" and wait for the first cover.
```

### Tin nhắn mẫu cho từng game

```
Cover: "<mô tả cảnh trong bảng>".
Color mood: <màu trong bảng>.
```

Ví dụ:

```
Cover: "a cozy office at night: a chibi programmer typing fast at a laptop full of glowing code, a steaming coffee cup, a coworker peeking over the shoulder pointing at a tiny bug on the screen, a server rack behind them blinking red with a small fire".
Color mood: deep teal and navy with warm screen glow.
```

---

## Danh sách game

| Lưu tên | Game | Cảnh (dán vào `"..."`) | Màu |
|---|---|---|---|
| `cangua.png` | 🐴 Cờ Cá Ngựa | top-down view of a colorful cross-shaped ludo-style board with four colored horse pieces racing around it, one horse knocking another back to its home, two dice tumbling on the board | warm red and orange |
| `caulong.png` | 🏸 Cầu Lông | side view of a badminton court: a chibi player leaping high to smash a white shuttlecock over the net while the opponent dives to return it | fresh green and teal |
| `chienbinh.png` | 🔫 Chiến Binh Tí Hon | side-scrolling battle on floating platforms: tiny chibi soldiers jumping and firing cartoon blasters at each other, a grenade arcing through the air, a flag on one platform | olive green and dusk orange |
| `cotyphu.png` | 🎩 Cờ Tỷ Phú | a board game around the world: game pieces moving along a square board path of famous city landmarks, tiny houses and hotels on the tiles, gold coins and dice in the foreground | royal green and gold |
| `dabong.png` | ⚽ Đá Bóng | side view of a small soccer pitch: a chibi player doing a powerful jumping header toward the goal, the goalkeeper stretching, the ball with a swoosh trail | grass green and bright sky blue |
| `duaxe.png` | 🏎️ Đua Xe Gõ Phím | cartoon race cars speeding side by side on a track whose road surface is made of keyboard keys, chibi drivers typing on keyboards in their cars, a checkered finish line ahead | hot orange and purple |
| `giandiep.png` | 🕵️ Gián Điệp | a group of chibi friends sitting in a circle whispering, each with a card held close, one of them sweating nervously with a hidden spy hat, the others pointing suspiciously | dark indigo and violet |
| `haichien.png` | ⚓ Hải Chiến | a sea battle seen from above at an angle: two fleets of cartoon warships on a grid-marked ocean, cannon fire, a big splash next to one ship and an explosion on another | ocean blue and navy |
| `khoanhso.png` | ⭕ Khoanh Số | a big sheet of paper full of scattered handwritten numbers, several hands with different colored pens racing to circle numbers, colorful circles already drawn (handwritten numbers are allowed) | cream paper on light blue |
| `liarbar.png` | 🍺 Liar's Bar | a moody dim tavern table: cartoon characters holding cards face down with sly expressions, foamy beer mugs, one card being revealed as a lie, a revolver lying in the middle of the table | dark amber and brown |
| `meono.png` | 💣 Mèo Nổ | a group of chibi friends drawing cards from a deck, one card exploding into a surprised cartoon cat with a round bomb and sparks, the others jumping back in shock | orange and deep red |
| `noitu.png` | 🔤 Nối Từ | chibi friends in a row passing linked chain-shaped word tiles from one to the next, each tile connecting to the next like chain links (blank tiles, no letters) | turquoise and blue |
| `oanquan.png` | 🪨 Ô Ăn Quan | two Vietnamese kids playing the traditional mandarin square capturing game drawn on the ground in a village courtyard: a row of square pits with small pebbles and two big half-moon end pits with large stones, one kid sowing pebbles one by one | earthy beige and terracotta |
| `phanxa.png` | ⚡ Phản Xạ | chibi players slamming big glowing arcade buttons at the same moment, lightning bolts, a stopwatch, colorful shapes and a memory card grid flying around | electric yellow and purple |
| `pickleball.png` | 🏓 Pickleball | side view of a small pickleball court with a low net: a chibi player hitting a yellow holed ball with a solid paddle, the opponent lunging at the kitchen line | lime and teal |
| `poker.png` | ♠️ Poker | a green felt poker table seen from slightly above: cards face down, five community cards in the middle, stacks of chips being pushed all in, chibi players with confident and nervous faces (card suit symbols allowed) | deep green and black |
| `tarot.png` | 🔮 Bói Tarot | a mystical table with a glowing crystal ball, a spread of tarot cards being flipped by a hand, friends leaning in curiously, stars and a crescent moon in the air | deep purple and midnight blue |
| `uno.png` | 🃏 UNO | chibi friends around a table throwing colorful cards (red, yellow, green, blue with simple shapes) onto a pile, one friend triumphantly holding up the last card (original card design, no logo) | bright red and yellow |
| `vedoan.png` | 🎨 Vẽ Đoán | one chibi drawing a funny doodle on a big easel while friends around shout guesses with thought bubbles containing question marks | rainbow pastel and purple |
| `werewolf.png` | 🐺 Ma Sói | a small village at night under a huge full moon: a cartoon werewolf silhouette howling on a hill, chibi villagers peeking nervously from windows holding lanterns | night blue and purple |

---

## Khi ChatGPT làm sai

| Vấn đề | Nhắn lại |
|---|---|
| Ảnh không phải khổ ngang 3:2 | `Make it landscape 1536x1024, full-bleed, no border.` |
| Có chữ, số hoặc logo | `Remove all text, letters, numbers and logos.` |
| Có khung, viền, bo góc | `Full-bleed illustration, no frame, no border, no rounded corners.` |
| Rối, thu nhỏ khó nhìn | `Simplify: fewer characters and objects, bigger and bolder main action in the center.` |
| Nhìn không biết game chơi gì | `Show the gameplay action more clearly: <nhắc lại hành động chính>.` |
| Lệch phong cách so với các ảnh trước | Đính kèm 2–3 ảnh đẹp nhất và nhắn `Match the style of these attached covers exactly.` |
| Giống nhân vật hoặc logo của game có sẵn | `Make it an original design that does not resemble any existing game's characters or logo.` |

---

## Lưu file

Lưu vào `D:\NAMLT\Game\art\game-icons\`, đặt tên đúng cột **Lưu tên** (trùng mã game):

```
art\game-icons\
├── chatgpt-script.md   ← file này
├── cangua.png
├── caulong.png
├── ...
└── werewolf.png
```

- Giữ đuôi `.png` và khổ 1536x1024. Không cần tự thu nhỏ, mình sẽ chuyển sang cỡ nhỏ để web tải nhanh.
- Không cần làm đủ hết một lần. Có ảnh nào thì báo lại, mình gắn vào thẻ game đó (bỏ emoji và đoạn tóm tắt);
  game chưa có ảnh vẫn giữ như cũ cho tới khi có ảnh.
