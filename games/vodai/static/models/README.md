# Model 3D cho Võ Đài Sinh Tử

Mặc định cả 16 võ sĩ dùng chung **model người có khung xương** `base/mannequin.glb` (Quaternius, giấy phép CC0 — xem
`base/LICENSE-Quaternius-CC0.txt`), tô màu trang phục + gắn phụ kiện theo từng võ sĩ, animation mocap cho đấm / trúng đòn /
ngã / tung chưởng, còn lại xoay xương theo tư thế của game.

Muốn đẹp hơn nữa (có mặt, quần áo thật) thì làm model riêng theo hướng dẫn dưới đây — võ sĩ nào có model riêng sẽ dùng
model đó, còn lại vẫn dùng model chung. Thêm từng người một cũng được.

## 1. Cần những file gì

| File | Nội dung |
|---|---|
| `scorpion.glb`, `subzero.glb`, … (tối đa 16 file) | Model nhân vật đã gắn xương (rig) |
| `anims.glb` | Bộ animation dùng chung cho mọi nhân vật (cùng khung xương Mixamo) |
| `manifest.json` | Khai báo file nào thuộc võ sĩ nào (xem mục 4) |

Mã võ sĩ: `scorpion, subzero, raiden, liukang, reptile, sonya, jax, johnny, kai, tanya, jarek, reiko, fujin, quanchi, shinnok, noob`.

## 2. Yêu cầu kỹ thuật của model nhân vật

- Định dạng **GLB** (glTF 2.0 nhị phân), texture nhúng sẵn trong file.
- Vật liệu **PBR metallic-roughness**: base color, normal map, roughness/metallic (+ AO nếu có). Texture **2048×2048** là đủ.
- Khoảng **20 000 – 60 000 tam giác** mỗi nhân vật. Nhiều hơn thì điện thoại sẽ nặng.
- **Khung xương chuẩn Mixamo** (tên xương `mixamorig:Hips`, `mixamorig:RightHand`…). Cách dễ nhất là cho model qua **Mixamo Auto-Rigger**.
- Tư thế gốc T-pose hoặc A-pose, mặt quay về **+Z** (mặc định của glTF). Đơn vị và kích thước tuỳ ý: game tự co giãn về đúng chiều cao.
- **Không** dùng nén Draco/Meshopt (chưa nạp bộ giải nén).

## 3. Animation cần có (trong `anims.glb` hoặc nhúng luôn vào từng model)

Tất cả phải **“In Place”** (đứng tại chỗ, không trôi), vì game tự lo di chuyển. Đặt **tên clip** đúng như cột đầu. Game cũng nhận vài tên thay thế, xem `CLIPS` trong `render3d.js`.

| Tên clip | Dùng cho | Gợi ý tìm trên Mixamo |
|---|---|---|
| `idle` | thủ thế đứng yên (lặp) | Fighting Idle / Bouncing Fight Idle |
| `walk_fwd`, `walk_back` | đi tới / lùi (lặp) | Walk Forward / Walk Backward (boxing) |
| `crouch` | ngồi (lặp) | Crouch Idle |
| `block`, `crouch_block` | đỡ đòn (lặp) | Block Idle / Center Block |
| `jump`, `jump_flip` | nhảy thẳng / nhảy lộn vòng | Jump / Front Flip |
| `punch` | đấm (J) | Punching / Cross Punch |
| `kick` | đá cao (K) | Mma Kick / High Kick |
| `uppercut` | móc hàm (↓+J) | Uppercut |
| `sweep` | quét chân (↓+K) | Leg Sweep |
| `roundhouse` | đá xoay (←+K) | Roundhouse Kick |
| `air_punch`, `air_kick` | đấm / đá trên không | Jump Attack / Flying Kick |
| `throw` | quật | Throw / Grab |
| `flying_kick` | phi cước | Flying Kick |
| `bicycle` | đá xe đạp | Hurricane Kick |
| `slide` | trượt chân | Baseball Slide |
| `shoulder` | húc vai / đấm lao | Shoulder Hit / Dash Punch |
| `cast` | tung chưởng | Magic Spell Casting / Fireball |
| `spear` | ném móc câu | Throw Object |
| `teleport` | dịch chuyển | Magic Spell (ngắn) |
| `hit` | trúng đòn | Head Hit / Hit Reaction |
| `knockdown` | bị hạ gục ngã ra sàn (giữ khung cuối khi nằm) | Knocked Down / Flying Back Death |
| `get_up` | đứng dậy | Getting Up |
| `dizzy` | choáng khi “FINISH HIM” (lặp) | Dizzy |
| `victory` | thắng | Victory / Fist Pump |
| `defeated` | thua vì hết giờ | Defeated |

