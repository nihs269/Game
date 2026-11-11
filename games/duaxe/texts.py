"""Kho đoạn văn cho Đua Xe Gõ Phím: ca dao, tục ngữ (văn học dân gian) và các đoạn văn ngắn tự viết.

Chỉ dùng dấu câu thường (, . ! ? : -) và một dấu cách giữa các từ để ai cũng gõ được.
"""

SHORT = [
    "Có công mài sắt, có ngày nên kim.",
    "Ăn quả nhớ kẻ trồng cây, uống nước nhớ nguồn.",
    "Một cây làm chẳng nên non, ba cây chụm lại nên hòn núi cao.",
    "Gần mực thì đen, gần đèn thì sáng.",
    "Tốt gỗ hơn tốt nước sơn, xấu người đẹp nết còn hơn đẹp người.",
    "Lời nói chẳng mất tiền mua, lựa lời mà nói cho vừa lòng nhau.",
    "Học ăn, học nói, học gói, học mở.",
    "Không thầy đố mày làm nên.",
    "Đi một ngày đàng, học một sàng khôn.",
    "Nước chảy đá mòn, kiến tha lâu cũng đầy tổ.",
    "Bầu ơi thương lấy bí cùng, tuy rằng khác giống nhưng chung một giàn.",
    "Muốn sang thì bắc cầu kiều, muốn con hay chữ thì yêu lấy thầy.",
    "Công cha như núi Thái Sơn, nghĩa mẹ như nước trong nguồn chảy ra.",
    "Thất bại là mẹ thành công.",
    "Chim có tổ, người có tông.",
    "Uốn cây từ thuở còn non, dạy con từ thuở con còn ngây thơ.",
    "Ai ơi bưng bát cơm đầy, dẻo thơm một hạt đắng cay muôn phần.",
    "Trăm nghe không bằng một thấy.",
    "Một miếng khi đói bằng một gói khi no.",
    "Người ta là hoa đất.",
    "Bán anh em xa, mua láng giềng gần.",
    "Cái nết đánh chết cái đẹp.",
    "Mưa dầm thấm lâu.",
    "Ăn có nhai, nói có nghĩ.",
    "Đường đi khó không khó vì ngăn sông cách núi, mà khó vì lòng người ngại núi e sông.",
    "Sáng nay trời trong xanh, gió nhẹ thổi qua hàng cây trước ngõ.",
    "Con mèo nhà em rất lười, suốt ngày chỉ nằm phơi nắng ngoài hiên.",
    "Chiếc xe đỏ lao vút qua khúc cua, bỏ lại phía sau một đám bụi mù.",
    "Gõ phím nhanh không khó, chỉ cần luyện tập đều đặn mỗi ngày.",
    "Ly cà phê sữa đá buổi sáng giúp cả ngày thêm tỉnh táo.",
]

