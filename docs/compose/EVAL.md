# Đo compose

| Dự án | Chế độ | Cảnh | Khung | Đứng hình | Đen | Giây render / phút | Cảnh quay / phút | Entropy (bit) | Cụm cùng kiểu dài nhất | Ảnh tĩnh | Cắt đúng nhịp | Footage lệch chủ đề |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| explainer | legacy | 4 | 1026 | 4 | 0 | 1.6 | – | – | – | – | – | – |
| explainer | baseline | 4 | 1026 | 0 | 0 | 6.3 | 19.3 | 0.00 | 11 | 0% | – | 4/11 |
| explainer | rule | 4 | 1026 | 6 | 0 | 97.4 | 22.8 | 1.67 | 2 | 29% | – | 2/6 |
| explainer | rule+llm(mock) | 4 | 1026 | 5 | 0 | 86.0 | 24.6 | 1.59 | 2 | 21% | – | 2/7 |
| explainer | compose | 4 | 1026 | 6 | 0 | 85.7 | 22.8 | 1.67 | 2 | 29% | – | 0/6 |
| listicle | legacy | 5 | 965 | 5 | 0 | 1.9 | – | – | – | – | – | – |
| listicle | baseline | 5 | 965 | 1 | 0 | 10.1 | 29.8 | 0.38 | 13 | 7% | – | 8/15 |
| listicle | rule | 5 | 965 | 5 | 0 | 123.5 | 31.7 | 1.53 | 2 | 31% | – | 6/8 |
| listicle | rule+llm(mock) | 5 | 965 | 5 | 0 | 122.3 | 31.7 | 1.53 | 2 | 31% | – | 6/8 |
| listicle | compose | 5 | 965 | 4 | 0 | 121.5 | 28.0 | 1.55 | 2 | 36% | – | 0/7 |
| story | legacy | 4 | 870 | 4 | 0 | 1.6 | – | – | – | – | – | – |
| story | baseline | 4 | 870 | 0 | 0 | 5.7 | 16.6 | 0.00 | 8 | 0% | – | 4/8 |
| story | rule | 4 | 870 | 3 | 0 | 75.1 | 22.8 | 1.25 | 2 | 23% | – | 3/6 |
| story | rule+llm(mock) | 4 | 870 | 3 | 0 | 122.9 | 24.8 | 1.43 | 2 | 23% | – | 3/6 |
| story | compose | 4 | 870 | 3 | 0 | 75.2 | 22.8 | 1.25 | 2 | 23% | – | 0/6 |

HyperFrames dựng được mẫu kinetic_text trong bài đo này.

Mục tiêu (TASK-067b): entropy ≥ 1,2 bit; cụm cùng kiểu ≤ 2; ảnh tĩnh ≤ 40% khi có footage; 12–30 cảnh quay/phút (16:9) hoặc 18–40 (9:16). Dòng `rule+llm(mock)` dùng LLM giả trong `runEval.ts`, không gọi LLM thật.

Dòng `compose` là cấu hình cuối: đạo diễn luật cộng footage xếp theo nghĩa của cảnh (`rankFootage`, ngưỡng 0,45). Ba dòng trước lấy clip theo thứ tự nguồn trả về. Cột "Footage lệch chủ đề" đếm số cảnh quay footage dùng clip mà bài đo đánh dấu là không hợp cảnh, trên tổng số cảnh quay footage. Clip trong bài đo có tag kiểu Pixabay (3–4 tag), không gọi mạng.

## Đo trực tiếp (TASK-068)

| Dự án | Chế độ | Cảnh | Khung | Đứng hình | Đen | Giây render / phút |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| live 160×90 | legacy | 2 | 90 | 0 | 1 | 30 |
| live 160×90 | compose | 2 | 90 | 0 | 0 | 50 |

Dòng live: project `e92375f4-c69e-40fb-9063-ad0baff92002`, video 3 giây, không gọi khóa footage. Compose: 2 cảnh, 40 cảnh/phút, ảnh tĩnh 100%, cắt đúng nhịp 0%. Ba khung đầu, giữa, cuối của cả hai bản: chữ "Xin chao" nằm dưới, không đè chữ khác. Cảnh 2 không có ảnh nên khung giữa và cuối tối.

## Bốn kiểu đồ hoạ (TASK-070b)

Luật đạo diễn chọn thêm bốn kiểu khi lời thoại khớp và đồ hoạ không tắt. Cả nhóm đồ hoạ vẫn không quá 30% thời lượng.

| Kiểu | Khi nào | Độ dài |
| --- | --- | --- |
| map | Dạng giải thích hoặc điểm tin, và lời thoại nêu một nước hoặc một tỉnh có trong file địa giới | 2,5–7 giây |
| compare | Lời thoại có hai vế (`so với`, `khác với`, `trước … sau`, `compared to`, `versus`, `before … after`), hoặc dạng sự thật và hiểu lầm | 2,5–6 giây, hoặc từ 2 giây khi hai vế hiện cùng lúc |
| quote_full | Câu trong ngoặc kép dài 6–28 từ và có tên người nói | 3–10 giây |
| list_full | Dạng danh sách hoặc hướng dẫn, và có 3–6 mục ngắn | 0,8×số mục + 0,8 giây, tối đa 12 giây |

Đạo diễn AI nhận cùng quy tắc trong prompt, mã `m`, `v`, `q`, `l`. Payload không đúng hợp đồng thì đoạn đó lùi về chữ động hoặc ảnh. Kiểm tra trực tiếp 070b chạy ở ECO nên bốn kiểu này bằng 0 trong video mẫu; khung từng kiểu đã được dựng ở TASK-070.

## Đồ hoạ off / static / animated (TASK-075)

1080×1920, cache lạnh, một cảnh quay đồ hoạ một lúc. Dự đoán từ RESEARCH-075 (giây render / phút video).

| Dự án | Chế độ | Đồ hoạ | Đo (s/phút) | Dự đoán (s/phút) |
| --- | --- | --- | ---: | ---: |
| explainer | ECO | off | 43.0 | 33.4 |
| explainer | BALANCED | static | 126.5 | 36.3 |
| explainer | QUALITY | animated | 144.5 | 105.8 |
| listicle | ECO | off | 46.8 | 35.4 |
| listicle | BALANCED | static | 160.1 | 40.3 |
| listicle | QUALITY | animated | 191.1 | 115.3 |
| story | ECO | off | 41.9 | 31.1 |
| story | BALANCED | static | 101.9 | 33.8 |
| story | QUALITY | animated | 119.5 | 71.3 |
