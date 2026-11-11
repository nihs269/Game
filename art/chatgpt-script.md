# Kịch bản nhờ ChatGPT vẽ bộ nhân vật chibi

Dán **lần lượt từng khung** dưới đây vào **cùng một cuộc trò chuyện** ChatGPT. Mỗi khung là một tin nhắn.

- Tin nhắn 1 đặt luật chung và để ChatGPT tự sáng tạo nhân vật gốc. Các tin nhắn sau dùng chính nhân vật đó làm mẫu.
- ChatGPT thường chỉ trả 1 ảnh mỗi lượt. Nhắn `next image` để lấy ảnh tiếp theo.
- Tải ảnh về và lưu theo mục **"Lưu file"** ở cuối file này.

---

## Tin nhắn 1: luật chung và nhân vật gốc

```
You are the art director and illustrator for a cute browser party game. I need a modular CHIBI avatar
system: one base character plus many separate parts (hair, outfits, shoes, accessories, faces)
that my code stacks on top of each other like paper-doll layers. Be creative with the style,
but follow these RULES for every image in this whole conversation:

STYLE (keep identical in every image): adorable chibi, very big round head (about 45% of total height),
small rounded body, short limbs, round mitten-like hands, flat vector look, clean dark-gray outlines
of the same thickness everywhere, simple 2-tone cel shading, front view, standing straight,
arms hanging beside the body, feet slightly apart. Friendly, gender-neutral.

CANVAS (identical for every image): 1024x1536 portrait, REAL transparent PNG background
(no checkerboard, no white, no black, no glow or halo around the drawing). Character centered
horizontally. Top of head at 8% from the top, soles of feet at 92% from the top. Every part must
be drawn at EXACTLY the position and size it has on the base character, so all images line up
perfectly when stacked.

COLOR: anything the player can recolor (skin, hair, clothes, shoes, accessories) must be NEUTRAL
GRAYSCALE ONLY: light gray #D9D9D9 base, darker gray shading, dark gray outline. No other hues
unless I say so.

ISOLATION: when I ask for a part, draw ONLY that part on the canvas and leave everything else empty.
No text, no labels, no ground shadow, no background.

Now create the BASE CHARACTER: bald, no face drawn (blank skin on the face), wearing nothing but a
plain fitted gray t-shirt and shorts, all in grayscale as described. This is the master reference
for everything that follows. Show it to me.
```

Chưa ưng thì nhắn tiếp để chỉnh, ví dụ: *"đầu to hơn"*, *"mập mạp hơn"*, *"nét mảnh hơn"*. Ưng rồi mới chuyển sang tin nhắn 2.

---

## Tin nhắn 2: tách thân gốc

```
Great, this is the final base. Keep it as the master reference. Now split it into separate images
(same canvas, same exact positions, grayscale skin, nothing else on each canvas):
1) head with ears (no face, no hair)
2) neck
3) left arm with hand
4) right arm with hand
5) both legs with bare feet
Give me each as its own transparent PNG.
```

---

## Tin nhắn 3: khuôn mặt và biểu cảm

```
Now the FACE parts, drawn exactly where the face sits on the base head, each on its own empty
transparent canvas. These may use real colors: big anime eyes with white sclera, brown iris,
dark pupil and a big white highlight; dark-brown mouth with pink tongue.
1) eyes open, with soft pink blush on the cheeks
2) eyes closed (happy curved arcs)
3) angry eyes (red glowing)
4) mouth smiling (open "D" shape)
5) mouth open (surprised "o")
6) mouth sad (frown)
7) light-blue tear drops under both eyes
```

---

## Tin nhắn 4 đến 12: tóc (mỗi kiểu một tin nhắn)

Mẫu tin nhắn:

```
Hairstyle: "short neat hair with one cute strand sticking up". Grayscale only, fitted exactly on the
base head. Give TWO images: A) FRONT layer (bangs/top, sits over the head), B) BACK layer (hair behind
the head and shoulders; empty canvas if there is none).
```

Mỗi lần, thay phần trong ngoặc kép bằng một kiểu sau:

| # | Kiểu tóc | Thay bằng |
|---|---|---|
| 1 | Ngắn | `short neat hair with one cute strand sticking up` |
| 2 | Dựng | `spiky anime hair` |
| 3 | Dài | `long straight hair to the waist` |
| 4 | Bob | `bob cut with blunt bangs` |
| 5 | Đuôi ngựa | `high ponytail with a hair tie` |
| 6 | Búi | `top bun with a hair band` |
| 7 | Xoăn | `big curly hair` |
| 8 | Mohawk | `mohawk with shaved sides` |
| 9 | Trọc | `bald: only a small shine highlight on the scalp` |

---

## Tin nhắn 13 đến 18: trang phục

Mẫu tin nhắn:

```
Outfit: "t-shirt". Worn on the base body, grayscale fabric (buttons/zippers may be white or dark gray).
Give THREE images: 1) torso part, 2) left sleeve, 3) right sleeve (empty if sleeveless).
If the outfit has its own bottoms (trousers, skirt, long robe), include them in the torso image.
No skin, head or legs drawn.
```

Mỗi lần, thay phần trong ngoặc kép bằng một bộ sau:

| # | Trang phục | Thay bằng |
|---|---|---|
| 1 | Áo thun | `t-shirt` |
| 2 | Hoodie | `hoodie with the hood down, kangaroo pocket and drawstrings` |
| 3 | Váy | `knee-length dress with a ribbon at the waist and a white collar` |
| 4 | Vest | `suit jacket with white shirt, tie and long trousers` |
| 5 | Áo choàng | `long wizard robe with wide sleeves and star decorations` |
| 6 | Yếm | `overalls with shorts over a white shirt` |

---

## Tin nhắn 19: quần short riêng

```
Draw ONLY a pair of plain shorts on the base body, grayscale, same position, one image.
```

---

## Tin nhắn 20 đến 23: giày

Mẫu tin nhắn:

```
Shoes: "sneakers". A pair on the base feet position, grayscale (soles may be white), one image.
```

Mỗi lần, thay phần trong ngoặc kép bằng một loại sau:

| # | Giày | Thay bằng |
|---|---|---|
| 1 | Sneaker | `sneakers` |
| 2 | Bốt | `ankle boots` |
| 3 | Dép | `sandals with toes visible (toes in light gray skin)` |
| 4 | Giày tây | `formal leather shoes` |

---

## Tin nhắn 24 đến 31: phụ kiện

Mẫu tin nhắn:

```
Accessory: "round glasses". Placed correctly on the base head, grayscale only, one image.
```

Mỗi lần, thay phần trong ngoặc kép bằng một món sau:

| # | Phụ kiện | Thay bằng |
|---|---|---|
| 1 | Kính | `round glasses` |
| 2 | Kính râm | `sunglasses` |
| 3 | Mũ len | `knit beanie with a pompom` |
| 4 | Mũ lưỡi trai | `baseball cap` |
| 5 | Vương miện | `small crown with gems` |
| 6 | Hoa cài | `flower hair clip on the side` |
| 7 | Băng đô | `headband with a small bow` |
| 8 | Mũ phù thủy | `witch hat` |

---

## Tin nhắn cuối: ghép thử để kiểm tra

```
To check alignment, show me one preview with these layers stacked: base body + eyes open +
mouth smiling + long hair (back and front) + hoodie + sneakers + crown, recolored with any nice colors.
```

---

## Khi ChatGPT làm sai

| Vấn đề | Nhắn lại |
|---|---|
| Lệch phong cách hoặc vẽ thêm thứ khác | `Follow the RULES from my first message exactly.` |
| Tô màu thật cho phần cần đổi màu | `Redo in grayscale only.` |
| Nền đen, trắng, ô caro hoặc có quầng sáng | `Real transparent PNG background, no glow, no halo.` |
| Bộ phận bị lệch vị trí | `Same position and size as the base character, please.` |

---

## Lưu file