MEDIUM = [
    "Trong đầm gì đẹp bằng sen, lá xanh bông trắng lại chen nhị vàng. Nhị vàng bông trắng lá xanh, gần bùn mà chẳng hôi tanh mùi bùn.",
    "Ru con con ngủ cho lâu, để mẹ đi cấy đồng sâu chưa về. Bắt được con cá rô trê, tròng cổ mang về cho con ăn cơm.",
    "Đường vô xứ Nghệ quanh quanh, non xanh nước biếc như tranh họa đồ. Ai vô xứ Nghệ thì vô.",
    "Thân em như hạt mưa sa, hạt vào đài các, hạt ra ruộng cày. Thân em như tấm lụa đào, phất phơ giữa chợ biết vào tay ai.",
    "Gió đưa cành trúc la đà, tiếng chuông Trấn Vũ, canh gà Thọ Xương. Mịt mù khói tỏa ngàn sương, nhịp chày Yên Thái, mặt gương Tây Hồ.",
    "Cày đồng đang buổi ban trưa, mồ hôi thánh thót như mưa ruộng cày. Ai ơi bưng bát cơm đầy, dẻo thơm một hạt đắng cay muôn phần.",
    "Chiều chiều ra đứng ngõ sau, trông về quê mẹ ruột đau chín chiều. Ví dầu cầu ván đóng đinh, cầu tre lắt lẻo gập ghềnh khó đi.",
    "Mỗi buổi sáng, khu chợ nhỏ đầu làng lại rộn ràng tiếng nói cười. Người bán rau, người bán cá, ai cũng tất bật nhưng vẫn không quên hỏi han nhau vài câu.",
    "Cơn mưa đầu hạ đến thật bất ngờ. Lũ trẻ trong xóm reo hò chạy ra sân, mặc cho mẹ gọi vào. Mùi đất ẩm bốc lên thơm nồng, cây cối như bừng tỉnh sau những ngày nắng gắt.",
    "Hà Nội vào thu có một vẻ đẹp rất riêng. Gió heo may se lạnh, lá vàng rơi đầy trên những con phố nhỏ, và mùi hoa sữa thoang thoảng khắp nơi mỗi khi chiều xuống.",
    "Chiếc xe đua màu xanh rời vạch xuất phát trong tiếng động cơ gầm vang. Tay lái siết chặt vô lăng, mắt dán vào đường đua, chỉ còn ba vòng nữa là về đích.",
    "Muốn gõ phím nhanh, hãy đặt hai ngón trỏ lên phím F và J, nhìn màn hình thay vì nhìn bàn phím. Lúc đầu sẽ chậm, nhưng chỉ sau vài tuần bạn sẽ thấy mình tiến bộ rõ rệt.",
    "Bà nội em năm nay đã ngoài tám mươi tuổi nhưng vẫn còn rất minh mẫn. Mỗi tối bà thường kể cho chúng em nghe những câu chuyện cổ tích, giọng bà ấm áp và chậm rãi.",
    "Tết đến, cả nhà quây quần bên nồi bánh chưng nghi ngút khói. Ông ngồi canh lửa, bố chẻ thêm củi, còn mẹ bày mâm ngũ quả lên bàn thờ tổ tiên.",
    "Biển Nha Trang buổi sớm mai đẹp như một bức tranh. Mặt trời nhô lên từ phía chân trời, nhuộm hồng cả một vùng nước rộng. Những chiếc thuyền đánh cá lần lượt trở về bến.",
    "Thằng Bờm có cái quạt mo, phú ông xin đổi ba bò chín trâu. Bờm rằng Bờm chẳng lấy trâu, phú ông xin đổi một xâu cá mè.",
    "Con gà cục tác lá chanh, con lợn ủn ỉn mua hành cho tôi. Con chó khóc đứng khóc ngồi, mẹ ơi đi chợ mua tôi đồng riềng.",
    "Trên con đèo quanh co, đoàn xe máy nối đuôi nhau chậm rãi leo dốc. Hai bên đường là những ruộng bậc thang vàng óng, xa xa thấp thoáng vài nóc nhà sàn.",
]

