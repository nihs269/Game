# 🎲 Game Hub

Nền tảng chơi game nhiều người qua trình duyệt, chạy trên máy của bạn. Bạn bè truy cập
vào địa chỉ IP + cổng của máy bạn, chọn game, tạo/vào phòng và chơi cùng nhau.

## Chạy

```bash
pip install -r requirements.txt     # chỉ cần aiohttp (Anaconda đã có sẵn)
python main.py                      # mặc định cổng 8080
python main.py --port 9000          # hoặc chọn cổng khác
```

Khi chạy, màn hình sẽ in ra các địa chỉ:

```
   Máy này:      http://localhost:8080
   Bạn bè (LAN): http://192.168.1.23:8080
```

- **Cùng mạng Wi‑Fi/LAN**: bạn bè mở địa chỉ `Bạn bè (LAN)`. Lần đầu chạy, Windows sẽ hỏi
  cho phép Python qua tường lửa — hãy chọn **Allow** (cả Private network).
- **Khác mạng (qua Internet)**: mở port trên router (port forwarding), hoặc dùng công cụ tạo
  đường hầm như `ngrok http 8080` / `cloudflared tunnel --url http://localhost:8080` rồi gửi link cho bạn bè.

## 🎙️ Voice chat (nói chuyện bằng mic) — ⏸ đang tạm tắt

> Tạm thời đã tắt. Muốn bật lại: bỏ comment dòng `voice.js` trong `games/*/static/index.html`
> và chạy `python main.py --https`.

Trong phòng, bấm nút **🎙️ Voice** trên thanh trên cùng. Sau đó có thể 🎤 tắt/bật mic, 🎧 tắt/bật loa, ✕ rời voice.
Người đang nói sẽ sáng vòng xanh dưới chân và mấp máy miệng.

- Trình duyệt **chỉ cho dùng mic trên HTTPS** (hoặc `localhost`). Vì vậy server mở thêm cổng HTTPS
  (cổng + 1, VD `https://192.168.1.23:8081`) với chứng chỉ tự ký, tạo sẵn trong thư mục `.certs/`.
  Lần đầu vào, trình duyệt cảnh báo "kết nối không riêng tư" → bấm **Nâng cao → Tiếp tục**.
- Vào bằng địa chỉ HTTP thường thì vẫn **nghe** được, chỉ không nói được.
- Tiếng đi thẳng giữa các máy (WebRTC), máy chủ chỉ làm cầu nối kết nối. Trong mạng LAN chạy tốt;
  qua Internet có thể không kết nối được với một số mạng (cần máy chủ TURN).
- Luật Ma Sói: ban đêm dân làng bị khoá mic, **bầy Sói nói riêng với nhau**; người đã chết chỉ nói
  với người chết (nhưng vẫn nghe người sống).
- HTTPS chỉ mở khi chạy `python main.py --https`.

## Cách chơi

Mỗi game có **📖 Hướng dẫn** ngay trên thẻ game ở sảnh, và nút **❓** trên thanh trên cùng khi đang trong phòng.

Góc phải trang sảnh có khung **🟢 Đang hoạt động**: ai đang ở sảnh, ai đang chơi game nào ở phòng nào (bấm vào để vào
cùng phòng). Danh sách tự cuộn khi đông người; bấm vào tiêu đề để thu gọn / mở rộng.

1. Vào trang chủ, nhập tên, bấm **Tạo phòng** ở game muốn chơi.
2. Gửi **mã phòng 4 ký tự** hoặc **link mời** cho bạn bè.
3. Chủ phòng chỉnh vai trò/thời gian, rồi bấm **Bắt đầu**.

**Không đủ người?** Chủ phòng bấm **＋ bot** / **Lấp đủ 8 người** trong phòng chờ để thêm người
chơi ảo. Bot tự nhận vai, hành động ban đêm, trò chuyện và bỏ phiếu (bot Tiên Tri soi ra Sói sẽ
tố cáo, dân làng nghe theo…). Bấm ✕ trên thẻ bot hoặc **Xoá hết bot** để bỏ bớt.

Rớt mạng hoặc lỡ đóng tab? Vào lại phòng với **đúng tên cũ** là tiếp tục được ván đang chơi.

