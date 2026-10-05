"""Kho từ cho Vẽ Đoán — từ dễ hình dung, quen thuộc với người Việt, chia theo chủ đề và độ khó.

Mỗi chủ đề: (tên, biểu tượng, {1: dễ, 2: vừa, 3: khó}). Muốn thêm từ chỉ cần bổ sung vào danh sách.
"""

TOPICS = {
    "convat": ("Con vật", "🐾", {
        1: "con mèo, con chó, con gà, con vịt, con cá, con heo, con bò, con trâu, con voi, con rắn, con chim, con ếch, "
           "con rùa, con thỏ, con chuột, con ong, con bướm, con kiến, con cua, con tôm, con ngựa, con khỉ, con hổ, con sư tử, "
           "con gấu, con dê, con cừu, con sóc, con nhện, con ốc sên",
        2: "con hươu cao cổ, con ngựa vằn, con chim cánh cụt, con cá heo, con cá mập, con bạch tuộc, con sứa, con cá sấu, "
           "con tê giác, con hà mã, con lạc đà, con chuột túi, con gấu trúc, con công, con cú mèo, con dơi, con muỗi, "
           "con chuồn chuồn, con ốc, con sao biển, con kỳ lân, con khủng long, con rồng, con cáo, con sói, con nhím, con vẹt",
        3: "con tắc kè, con bọ cạp, con cá ngựa, con đà điểu, con hải cẩu, con cá voi, con rết, con bọ rùa, con đom đóm, "
           "con châu chấu, con ve sầu, con hồng hạc, con tuần lộc, con lười, con thiên nga",
    }),
    "doan": ("Đồ ăn", "🍜", {
        1: "quả táo, quả chuối, quả cam, quả dưa hấu, quả nho, quả dứa, bánh mì, quả trứng, cơm, kem, bánh kem, kẹo, "
           "củ cà rốt, quả ớt, quả chanh, bắp ngô, cái bánh, xúc xích, cây kẹo mút",
        2: "phở, bánh chưng, bánh xèo, bánh bao, bún chả, xôi, nem rán, bánh trung thu, chè, trà sữa, cà phê, pizza, "
           "hamburger, khoai tây chiên, mì tôm, quả sầu riêng, quả mít, quả xoài, quả dừa, quả bơ, quả măng cụt, "
           "quả thanh long, quả dâu tây, bánh quy, bỏng ngô, sushi, gà rán",
        3: "bánh cuốn, bánh tét, bánh trôi, gỏi cuốn, cơm tấm, bún bò, bánh flan, mứt tết, nước mía, kẹo bông, "
           "quả chôm chôm, quả vải, quả na, quả khế, quả lựu, trứng ốp la, bánh tráng trộn",
    }),
    "dovat": ("Đồ vật", "🧸", {
        1: "cái bàn, cái ghế, cái giường, cái cốc, cái bát, đôi đũa, cái thìa, cái kéo, cái bút, quyển sách, cái mũ, "
           "đôi giày, cái ô, cái chìa khoá, cái đồng hồ, cái điện thoại, cái tivi, quả bóng, cái đèn, cái gương, "
           "cái lược, cái ba lô, cái cặp, ngôi sao, trái tim, cái hộp, cái chai, cái nến",
        2: "cái quạt, tủ lạnh, máy giặt, máy tính, bàn phím, con chuột máy tính, tai nghe, máy ảnh, cái kính, cái nhẫn, "
           "vòng cổ, cái thang, cái búa, cái cưa, cái đinh, cái xô, cái chổi, bàn chải đánh răng, kem đánh răng, "
           "cái gối, cái chăn, cái nồi, cái chảo, ấm trà, cái thớt, con dao, cái dĩa, cây đàn guitar, cái trống, "
           "cây sáo, cái kèn, con diều, con quay, búp bê, rô bốt, cái loa, cái micro, cục pin, bóng đèn",
        3: "nồi cơm điện, máy hút bụi, bàn là, máy sấy tóc, ổ cắm, cái chuông gió, cái khoá, cái la bàn, kính lúp, "
           "kính viễn vọng, đồng hồ cát, cái mỏ neo, cái vali, tờ lịch, cái phong bì, con tem, xúc xắc, bàn cờ, "
           "cái chong chóng, đèn lồng, đèn ông sao, mặt nạ, cái nơ, chiếc vương miện",
    }),
    "phuongtien": ("Phương tiện", "🚗", {
        1: "xe đạp, xe máy, ô tô, xe buýt, máy bay, tàu hoả, thuyền, tàu thuỷ, xe tải",
        2: "trực thăng, tàu ngầm, tên lửa, khinh khí cầu, xe cứu thương, xe cứu hoả, xe cảnh sát, xích lô, ca nô, "
           "xe lu, máy xúc, xe tăng, ván trượt, xe đạp đôi, cáp treo",
        3: "tàu vũ trụ, đĩa bay, thuyền buồm, thuyền thúng, xe ba gác, xe container, tàu lượn siêu tốc, dù lượn",
    }),
    "thiennhien": ("Thiên nhiên", "🌳", {
        1: "mặt trời, mặt trăng, đám mây, cái cây, bông hoa, ngọn núi, con sông, cơn mưa, tuyết, cầu vồng, ngọn lửa, "
           "chiếc lá, hòn đá, bãi biển",
        2: "núi lửa, thác nước, sấm sét, cơn bão, lốc xoáy, sa mạc, hòn đảo, hang động, cây dừa, xương rồng, cây nấm, "
           "hoa sen, hoa hướng dương, hoa đào, hoa mai, cây tre, ruộng lúa, giọt nước, ngôi sao băng",
        3: "nhật thực, sóng thần, động đất, bông tuyết, cực quang, rạn san hô, ruộng bậc thang, dải ngân hà, trái đất, "
           "hành tinh, sao chổi",
    }),
    "noichon": ("Địa điểm", "🏠", {
        1: "ngôi nhà, trường học, bệnh viện, cây cầu, công viên, cái chợ, sân bóng, nhà hàng",
        2: "lâu đài, kim tự tháp, tháp Eiffel, siêu thị, sân bay, bến xe, rạp chiếu phim, thư viện, nhà thờ, ngôi chùa, "
           "bể bơi, sở thú, nông trại, khách sạn, ga tàu, đèn giao thông, ngọn hải đăng",
        3: "Chùa Một Cột, Hồ Gươm, Vịnh Hạ Long, Lăng Bác, chợ nổi, cột cờ, cổng làng, giếng nước, đình làng, "
           "cối xay gió, tượng Nữ thần Tự do, Vạn Lý Trường Thành",
    }),
    "nghe": ("Nghề nghiệp & người", "👷", {
        1: "bác sĩ, cô giáo, công an, đầu bếp, ca sĩ, nông dân, em bé, ông già Noel",
        2: "phi công, lính cứu hoả, thợ xây, thợ cắt tóc, hoạ sĩ, nhiếp ảnh gia, cầu thủ, võ sĩ, phi hành gia, "
           "thợ lặn, ngư dân, chú hề, ảo thuật gia, cướp biển, siêu nhân, nàng tiên cá, ma cà rồng, người tuyết",
        3: "người máy, thám tử, xiếc thú, người ngoài hành tinh, xác ướp, ninja, cao bồi, hiệp sĩ, phù thuỷ, "
           "thần đèn, tôn ngộ không, thánh gióng",
    }),
    "hanhdong": ("Hoạt động", "🏃", {
        1: "đá bóng, bơi lội, chạy bộ, ngủ, ăn cơm, hát, nhảy múa, đọc sách, khóc, cười",
        2: "câu cá, leo núi, đạp xe, chơi cờ, thả diều, tắm biển, nấu ăn, đánh răng, chụp ảnh, trồng cây, cắm trại, "
           "trượt tuyết, lướt sóng, bắn cung, đánh cầu lông, chơi bóng rổ, tập yoga, gội đầu, quét nhà",
        3: "nhảy dù, múa lân, kéo co, ném còn, đánh đu, chơi ô ăn quan, nhảy dây, bịt mắt bắt dê, đua thuyền, "
           "gói bánh chưng, xem pháo hoa, đi chợ tết",
    }),
    "vietnam": ("Việt Nam", "🇻🇳", {
        1: "nón lá, áo dài, hoa sen, bánh chưng, cây tre",
        2: "lì xì, câu đối, pháo hoa, mâm ngũ quả, cây nêu, ông táo, cá chép, múa rối nước, đàn bầu, trống đồng, "
           "con lân, đèn lồng Hội An, xích lô, gánh hàng rong",
        3: "tò he, tranh Đông Hồ, đèn kéo quân, ông địa, áo bà ba, khăn rằn, cồng chiêng, nhà rông, nhà sàn, "
           "chùa Thiên Mụ, cầu Rồng",
    }),
}


def build():
    """Danh sách (từ, chủ đề, độ khó)."""
    out = []
    seen = set()
    for key, (_, _, levels) in TOPICS.items():
        for lv, text in levels.items():
            for w in text.split(","):
                w = " ".join(w.split())
                if w and w.lower() not in seen:
                    seen.add(w.lower())
                    out.append((w, key, lv))
    return out


WORDS = build()
