"""Kho cặp từ cho Gián Điệp: hai từ gần giống nhau — phe thường nhận một từ, gián điệp nhận từ còn lại.

Mỗi dòng: "từ A: gợi ý, gợi ý… | từ B: gợi ý, gợi ý…". Gợi ý dùng cho bot mô tả và bot suy luận (ai mô tả
khớp với từ của mình thì đáng tin hơn); người chơi không thấy danh sách này. Thêm cặp mới chỉ cần thêm một dòng.
"""

RAW = """
cà phê: đắng, buổi sáng, phin, tỉnh ngủ, quán vỉa hè, sữa đá | trà sữa: trân châu, ống hút, ngọt, giới trẻ, đá, size L
phở: nước dùng, bánh dẻo, hành lá, Hà Nội, bò tái, buổi sáng | bún bò: Huế, sả, cay, sợi to, chả cua, buổi sáng
bánh mì: giòn, pate, buổi sáng, vỉa hè, kẹp thịt, nóng | bánh bao: hấp, trứng cút, mềm, nóng, xe đẩy, nhân thịt
bánh chưng: Tết, lá dong, vuông, đậu xanh, gói, luộc lâu | bánh tét: Tết, miền Nam, tròn dài, lá chuối, đậu xanh, gói
kem: lạnh, mùa hè, que, ốc quế, ngọt, tan | sữa chua: lạnh, chua, hũ, men, ngọt, tốt cho bụng
coca: có ga, lon, đen, ngọt, sủi bọt, uống lạnh | bia: có ga, lon, nhậu, cụng ly, men, uống lạnh
mì tôm: gói, nhanh, nước sôi, sinh viên, cay, ba phút | cháo: ốm, loãng, gạo, nóng, thìa, dễ ăn
gà rán: giòn, dầu, đùi, KFC, cay, tay cầm | gà luộc: cúng, lá chanh, trắng, Tết, chặt, muối tiêu
xoài: vàng, chua, mùa hè, chấm muối, ngọt, hạt to | đu đủ: vàng, nhiều hạt, ngọt, chín, xanh nộm, bổ
dưa hấu: đỏ, nhiều nước, hạt đen, mùa hè, to, Tết | dưa lưới: vân, ngọt, xanh, đắt, nhiều nước, mùa hè
sầu riêng: gai, mùi nồng, béo, đắt, miền Tây, vua trái cây | mít: gai, múi, vàng, dính nhựa, to, thơm
cam: tròn, vắt, vitamin, nước ép, chua ngọt, bóc vỏ | quýt: tròn, nhỏ, bóc vỏ, Tết, chua ngọt, múi
nước mắm: mặn, chấm, cá, chai, Phú Quốc, mùi | xì dầu: mặn, chấm, đậu nành, chai, đen, nấu
cơm tấm: sườn, miền Nam, gạo vỡ, bì chả, mỡ hành, trưa | cơm rang: chảo, trứng, nhanh, cơm nguội, dầu, xào
---
chó: sủa, trung thành, đuôi, giữ nhà, xương, đi dạo | mèo: kêu, chuột, lười, đuôi, móng vuốt, liếm lông
gà: gáy, trứng, buổi sáng, mổ thóc, lông, sân vườn | vịt: bơi, trứng, kêu cạc, mỏ dẹt, ao, lông
hổ: sọc, rừng, ăn thịt, gầm, dữ, mạnh | sư tử: bờm, chúa tể, gầm, ăn thịt, châu Phi, mạnh
voi: to, vòi, ngà, nặng, Tây Nguyên, tai to | hà mã: to, nặng, nước, miệng to, châu Phi, mập
cá heo: biển, thông minh, nhảy, bơi, xiếc, đáng yêu | cá mập: biển, răng, nguy hiểm, bơi, vây, phim
khỉ: chuối, leo cây, nghịch, đuôi, rừng, tinh nghịch | vượn: leo cây, rừng, tay dài, hú, thông minh, giống người
thỏ: tai dài, cà rốt, nhảy, trắng, nhanh, dễ thương | chuột hamster: nhỏ, lồng, má phồng, chạy vòng, thú cưng, dễ thương
ong: mật, đốt, bay, hoa, vo ve, tổ | bướm: cánh, hoa, bay, màu sắc, sâu, đẹp
muỗi: đốt, vo ve, ban đêm, ngứa, sốt xuất huyết, bay | ruồi: vo ve, bẩn, bay, đậu, thức ăn, đập
rùa: chậm, mai, sống lâu, nước, bò, cứng | ốc sên: chậm, vỏ, nhớt, bò, mưa, sừng
---
bác sĩ: bệnh viện, áo trắng, khám, thuốc, ống nghe, chữa bệnh | y tá: bệnh viện, áo trắng, tiêm, chăm sóc, trực đêm, thuốc
giáo viên: trường, bảng, phấn, học sinh, giảng bài, chấm điểm | gia sư: dạy kèm, học sinh, tại nhà, bài tập, kiếm thêm, tiết
công an: còi, giao thông, phạt, đồng phục, an ninh, bắt | bảo vệ: cổng, gác, đồng phục, đêm, giữ xe, an ninh
ca sĩ: hát, micro, sân khấu, fan, album, nổi tiếng | diễn viên: phim, vai, sân khấu, nổi tiếng, kịch bản, máy quay
đầu bếp: nấu, bếp, mũ trắng, nhà hàng, dao, món ăn | thợ bánh: lò nướng, bột, kem, ngọt, sáng sớm, bánh kem
phi công: máy bay, bầu trời, buồng lái, đồng phục, bay, sân bay | tiếp viên: máy bay, đồng phục, phục vụ, đẹp, sân bay, xe đẩy
cầu thủ: bóng, sân cỏ, ghi bàn, áo số, đội, chạy | trọng tài: còi, thẻ, sân, phạt, công bằng, áo đen
xe ôm: xe máy, mũ bảo hiểm, đầu ngõ, chở khách, Grab, mặc cả | taxi: ô tô, đồng hồ, chở khách, sân bay, Grab, gọi
---
xe máy: hai bánh, xăng, mũ bảo hiểm, đi làm, tắc đường, Honda | xe đạp: hai bánh, đạp, không xăng, học sinh, thể dục, xích
máy bay: bay, sân bay, vé, cánh, phi công, nhanh | trực thăng: bay, cánh quạt, cứu hộ, nhỏ, ồn, bay thẳng lên
tàu hoả: đường ray, ga, toa, Bắc Nam, còi, chậm | tàu điện: đường ray, thành phố, ga, nhanh, điện, Cát Linh
xe buýt: trạm, vé tháng, đông, học sinh, tuyến, to | xe khách: bến xe, đường dài, giường nằm, về quê, Tết, to
thuyền: nước, chèo, nhỏ, sông, câu cá, gỗ | ca nô: nước, nhanh, động cơ, biển, sóng, nhỏ
---
điện thoại: màn hình, gọi, nhắn tin, sạc, túi, ứng dụng | máy tính bảng: màn hình, to, sạc, xem phim, cảm ứng, iPad
tivi: màn hình, phòng khách, điều khiển, xem phim, thời sự, to | máy chiếu: màn chiếu, phòng họp, tối, bóng đèn, thuyết trình, to
tủ lạnh: lạnh, bếp, thức ăn, đá, điện, cửa | điều hoà: lạnh, mùa hè, điều khiển, tiền điện, phòng, gió
quạt: gió, mùa hè, cánh, điện, bàn, mát | máy sấy tóc: gió, nóng, tóc, ồn, phòng tắm, điện
bút bi: viết, mực, học sinh, bấm, xanh, ngòi | bút chì: viết, gọt, tẩy, vẽ, gỗ, học sinh
sách: trang, đọc, thư viện, chữ, giấy, kiến thức | vở: trang, viết, học sinh, ô li, giấy, bài tập
gối: ngủ, mềm, giường, đầu, bông, ôm | chăn: ngủ, mềm, giường, ấm, mùa đông, đắp
bàn chải đánh răng: sáng, răng, lông, kem, phòng tắm, tối | lược: tóc, chải, răng nhỏ, gương, buổi sáng, nhựa
ô: mưa, nắng, gấp, cán, che, mở | áo mưa: mưa, mặc, ni lông, xe máy, gấp, che
kính râm: nắng, mắt, đen, thời trang, biển, che | kính cận: mắt, nhìn rõ, gọng, học sinh, độ, đeo
đồng hồ: giờ, kim, tay, báo thức, pin, đeo | lịch: ngày, tháng, treo tường, xé, Tết, năm
gương: soi, phản chiếu, phòng tắm, kính, trang điểm, vỡ | cửa sổ: kính, nhìn ra, gió, rèm, mở, nhà
nến: lửa, sinh nhật, sáp, mất điện, thổi, sáng | đèn pin: sáng, pin, mất điện, cầm tay, tối, bấm
---
biển: sóng, cát, muối, mùa hè, tắm, xanh | hồ bơi: nước, bơi, mùa hè, clo, xanh, tắm
núi: cao, leo, đỉnh, mây, trekking, đá | đồi: cao, cỏ, thấp, leo, chè, xanh
mưa: ướt, nước, ô, mây đen, mùa, lạnh | tuyết: lạnh, trắng, mùa đông, Sa Pa, rơi, người tuyết
mặt trời: nóng, sáng, ban ngày, mọc, vàng, nắng | mặt trăng: ban đêm, tròn, Trung Thu, sáng, khuyết, vàng
hoa hồng: đỏ, gai, tình yêu, Valentine, thơm, tặng | hoa ly: trắng, thơm, cắm bình, Tết, to, tặng
hoa sen: hồ, hồng, quốc hoa, thơm, đầm, mùa hè | hoa súng: hồ, nước, tím, nổi, ao, cánh
cây tre: làng, xanh, đốt, thẳng, Thánh Gióng, rỗng | cây chuối: lá to, quả, vườn, xanh, buồng, nõn
---
Tết: pháo hoa, lì xì, bánh chưng, sum họp, đầu năm, áo mới | Trung Thu: đèn lồng, bánh, trăng, trẻ em, múa lân, rằm
sinh nhật: bánh kem, nến, quà, tuổi, hát, thổi | đám cưới: cô dâu, chú rể, tiệc, phong bì, váy, hai họ
Giáng sinh: ông già, cây thông, quà, tuyết, tháng mười hai, nhà thờ | Halloween: bí ngô, ma, hoá trang, kẹo, tháng mười, đêm
du lịch: đi chơi, vali, khách sạn, chụp ảnh, nghỉ, vé | cắm trại: lều, lửa, ngoài trời, nướng, bạn bè, đêm
---
bóng đá: sân, cầu thủ, ghi bàn, World Cup, đội, trọng tài | bóng chuyền: lưới, đập, đội, sân, nhảy, đỡ
cầu lông: vợt, lưới, quả cầu, đánh, sân, nhẹ | bóng bàn: vợt, lưới, bàn, quả bóng nhỏ, nhanh, đánh
bơi lội: nước, hồ bơi, kính, mùa hè, sải, thể thao | lặn: nước, biển, bình khí, sâu, san hô, kính
chạy bộ: giày, sáng sớm, công viên, mồ hôi, marathon, khoẻ | đi bộ: chậm, công viên, giày, buổi tối, khoẻ, chân
cờ tướng: quân, bàn cờ, tướng, ván, vỉa hè, suy nghĩ | cờ vua: quân, bàn cờ, vua, hậu, ván, suy nghĩ
---
trường học: học sinh, lớp, giáo viên, bảng, sân, trống | thư viện: sách, yên tĩnh, đọc, mượn, kệ, thẻ
bệnh viện: bác sĩ, ốm, thuốc, giường, cấp cứu, trắng | nhà thuốc: thuốc, mua, dược sĩ, đơn, tủ kính, đau đầu
chợ: mặc cả, đông, rau, cá, sáng sớm, bà bán | siêu thị: xe đẩy, quầy tính tiền, điều hoà, kệ, khuyến mãi, đông
rạp chiếu phim: tối, màn hình, bỏng ngô, vé, ghế, phim | nhà hát: sân khấu, vé, ghế, kịch, diễn viên, rèm
quán cà phê: đồ uống, ngồi, wifi, nhạc, hẹn hò, ghế | quán trà chanh: vỉa hè, ghế nhựa, đồ uống, rẻ, giới trẻ, tán gẫu
sân bay: máy bay, vé, vali, check in, chờ, an ninh | ga tàu: tàu, vé, đường ray, chờ, hành lý, sân ga
---
Facebook: mạng xã hội, like, bình luận, ảnh, bạn bè, story | Zalo: nhắn tin, gọi, bạn bè, Việt Nam, nhóm, mạng xã hội
YouTube: video, xem, kênh, đăng ký, quảng cáo, like | TikTok: video ngắn, lướt, nhảy, giới trẻ, xu hướng, like
game: chơi, điện thoại, máy tính, giải trí, thắng, level | phim: xem, rạp, diễn viên, giải trí, tập, kịch bản
selfie: chụp, điện thoại, mặt, sống ảo, góc, ảnh | livestream: trực tiếp, điện thoại, bán hàng, bình luận, quay, mạng
""".strip()


def build():
    """Danh sách cặp [(từ, [gợi ý…]), (từ, [gợi ý…])]."""
    pairs = []
    for line in RAW.splitlines():
        line = line.strip()
        if not line or line.startswith("---"):
            continue
        sides = []
        for part in line.split("|"):
            word, _, hints = part.partition(":")
            sides.append((word.strip(), [h.strip() for h in hints.split(",") if h.strip()]))
        if len(sides) == 2:
            pairs.append(tuple(sides))
    return pairs


PAIRS = build()
GENERIC = ["cái này quen lắm", "ai cũng biết", "hay gặp hằng ngày", "mình thích cái này", "dễ thấy lắm",
           "nhiều người dùng", "khó tả quá", "có ở Việt Nam", "mua được", "trẻ em cũng biết"]
