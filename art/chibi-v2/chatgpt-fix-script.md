# Vẽ lại bộ phận nhân vật bằng ChatGPT, dùng ma-nơ-canh mẫu

## Vì sao phải vẽ lại

Bộ ảnh cũ bị lộ chỗ ghép: giày không ôm chân, đầu lòi ra khỏi tóc, mũ không vừa đầu, cổ không khớp áo. Lý do là ChatGPT vẽ mỗi món riêng lẻ, không nhìn vào thân nhân vật, nên món nào cũng sai cỡ và sai dáng.

Cách mới là gửi kèm ảnh `mannequin.png` (nằm trong thư mục này):
- Ảnh là một thân chibi tô **hồng tím** trên nền **xanh lá**, có chấm đen đánh dấu mắt và miệng.
- ChatGPT vẽ **từng món lên người ma-nơ-canh**, như đang mặc thật.
- Phần mềm của mình tự canh theo ma-nơ-canh và tách món đồ ra khỏi màu hồng tím và màu xanh, nên món đồ luôn vừa thân gốc.

## Cách làm

1. Mở **một cuộc trò chuyện mới** với ChatGPT.
2. Đính kèm `mannequin.png` và dán **Tin nhắn 1**.
3. Với mỗi món sau đó:
   - Đính kèm lại `mannequin.png`. Không dùng ảnh ChatGPT vừa trả về, vì sai lệch sẽ cộng dồn.
   - Dán tin nhắn mẫu của nhóm món đó, thay phần trong `"..."`.
4. Tải ảnh về và lưu theo mục **Lưu file** ở cuối.
5. Mỗi ảnh trả về chỉ có **một món** mặc trên ma-nơ-canh.

---

## Tin nhắn 1: luật chung (gửi kèm mannequin.png)

```
I attached mannequin.png (1024x1536). It is a PLACEMENT TEMPLATE for a modular chibi avatar:
a flat magenta (#FF00FF) chibi body on a flat green (#00C800) background, with black dots
marking the eyes and mouth. My code will cut your drawing out by removing the magenta and green,
so follow these RULES for every image in this chat:

1. Always return the SAME picture: 1024x1536, the mannequin in EXACTLY the same position, size
   and shape. Never move, resize, redraw or crop the mannequin. Never change the background.
2. Draw ONLY the item I ask for, worn by the mannequin as if it is really wearing it, fitted to
   THIS mannequin's body and head shape.
3. Item style: cute chibi, flat vector, clean dark-gray outline of even thickness, simple 2-tone
   cel shading, front view. GRAYSCALE ONLY (light gray #D9D9D9 base, darker gray shading,
   dark gray outline) unless I say otherwise.
4. Keep the magenta and the green PERFECTLY FLAT: no shadows, no glow, no gradient, no texture
   on them, and no shadow cast by the item onto them.
5. Do not draw a face, skin, hands, text, or anything else. Do not cover or move the black dots
   unless the item must cover them (glasses).

Reply "OK" and wait for my first item.
```

---

## Tóc (9 kiểu, mỗi kiểu một tin nhắn)

```
Item: HAIR, style "short neat hair with one cute strand sticking up".
The hair must cover the WHOLE top and sides of the skull down to the ears, with volume,
so NO magenta is visible above the hairline or around the head outline. Bangs stop just above
the eye dots. Any hair falling behind the shoulders is drawn beside the body.
```

| Lưu tên | Thay phần trong ngoặc kép bằng |
|---|---|
| `hair-short.png` | `short neat hair with one cute strand sticking up` |
| `hair-spiky.png` | `spiky anime hair` |
| `hair-long.png` | `long straight hair down to the waist` |
| `hair-bob.png` | `bob cut with blunt bangs` |
| `hair-ponytail.png` | `high ponytail with a hair tie` |
| `hair-bun.png` | `top bun with a hair band` |
| `hair-curly.png` | `big curly hair` |
| `hair-mohawk.png` | `mohawk; the shaved sides are short stubble in light gray covering the skull` |
| `hair-bald.png` | `bald: only a small white shine highlight on the top of the skull` |

---

## Trang phục (6 bộ và quần short)

```
Item: OUTFIT "t-shirt".
It must COMPLETELY cover the mannequin's torso, including its t-shirt-shaped area, with no magenta
showing on the body. The collar sits snugly at the base of the neck, with no gap between neck
and collar. Sleeves follow the mannequin's arms exactly. Short sleeves end above the elbow;
long sleeves end at the wrist and leave the round hands uncovered. Buttons, collars and ties may
be white or dark gray.
```