**Vào xem giữa ván:** phòng đang chơi vẫn cho người mới vào (nút **👀 Xem** ở sảnh, nhận thêm tối đa 20 người xem).
Người xem thấy diễn biến ván đấu nhưng **không** thấy vai, bài trên tay hay thông tin bí mật của người chơi, và không
làm được hành động nào. Ván sau họ được vào chơi (theo thứ tự vào phòng, tối đa số người của game). Riêng Ma Sói,
người xem chat ở kênh 👀 riêng — người chơi còn sống không đọc được, và không nghe được voice ban đêm.

**Phòng trống tự xoá** (bot không tính là người): người thật cuối cùng bấm rời phòng → xoá ngay; mọi người
đều mất kết nối / đóng tab → xoá sau 30 giây (kịp tải lại trang); phòng vừa tạo mà chưa ai vào → xoá sau 2 phút.

## 🐺 Ma Sói

Máy chủ đóng vai quản trò, tự động điều khiển ngày/đêm nên mọi người đều được chơi.

| Vai | Phe | Năng lực |
|---|---|---|
| 🐺 Ma Sói | Sói | Mỗi đêm cả bầy thống nhất cắn 1 người, có kênh chat riêng ban đêm |
| 🔮 Tiên Tri | Dân | Mỗi đêm soi 1 người xem có phải Sói không |
| 🛡️ Bảo Vệ | Dân | Mỗi đêm bảo vệ 1 người, không được chọn cùng người 2 đêm liên tiếp |
| 🧪 Phù Thủy | Dân | 1 bình cứu + 1 bình độc cho cả ván, biết ai bị cắn |
| 🏹 Thợ Săn | Dân | Khi chết (trừ khi trúng độc) được bắn chết 1 người |
| 🧑‍🌾 Dân Làng | Dân | Thảo luận và bỏ phiếu |

Tuỳ chọn **Lộ vai trò khi chết**: tắt đi thì vai của người chết được giữ bí mật, và người đã chết cũng không xem được
vai người khác, không đọc được kênh chat / nghe lén voice của bầy Sói.

Diễn biến: **Nhận vai → Đêm (Sói/Tiên Tri/Bảo Vệ) → Phù Thủy → Sáng (công bố người chết)
→ Thảo luận → Bỏ phiếu treo cổ → Đêm tiếp theo…** Hoà phiếu hoặc đa số chọn "Bỏ qua" thì không
ai bị treo. Dân thắng khi hết Sói; Sói thắng khi số Sói ≥ số người còn lại.

**Nhân vật & đống lửa**: mỗi người tự tạo nhân vật (kiểu tóc, màu tóc, màu da, trang phục, quần,
giày dép, phụ kiện) ở sảnh hoặc nút 👗 trong phòng. Trong game, mọi người ngồi quanh đống lửa:
ban đêm ngủ gật (Sói thấy mắt đỏ của đồng bọn), bỏ phiếu thì chỉ tay về người bị nghi, người chết
có animation (treo cổ / trúng tên / gục ngã) rồi hoá hồn ma, tin nhắn hiện thành bong bóng thoại.
Nhấn vào người khác để vẫy tay, thả tim, tặng hoa, ném cà chua, đập tay, chọc; nhấn vào mình
hoặc thanh biểu cảm để cười, khóc, nhảy… (ban đêm người còn sống không tương tác được).

**Giọng quản trò tiếng Việt** (nút 🔇/🔊): máy chủ tạo âm thanh tiếng Việt qua `/api/tts` nên giọng giống nhau trên
mọi trình duyệt (Chrome, Edge, Safari, điện thoại) — ưu tiên giọng tự nhiên *Hoài My* của Microsoft (`pip install edge-tts`),
lỗi hoặc chưa cài thì dùng giọng Google Dịch; máy chủ không đọc được thì dùng giọng Việt có sẵn của trình duyệt (nếu có).
Trình duyệt chỉ cho phát âm thanh sau khi người dùng đã chạm vào trang: nếu vừa tải lại trang mà quản trò lên tiếng,
sẽ có nhắc “chạm vào màn hình” và câu đó được đọc bù ngay khi chạm. Cần máy chủ có Internet, và câu đọc (có tên
người chơi) được gửi tới dịch vụ giọng đọc đó.