Thiếu clip nào thì game dùng clip gần nhất (thường là `idle` hoặc `punch`), nên làm dần cũng được.

## 4. `manifest.json`

```json
{
  "chars": { "scorpion": "scorpion.glb", "subzero": "subzero.glb" },
  "anims": "anims.glb",
  "adjust": { "raiden": { "height": 1.05 }, "jax": { "rotY": 0 } }
}
```

- `adjust.<mã>.height`: cao hơn/thấp hơn chuẩn (1 = cao bằng các võ sĩ khác).
- `adjust.<mã>.rotY`: xoay thêm (radian) nếu model không quay mặt về +Z.

## 5. Cách làm (gợi ý, miễn phí hoặc rẻ)

1. **Tạo model**: dùng công cụ AI tạo model 3D từ chữ hoặc ảnh, ví dụ Meshy, Tripo, Rodin (Hyper3D). Chọn chế độ **realistic / PBR**, tư thế **A-pose / T-pose**. Có thể vẽ ảnh concept trước bằng AI tạo ảnh rồi cho “image-to-3D”. Câu mô tả gợi ý ở mục 6.
2. **Gắn xương + animation**: tải model (FBX/OBJ) lên **mixamo.com** → Auto-Rigger → tải về *FBX, With Skin*. Chọn từng animation ở bảng mục 3, tick **In Place**, tải *FBX, Without Skin*.
3. **Xuất GLB bằng Blender** (miễn phí):
   - Import FBX nhân vật → File › Export › glTF 2.0 (.glb), bật *Apply Modifiers*, tắt *Animation* → `scorpion.glb`.
   - Import một FBX nhân vật bất kỳ, rồi import lần lượt các FBX animation. Trong Action Editor đổi tên từng action theo cột đầu bảng mục 3, bật *Fake User*. Export glTF chọn *Animation › Actions* → `anims.glb`.
4. Chép file vào thư mục này, sửa `manifest.json`, tải lại trang game (Ctrl+F5).

## 6. Mô tả gợi ý cho công cụ AI tạo model

Đây là ngoại hình **lấy cảm hứng** từ các võ sĩ. Nhân vật Mortal Kombat là tài sản bản quyền, nên không dùng model trích xuất từ game gốc, và chỉ dùng để chơi trong nhóm.

Phần chung (thêm vào mỗi câu): *“realistic full-body 3D game character, athletic, A-pose, PBR textures, high detail, game-ready, no weapon in hands”*

- **scorpion** — male ninja, yellow sleeveless ninja tunic over black bodysuit, yellow hood, black cloth mask over lower face, glowing white eyes, yellow shin wraps, black gloves, rope with kunai on belt
- **subzero** — male ninja, blue ninja tunic over black bodysuit, blue cloth mask over lower face, short black hair, blue shin wraps, ice-blue accents
- **raiden** — tall thunder god, long white hair, wide conical straw hat, white robe with blue trim and blue sash, glowing white eyes, bare hands
- **liukang** — male shaolin monk fighter, bare muscular chest, long black hair, red headband, black kung fu pants with red sash, black wrist wraps
- **reptile** — reptilian male ninja, green ninja tunic over black bodysuit, green hood and mask, glowing yellow eyes, scaly green skin on arms
- **sonya** — female special forces fighter, blonde ponytail, olive green tank top and cargo pants, black combat boots and gloves
- **jax** — very muscular male soldier, dark skin, flat-top haircut, shirtless, chrome metal bionic forearms, olive camo pants, black boots
- **johnny** — male action movie star, shirtless, spiky brown hair, black sunglasses, dark blue jeans, brown belt, black fingerless gloves
- **kai** — male martial artist, dark skin, spiky black hair, red headband, shirtless, black pants with red sash, red hand wraps
- **tanya** — female fighter, long black hair, yellow and black ninja-style outfit, black bodysuit sleeves, yellow boots
- **jarek** — rugged male mercenary, stubble, short dark hair, brown leather vest, black pants, combat boots
- **reiko** — male warlord, spiky black hair, dark purple armor with red shoulder pads, black gloves and pants
- **fujin** — wind god, long white ponytail, light blue-grey robe with gold trim, gold shoulder pieces, blue-grey pants
- **quanchi** — pale bald sorcerer with dark tattoos on scalp, dark green armor with grey shoulder plates, black pants
- **shinnok** — old fallen elder god, long grey hair and beard, dark brown-red robe with gold trim, glowing red eyes
- **noob** — shadow ninja, entirely black outfit, black hood and mask, glowing white eyes, smoky black aura