LONG = [
    "Làng tôi nằm bên một con sông nhỏ, nước trong vắt quanh năm. Mùa hè, lũ trẻ chúng tôi rủ nhau ra bến tắm, thi nhau bơi qua bờ bên kia. Chiều về, người lớn dắt trâu xuống sông uống nước, tiếng cười nói vang cả một khúc sông. Bây giờ đi xa, mỗi lần nhớ quê là tôi lại nhớ con sông ấy.",
    "Cuộc đua bắt đầu khi đèn xanh vừa bật. Mười chiếc xe lao lên như những mũi tên, tiếng lốp rít trên mặt đường nóng bỏng. Ở khúc cua đầu tiên, chiếc xe số bảy vượt lên dẫn đầu, nhưng ngay sau đó đã bị chiếc xe màu cam bám sát. Khán giả trên khán đài đứng cả dậy, hò reo không ngớt. Không ai biết ai sẽ là người về đích đầu tiên.",
    "Mỗi sáng thứ hai, cả trường tập trung dưới sân để chào cờ. Thầy hiệu trưởng thường nhắc nhở chúng em về nội quy và khen ngợi những bạn đạt thành tích tốt trong tuần. Sau đó là phần văn nghệ của các lớp, có khi là một bài hát, có khi là một tiết mục múa. Tiếng trống trường vang lên báo hiệu một tuần học mới lại bắt đầu.",
    "Phở là một món ăn quen thuộc của người Việt. Một bát phở ngon cần có nước dùng trong, ngọt thanh từ xương hầm nhiều giờ, bánh phở mềm mà không nát, thịt bò thái mỏng và một chút hành, rau thơm. Buổi sáng mùa đông, ngồi bên quán vỉa hè, thổi nhẹ bát phở nóng hổi là một trong những niềm vui giản dị nhất.",
    "Ngày xưa có một chàng trai nghèo tên là Khoai, làm thuê cho một lão nhà giàu. Lão hứa nếu chàng làm việc chăm chỉ trong ba năm thì sẽ gả con gái cho. Hết ba năm, lão lại bắt chàng vào rừng tìm cây tre trăm đốt. Chàng tìm mãi không được, ngồi khóc thì Bụt hiện lên và dạy cho chàng câu thần chú khắc nhập, khắc xuất.",
    "Muốn trở thành người gõ phím giỏi, điều quan trọng nhất không phải là tốc độ mà là sự chính xác. Khi đã quen tay, tốc độ sẽ tự tăng lên. Hãy ngồi thẳng lưng, thả lỏng vai, đặt ngón tay đúng vị trí và cố gắng không nhìn xuống bàn phím. Mỗi ngày chỉ cần luyện mười lăm phút, sau một tháng bạn sẽ ngạc nhiên vì sự tiến bộ của chính mình.",
    "Sài Gòn về đêm sáng rực ánh đèn. Dòng xe cộ nối nhau không dứt trên những con đường lớn, còn trong các con hẻm nhỏ thì vang lên tiếng rao của người bán hàng rong. Quán cà phê nào cũng đông khách, người ta ngồi trò chuyện, xem bóng đá hay chỉ đơn giản là ngắm phố phường. Thành phố này dường như chẳng bao giờ ngủ.",
    "Mùa lúa chín, cả cánh đồng như được trải một tấm thảm vàng. Gió thổi qua, những bông lúa nặng hạt nghiêng mình xào xạc. Từ sáng sớm, bà con trong xóm đã ra đồng gặt, tiếng cười nói rộn ràng khắp nơi. Đến trưa, ai nấy ngồi nghỉ dưới bóng cây, chia nhau nắm cơm, quả trứng và bình nước chè xanh mát lạnh.",
    "Con chó nhà tôi tên là Mực, lông đen tuyền và đôi mắt rất tinh. Mỗi chiều tôi đi học về, từ đầu ngõ đã thấy nó chạy ra vẫy đuôi mừng rỡ. Có lần tôi bị ốm phải nằm nhà mấy ngày, Mực cứ nằm ngay dưới chân giường, không chịu đi đâu. Với tôi, nó không chỉ là một con vật nuôi mà còn là một người bạn thân thiết.",
    "Trên đỉnh núi cao, sương mù phủ kín từ sáng đến trưa. Những người leo núi phải đi thật chậm, bám vào từng tảng đá để khỏi trượt chân. Càng lên cao, không khí càng loãng và lạnh. Nhưng khi đặt chân lên đỉnh, nhìn mây trắng bồng bềnh dưới chân và dãy núi trùng điệp trải dài đến tận chân trời, mọi mệt mỏi dường như tan biến.",
]

POOLS = {"short": SHORT, "medium": MEDIUM, "long": LONG}