Tiện ích: đồng hồ đếm ngược, chat theo kênh (chung / riêng Sói / người chết), nhật ký có ghi
chú bí mật của riêng bạn (VD: kết quả soi), giọng đọc quản trò (nút 🔊), che vai trò để
tránh bị nhìn trộm, giao diện chạy tốt trên điện thoại.

## 🃏 UNO (2–10 người)

Bộ 108 lá chuẩn, mỗi người 7 lá. Đánh lá **cùng màu** hoặc **cùng số/ký hiệu** với lá trên bàn,
hoặc lá **Đổi màu / +4**; không đánh được thì rút bài (lá vừa rút đánh được thì đánh luôn hoặc bỏ lượt).
Lá chức năng: ⊘ Cấm lượt, ⇄ Đảo chiều (2 người = cấm lượt), +2, Đổi màu, +4.

- **Hô UNO!**: bấm nút UNO! khi đánh lá áp chót. Quên hô mà bị người khác bấm **Bắt lỗi** trước khi
  người kế tiếp đánh → phạt rút 2 lá.
- **Tính điểm**: người hết bài trước thắng ván, được cộng điểm bài còn lại của người khác
  (lá số = số, chức năng = 20, đổi màu = 50). Chủ phòng bấm **Ván tiếp theo** để chơi tiếp, cộng dồn điểm.
- **Luật tuỳ chọn** (chủ phòng chỉnh): thời gian mỗi lượt (hết giờ tự rút & bỏ lượt), cộng dồn +2/+4,
  rút tới khi đánh được.
- Người mất kết nối đến lượt sẽ được máy tự rút & bỏ lượt sau 5 giây. Người mới vào được giữa các ván.
- **Bot**: chủ phòng bấm **＋ bot** / **Lấp đủ** ở phòng chờ hoặc giữa các ván. Bot tự đánh (giữ lá
  đổi màu tới cuối, dùng lá phạt khi người sau sắp hết bài), thỉnh thoảng quên hô UNO và biết bắt lỗi người khác.

## 💣 Mèo Nổ (2–10 người)

Phiên bản của Exploding Kittens. Mỗi người 7 lá + 1 🧯 Gỡ Bom; chồng bài có (số người − 1) 💣 Mèo Nổ
(từ 6 người trở lên dùng gấp đôi bộ bài). Mỗi lượt đánh bao nhiêu lá tuỳ thích rồi **rút 1 lá** để kết thúc lượt.
Rút phải Mèo Nổ mà không có Gỡ Bom là **nổ tung** — người cuối cùng còn sống thắng.

| Lá | Tác dụng |
|---|---|
| 🧯 Gỡ Bom | Tự dùng khi rút phải Mèo Nổ, rồi bí mật nhét bom lại vào chồng bài ở vị trí tuỳ chọn |
| ⚔️ Tấn Công | Hết lượt không cần rút; người sau chơi 2 lượt (bị tấn công mà tấn công lại → số lượt còn lại + 2) |
| 🏃 Bỏ Lượt | Hết 1 lượt không cần rút |
| 🙏 Xin Xỏ | Một người phải tự chọn 1 lá đưa cho bạn |
| 🔀 Xáo Bài | Xáo chồng bài |
| 🔮 Tiên Tri | Bí mật xem 3 lá trên cùng (luôn hiện cho bạn tới khi chồng bài bị xáo / nhét bom) |
| 🚫 Không! | Chặn hành động vừa đánh, kể cả chặn một lá Không! khác (có vài giây để chặn) |
| 🌮🍉🥔🧔🌈 Lá mèo | Đôi giống nhau: rút ngẫu nhiên 1 lá của người khác · Bộ ba: đòi đích danh 1 lá |

Chủ phòng chỉnh thời gian mỗi lượt (hết giờ tự rút bài) và thời gian chờ chặn. Thông tin bí mật (rút được gì,
bị lấy lá gì, 3 lá Tiên Tri…) hiện trong tab Diễn biến với dấu 🔒. **Bot** biết dùng Tiên Tri, né bom khi biết lá
trên cùng là Mèo Nổ, chặn bằng Không! khi bị nhắm tới, xin/rút bài người nhiều bài nhất và nhét bom hại người sau.

## 🍺 Liar's Bar (2–4 người)

Chế độ *Liar's Deck*. Bộ 20 lá: 6 Q, 6 K, 6 A, 2 Joker. Mỗi lượt bài chia mỗi người 5 lá và chọn ngẫu nhiên
**lá của bàn** (Q, K hoặc A; Joker thay được mọi lá).