| Lưu tên | Thay phần trong ngoặc kép bằng |
|---|---|
| `outfit-tshirt.png` | `t-shirt` |
| `outfit-hoodie.png` | `hoodie with the hood down, kangaroo pocket and drawstrings, long sleeves` |
| `outfit-dress.png` | `knee-length dress with puff sleeves, a white collar and a ribbon at the waist; the skirt covers the shorts area` |
| `outfit-suit.png` | `suit jacket with white shirt, tie and long trousers down to the ankles, long sleeves` |
| `outfit-robe.png` | `long wizard robe down to the ankles with wide sleeves and star decorations` |
| `outfit-overall.png` | `overalls with shorts over a short-sleeved white shirt` |
| `pants-shorts.png` | `plain shorts only (no top), covering the mannequin's shorts area completely` |

---

## Giày (4 loại)

```
Item: SHOES "sneakers".
Both feet must be COMPLETELY inside the shoes, with no magenta visible at the feet or ankles.
The shoes sit exactly on the mannequin's feet, same width and position, soles flat on the same line.
Soles may be white.
```

| Lưu tên | Thay phần trong ngoặc kép bằng |
|---|---|
| `shoes-sneaker.png` | `sneakers` |
| `shoes-boot.png` | `ankle boots` |
| `shoes-sandal.png` | `sandals; the visible toes are drawn in light gray #D9D9D9 skin` |
| `shoes-formal.png` | `formal leather shoes` |

---

## Phụ kiện (8 món)

```
Item: ACCESSORY "baseball cap".
Sized for THIS mannequin's head and sitting ON the skull: hats wrap around the top of the head
and the band/brim follows the head's curve, with no floating. It must not cover the eye dots
(except glasses).
```

| Lưu tên | Thay phần trong ngoặc kép bằng |
|---|---|
| `acc-glasses.png` | `round glasses over the eye dots` |
| `acc-sunglasses.png` | `sunglasses over the eye dots` |
| `acc-beanie.png` | `knit beanie with a pompom, pulled down to just above the eye dots` |
| `acc-cap.png` | `baseball cap, brim facing forward, ending above the eye dots` |
| `acc-crown.png` | `small crown with gems on top of the head` |
| `acc-flower.png` | `flower hair clip on the left side of the head` |
| `acc-headband.png` | `headband with a small bow across the top of the head` |
| `acc-witchhat.png` | `witch hat whose brim sits on the head above the eye dots` |

---

## Khi ChatGPT làm sai

| Vấn đề | Nhắn lại (nhớ đính kèm lại mannequin.png) |
|---|---|
| Ma-nơ-canh bị dời, đổi cỡ hoặc vẽ lại | `Keep the mannequin pixel-identical, same position and size. Draw only the item.` |
| Nền xanh hoặc thân hồng tím bị đổ bóng, loang | `Keep the magenta and green perfectly flat, no shadows or glow.` |
| Còn lộ màu hồng tím chỗ tóc, cổ áo hay giày | `Some magenta is still visible at the ___ . Cover it completely.` |
| Món đồ có màu | `Redo in grayscale only.` |
| Vẽ thêm mặt hoặc tay | `Draw only the item, nothing else.` |

---

## Lưu file

Lưu vào các thư mục con của `D:\NAMLT\Game\art\chibi-v2\`, đặt tên đúng như các bảng ở trên:

```
art\chibi-v2\
├── mannequin.png            ← ảnh mẫu gửi cho ChatGPT (đừng sửa)
├── hair\    hair-short.png, hair-spiky.png, ...     (9 file)
├── outfit\  outfit-tshirt.png, ..., pants-shorts.png (7 file)
├── shoes\   shoes-sneaker.png, ...                   (4 file)
└── acc\     acc-glasses.png, ...                     (8 file)
```

- Giữ đuôi `.png`. Không lưu thành `.webp` hay `.jpg`.
- Không cần nền trong suốt. Cứ để nguyên nền xanh.
- Trước khi lưu, nhìn nhanh: chỗ nào đáng lẽ được che (đỉnh đầu, cổ áo, bàn chân) mà còn lộ màu hồng tím thì nhắn ChatGPT sửa lại.
- Mặt, biểu cảm và thân gốc **không cần vẽ lại**, vẫn dùng bản cũ.
- Lưu đủ thì báo lại. Không cần đủ hết một lần, có món nào mình ghép món đó.