### Cách tải một ảnh từ ChatGPT
1. Bấm vào ảnh để mở to, rồi bấm nút **Tải xuống** (mũi tên ↓) ở góc ảnh. Nếu không có nút đó, chuột phải vào ảnh và chọn **Lưu hình ảnh thành…** (*Save image as…*).
2. Trong hộp thoại lưu, chọn đúng thư mục con theo bảng bên dưới, ví dụ `D:\NAMLT\Game\art\chibi\hair\`.
3. Đổi tên file theo bảng, ví dụ `hair-long-front.png`, rồi bấm **Save**.
4. Giữ đuôi **`.png`**. Không lưu thành `.webp` hay `.jpg`, vì hai định dạng này làm mất nền trong suốt.

Nếu một tin nhắn trả về nhiều ảnh, lưu lần lượt từng ảnh theo đúng thứ tự đã đánh số trong tin nhắn.

### Cây thư mục (đã tạo sẵn)

```
D:\NAMLT\Game\art\
├── chatgpt-script.md        ← file này
└── chibi\
    ├── base\                ← thân gốc (tin nhắn 1, 2)
    ├── face\                ← mặt, biểu cảm (tin nhắn 3)
    ├── hair\                ← tóc (tin nhắn 4–12)
    ├── outfit\              ← trang phục, quần short (tin nhắn 13–19)
    ├── shoes\               ← giày (tin nhắn 20–23)
    ├── acc\                 ← phụ kiện (tin nhắn 24–31)
    └── preview\             ← ảnh ghép thử, ảnh nháp không dùng
```

### Tên file trong từng thư mục

| Thư mục | Tên file |
|---|---|
| `chibi\base\` | `base-full.png`, `base-head.png`, `base-neck.png`, `base-arm-left.png`, `base-arm-right.png`, `base-legs.png` |
| `chibi\face\` | `face-eyes-open.png`, `face-eyes-closed.png`, `face-eyes-angry.png`, `face-mouth-smile.png`, `face-mouth-open.png`, `face-mouth-sad.png`, `face-tears.png` |
| `chibi\hair\` | `hair-<kiểu>-front.png`, `hair-<kiểu>-back.png` (kiểu nào không có lớp sau thì bỏ file `-back`) |
| `chibi\outfit\` | `outfit-<bộ>-torso.png`, `outfit-<bộ>-sleeve-left.png`, `outfit-<bộ>-sleeve-right.png`, `pants-shorts.png` |
| `chibi\shoes\` | `shoes-<loại>.png` |
| `chibi\acc\` | `acc-<món>.png` |
| `chibi\preview\` | tên tuỳ ý |

Tên viết bằng tiếng Anh như trong code:

- **`<kiểu>` tóc:** `short`, `spiky`, `long`, `bob`, `ponytail`, `bun`, `curly`, `mohawk`, `bald`
- **`<bộ>` trang phục:** `tshirt`, `hoodie`, `dress`, `suit`, `robe`, `overall`
- **`<loại>` giày:** `sneaker`, `boot`, `sandal`, `formal`
- **`<món>` phụ kiện:** `glasses`, `sunglasses`, `beanie`, `cap`, `crown`, `flower`, `headband`, `witchhat`

**Ví dụ:**
- Tóc dài: `chibi\hair\hair-long-front.png` và `chibi\hair\hair-long-back.png`
- Hoodie: `chibi\outfit\outfit-hoodie-torso.png`, `outfit-hoodie-sleeve-left.png`, `outfit-hoodie-sleeve-right.png`
- Vương miện: `chibi\acc\acc-crown.png`

### Kiểm tra trước khi báo
- Mở thử vài file bằng trình xem ảnh. Nền phải trong suốt, không có nền đen, trắng hay ô caro.
- Số file cần có:

| Thư mục | Số file |
|---|---|
| `base` | 6 |
| `face` | 7 |
| `hair` | tối đa 18 |
| `outfit` | 18 + 1 quần short |
| `shoes` | 4 |
| `acc` | 8 |

- Lưu đủ rồi thì báo lại để ghép vào game.