- Đến lượt: **úp 1–3 lá** và khai tất cả là lá của bàn — thật hay bịp tuỳ bạn. Người kế tiếp chọn úp bài tiếp,
  hoặc hô **LIAR!** để lật bài người vừa đánh.
- Lật ra có lá gian → người đánh phải chơi **cò quay Nga**; toàn hàng thật → người hô LIAR bị bắt oan, tự chơi.
- Mỗi người một khẩu súng 6 ổ, 1 viên đạn ở vị trí ngẫu nhiên; mỗi lần bóp cò khả năng trúng tăng dần
  (1/6 → 1/5 → …). Trúng đạn là bị loại. Người cuối cùng còn sống thắng.
- Ai hết bài thì bỏ qua; nếu chỉ còn người hết bài để đáp lại, người đó buộc phải lật bài.
- Hết giờ lượt: máy tự úp 1 lá (hoặc tự lật bài nếu đã hết bài). Bài của bạn có dấu ✓ ở lá hàng thật.
- **Bot** đếm số lá hợp lệ còn lại để đoán ai nói dối, thường khai thật nhưng thỉnh thoảng kẹp lá gian.

## 🎩 Cờ Tỷ Phú — kiểu Business Tour (2–4 người)

Bàn 32 ô theo bố cục Business Tour, thành phố Việt Nam: Xuất phát → Điện Biên, Sơn La, Lào Cai, Sầm Sơn, Cao Bằng,
Lạng Sơn, Thái Nguyên → **Lost Island** → Kon Tum, Pleiku, Buôn Ma Thuột, Cơ hội, Vinh, Mỹ Khê, Huế →
**World Championships** → Quy Nhơn, Nha Trang, Đà Nẵng, Cơ hội, Cà Mau, Rạch Giá, Cần Thơ → **World Tour** →
Vũng Tàu, Hải Phòng, Hà Nội, Cơ hội, Biên Hòa, Tax, TP.HCM. 8 vùng (Tây Bắc, Đông Bắc, Tây Nguyên, Bắc Trung Bộ,
Nam Trung Bộ, Miền Tây, Đồng bằng sông Hồng, Đông Nam Bộ) và 4 khu nghỉ dưỡng biển (Sầm Sơn, Mỹ Khê, Nha Trang, Vũng Tàu).
Tiền tính theo nghìn ($K), mặc định khởi đầu $2.000K.

- Đổ 2 xúc xắc, ra đôi được đổ tiếp (3 lần đôi → Đảo hoang). Qua Xuất phát nhận **$300K**.
- **Mua đất kèm xây nhà ngay** (chọn cấp: đất / 1–3 nhà / khách sạn). Số nhà tối đa tăng theo số vòng đã đi;
  dừng ở thành phố của mình thì xây thêm. Sở hữu cả vùng → tiền thuê ×2. Ô có chủ hiện **tiền thuê hiện tại** theo màu chủ.
- Dừng ở đất người khác: trả tiền thuê rồi được **mua lại với giá gấp đôi** (trừ thành phố đã có khách sạn).
- **World Championship**: chọn thành phố của mình để tổ chức giải → tiền thuê ×2, ×3, ×4 (cộng dồn).
  **World Tour**: lượt sau bay tới ô bất kỳ (vé $50K). **Đảo hoang**: kẹt tối đa 3 lượt (đổ đôi / nộp $200K / vé thoát đảo).
- Thẻ **Cơ hội**: vé thoát đảo, thiên thần (miễn tiền thuê), phiếu giảm 50%, động đất (phá nhà đối thủ), xổ số, bay World Tour…
  **Cục thuế**: 10% tổng tài sản. Hết tiền thì bán thành phố cho ngân hàng (nửa giá trị), không đủ thì phá sản.
- **Thắng sớm**: độc quyền 3 vùng · độc quyền cả một cạnh bàn · sở hữu cả 4 khu nghỉ dưỡng · mọi người khác phá sản.
  Hết số vòng giới hạn (mặc định 20) → ai có tổng tài sản lớn nhất thắng.
- **Bot** giữ tiền dự phòng tăng dần, xây cấp cao nhất còn đủ tiền, mua lại đất để gom độc quyền (nhất là khi mua xong
  là thắng), tổ chức Championship ở thành phố thu nhiều tiền nhất và dùng World Tour bay tới ô có lợi.

## 🐴 Cờ Cá Ngựa (2–4 người)

Mỗi người 4 ngựa (chỉnh được 2/3/4) trong chuồng ở một góc bàn cờ. Đổ 1 xúc xắc: ra quân khi đổ **1 hoặc 6**
(hoặc chỉ 6), đổ **6** được đổ thêm. Đi đúng vào ô có ngựa đối thủ thì **đá** nó về chuồng; bật **cản đường** thì
không được nhảy qua đầu ngựa khác. Chạy hết vòng phải dừng đúng **cửa chuồng**, rồi **lên chuồng** 6 bậc — “nhảy bậc”
(đổ số nào lên bậc đó) hoặc “từng bậc” (đổ đúng bậc kế tiếp). Ai đưa đủ ngựa lên chuồng trước thì thắng.

- Bấm vào ngựa đang nhảy (hoặc ô đích tô vàng) để đi; chỉ có một nước thì máy tự đi. Phím tắt: Space đổ, 1–4 chọn ngựa.
- Thời lượng ước tính (ván với bot): 2 người × 2 ngựa ~5 phút · 4 người × 4 ngựa ~1 tiếng — chọn 2 ngựa cho ván nhanh.
- **Bot** ưu tiên đá ngựa, lên chuồng, ra quân; chạy khi bị rình và tránh dừng ngay trước mặt đối thủ.

## 🔤 Nối Từ (2–8 người)

Lần lượt nói một từ **2 tiếng** bắt đầu bằng **tiếng cuối** của từ trước: con mèo → mèo mướp → mướp đắng…
Từ phải có trong từ điển và chưa ai dùng. **Hết giờ** hoặc **chịu** thì mất 1 mạng, hết mạng bị loại; người kế
tiếp bắt đầu với từ mới. Người cuối cùng còn trụ lại thắng.

- Từ điển ~62.000 từ 2 tiếng (`games/noitu/words.txt`, tổng hợp từ undertheseanlp/dictionary và bộ cặp từ
  Noi-Tu-Discord — MIT). Không phân biệt kiểu bỏ dấu cũ/mới (hoá = hóa) và i/y (kĩ = kỹ).
- Chỉ cần gõ tiếng thứ hai; gõ sai được gõ lại. **Từ chặn** (không còn từ nào nối được) làm người sau mất mạng luôn.
- Từ đúng tiếng Việt nhưng chưa có trong từ điển có thể **xin duyệt**: quá nửa người còn lại đồng ý thì từ được tính
  và lưu vào `games/noitu/custom.txt` cho các ván sau.
- Chủ phòng chỉnh: số mạng, thời gian mỗi lượt, bật/tắt từ chặn, **độ khó bot** (dễ / vừa / khó).

## ⚡ Phản Xạ (1–10 người)

Chuỗi trò mini phản xạ nhanh & trí nhớ, **mọi người chơi cùng lúc**: ⚡ bấm nhanh khi màn hình chuyển xanh ·
🎨 đúng màu (chọn màu của chữ / nghĩa của chữ) · 🧮 tính nhẩm · 🧠 nhớ dãy ô sáng · 🔢 đếm nhanh · 👀 tìm hình khác ·
📍 nhớ vị trí. Đúng được 400–1000 điểm tuỳ tốc độ, người đúng nhanh nhất vòng +200. Hết các vòng, tổng điểm cao nhất thắng.

- Thời gian phản ứng đo trên máy người chơi (tính từ lúc đề hiện ra) nên mạng chậm không bị thiệt; đáp án giữ ở máy chủ tới lúc lật.
- Đề khó dần theo vòng (dãy dài hơn, lưới to hơn, phép tính lớn hơn). Phím tắt: Space cho vòng ⚡, 1–4 chọn đáp án.
- Chủ phòng chỉnh: số vòng (7–20), tốc độ (thường / nhanh), độ khó bot. Chơi một mình để luyện cũng được.

## 🎨 Vẽ Đoán (2–12 người)

Lần lượt từng người **vẽ** (chọn 1 trong 3 từ dễ · vừa · khó), cả phòng **đoán** qua ô Đoán. Đoán đúng càng sớm càng
nhiều điểm (+ thưởng người đoán ra đầu tiên, từ càng khó càng nhiều điểm); người vẽ được +50 cho mỗi người đoán ra.
Qua nửa thời gian lộ dần vài chữ cái. Mỗi vòng ai cũng vẽ một lần; hết số vòng, nhiều điểm nhất thắng.

- Công cụ: 16 màu, 4 cỡ bút, tẩy, đổ màu, hoàn tác (Ctrl+Z), xoá hết. Kho 444 từ quen thuộc theo 9 chủ đề (`games/vedoan/words.py`).
- Đoán không dấu cũng được, gõ gần đúng được nhắc riêng; đoán ra rồi thì tin nhắn chỉ nhóm đã đoán ra thấy (chặn lộ đáp án,
  kể cả ở kênh trò chuyện chung).
- Nét vẽ được gửi bằng tin nhắn nhẹ `{"type": "draw"}` thay vì phát lại toàn bộ trạng thái (game trả `False` từ `on_action`);
  vào giữa chừng / mất gói thì giao diện tự xin đồng bộ lại cả bức vẽ.
- Bot chỉ đoán, không vẽ. Chủ phòng chỉnh: số vòng, thời gian vẽ, chủ đề, độ giỏi của bot.

## 🕵️ Gián Điệp — kiểu “Ai là kẻ lạc loài” (3–10 người)

Mỗi người nhận một **từ khoá**; tất cả cùng một từ, riêng **1 gián điệp** nhận từ gần giống (cà phê ↔ trà sữa) — không ai
biết mình là dân hay gián điệp. Mỗi vòng lần lượt **mô tả** một câu ngắn (không được nói thẳng từ khoá), rồi cả phòng vừa
trò chuyện vừa **bỏ phiếu** loại một người; người bị loại lộ vai, hoà phiếu thì không ai bị loại.

- Loại nhầm dân → chơi tiếp. **Gián điệp bị loại** → được đoán từ của dân: đúng là gián điệp thắng, sai là dân thắng.
- Còn **1 dân và gián điệp** (1 – 1) → gián điệp thắng. Điểm: dân thắng +2 mỗi người, gián điệp thắng +5.
- Bảng mô tả theo từng vòng để mọi người soi lại; từ khoá có nút **Che** để tránh bị nhìn trộm màn hình.
- Kho 76 cặp từ (`games/giandiep/words.py`, mỗi từ kèm gợi ý cho bot). Bot mô tả bằng gợi ý, nghi người mô tả không khớp,
  biết “trà trộn” theo số đông khi nghi mình là gián điệp, bỏ qua câu mô tả nó không hiểu; bị lộ thì đoán từ của dân.
- Chủ phòng chỉnh: thời gian mô tả và bỏ phiếu, độ khó bot. Nên chơi từ 4 người (3 người thì gián điệp rất có lợi).

## ♠️ Poker — Texas Hold'em (2–9 người)

Mỗi người 2 lá tẩy + 5 lá chung trên bàn (lật dần qua **Flop · Turn · River**), ghép 5 lá tốt nhất. Có tiền
**mù nhỏ/mù lớn** xoay vòng theo nút nhà cái **D**. Đến lượt: **Bỏ bài / Xem / Theo / Tố / All-in** (No-Limit, có
thanh kéo và nút nhanh Min · ½ Pot · Pot). Còn 1 người thì ăn pot luôn; hết river thì lật bài so tay mạnh nhất.

- Tự tính **side pot** khi có người all-in, chia đều khi bằng bài; tất cả all-in thì tự lật nốt lá chung.
- Chủ phòng chỉnh: chip khởi điểm, mức mù, thời gian mỗi lượt (hết giờ tự Xem/Bỏ bài), **tăng mù gấp đôi** mỗi N ván bài.
- Hết chip bấm **Nạp lại** để vào bàn từ ván bài sau; người vào phòng giữa chừng được xếp chỗ từ ván bài kế tiếp;
  người mất kết nối tạm ngồi ngoài. Chủ phòng có thể **Kết thúc ván** bất cứ lúc nào (trả lại tiền của ván bài dở).
- **Bot** ước lượng xác suất thắng bằng mô phỏng Monte Carlo, so với tỉ lệ pot để bỏ/theo/tố, mỗi bot một
  tính cách (liều / chặt) và thỉnh thoảng bluff.

## 🔮 Bói Tarot (1–12 người)

Cả phòng cùng xem bói trong một “lều xem bói”. Mỗi lượt một người ngồi ghế xem bói, ai muốn xem thì bấm
**Xếp hàng**, xong lượt sẽ đến người kế tiếp.

1. **Đặt câu hỏi** (không bắt buộc) và **chọn cách trải bài**: 1 lá thông điệp, Quá khứ · Hiện tại · Tương lai,
   Tình yêu, Tâm · Thân · Trí, Hai lựa chọn (5 lá) hoặc Chữ thập (5 lá).
2. **Xáo bài** rồi tự tay **rút** từng lá trong xấp 78 lá úp. Mặt lá chỉ lộ ra khi lật, kể cả người rút cũng không biết trước.
3. **Lật bài**: mọi người thấy ý nghĩa từng lá theo vị trí (xuôi/ngược) và phần **Tổng quan** tự rút ra từ các lá
   (nhiều lá Ẩn Chính, chất nổi bật, nhiều lá ngược, xu hướng chung; trải 1 lá có thêm câu trả lời Có/Không).

- Đủ 78 lá (22 Ẩn Chính + 56 Ẩn Phụ), mỗi lá có ý nghĩa xuôi và ngược. Dữ liệu nằm ở `games/tarot/static/cards.json`.
- Tab **Lịch sử** lưu các lượt đã xem, tab **Bộ bài** để tra ý nghĩa từng lá.
- Chủ phòng có thể tắt lá ngược hoặc bỏ qua một lượt. Người đang xem mất kết nối quá 20 giây sẽ bị nhường lượt.
  Xem xong mà có người đang chờ thì sau 60 giây tự chuyển lượt.
- Chỉ mang tính giải trí 🙂

## Cấu trúc & thêm game mới

```
main.py                 # điểm khởi chạy
core/                   # nền tảng: phòng, người chơi, WebSocket, API
  server.py
  tls.py                # tự tạo chứng chỉ HTTPS cho mic
  game_base.py          # lớp BaseGame mà mọi game kế thừa
static/                 # trang sảnh + JS dùng chung: platform.js (kết nối), avatar.js (nhân vật), voice.js (mic),
                        #   guide.js (hướng dẫn chơi), chatbubble.js (bong bóng thoại trên đầu người chat)
                        #   cast.js + boardkit.css (dàn nhân vật, banner, nền trời cho game bàn cờ)
games/
  werewolf/             # mỗi game là một package độc lập
    __init__.py         # export GAME
    game.py             # luật chơi (server)
    bots.py             # AI cho bot
    static/             # giao diện (index.html, app.js, scene.js = cảnh đống lửa, style.css)
  uno/                  # UNO: game.py (luật), bots.py (AI), static/ (bàn chơi, bài trên tay)
  meono/                # Mèo Nổ: game.py (luật), bots.py (AI), static/
  liarbar/              # Liar's Bar: game.py (luật), bots.py (AI), static/
  poker/                # Poker: game.py (luật, cược, side pot), hands.py (tính bài), bots.py (AI), static/
  cotyphu/              # Cờ Tỷ Phú (kiểu Business Tour): game.py (luật), bots.py (AI), static/ (board.json = 32 ô)
  cangua/               # Cờ Cá Ngựa: game.py (luật), bots.py (AI), static/ (bàn cờ lưới 17×17)
  tarot/                # Bói Tarot: game.py (luật), static/ (giao diện + cards.json = 78 lá)
```

Thêm game mới: tạo `games/<ten_game>/` gồm `__init__.py` (export `GAME`), lớp kế thừa
`core.game_base.BaseGame` (cài `on_action` và `view`) và `static/index.html`. Khai báo thuộc tính `guide`
(danh sách `(tiêu đề, nội dung)`, nội dung là đoạn văn hoặc list gạch đầu dòng, hỗ trợ `**đậm**`) để game có
hướng dẫn chơi — hiện ở nút **📖 Hướng dẫn** trên sảnh và nút **❓** trong phòng (nạp `/static/guide.js`). Server tự
phát hiện, game xuất hiện trên sảnh tại `/g/<id>/`. Phía giao diện dùng
`Platform.connect({room, onState})` để kết nối và `conn.send(action, data)` để gửi hành động.
