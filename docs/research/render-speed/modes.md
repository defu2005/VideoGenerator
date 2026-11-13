# Mode đồ hoạ đề xuất cho TASK-075

Ngày kiểm/đo: **2026-11-11**. Đây là đề xuất để Claude chốt Decisions; chưa đổi budget preset hay code app.

| Mode | Default composeGraphics | FPS / grain | Render resource default | Đánh đổi |
|---|---|---|---|---|
| ECO | off | Không tạo graphic shot; footage/still vẫn 30 fps | 1 shot, không browser cho graphics | Mất typography/chart đầy màn hình; giữ nội dung/cut/word ranges khi chuyển nguồn |
| BALANCED | static | PNG finished-state, ffmpeg 30 fps, fade 0,2 s/zoom nhẹ; grain tắt | Browser/session dùng lại cho final PNG; encode CPU | Giữ thiết kế và số cuối; mất chữ xuất hiện theo lời/counter |
| QUALITY | animated | 30 fps, grain tắt, MP4 standard (CRF18/medium), JPEG95 | 1 worker/shot; prototype producer API; concurrency 1 trên máy dùng chung | Giữ GSAP, layout, accent, đúng nhịp; bỏ texture grain |
| MAX | animated | 30 fps, grain theo variant 1; MP4 standard/JPEG95; không tăng DPR | Như QUALITY, có thể bật concurrency 2 sau kiểm RAM | Giữ texture; chi phí tăng, không cần alpha cho full-scene |
| CUSTOM | QUALITY làm điểm khởi đầu | off/static/animated; 15/24/30 fps, grain, concurrency có trần | Tôn trọng tổng CPU/RAM, cache tách config | Hiện ước tính và preview; không để auto workers × shot concurrency nhân RAM |

Hạ fps là lựa chọn thử nghiệm CUSTOM: 15 fps có bước 66,7 ms và lặp frame lên 30; 24 fps có cadence 24→30. Các median đầu không thắng 30 fps ổn định sau tính chuyển đổi. Không chọn fps thấp làm cách tăng tốc mặc định. Grain không đồng nghĩa chất lượng nội dung; user có thể tắt ngay cả ở MAX.

## Dự báo cho ba fixture ở 1080×1920

**Các số sau là mô hình từ microbenchmark, không phải chạy render end-to-end ba video 1080p.** Cùng nội dung/shot plan lịch sử rule-director part 1, không gọi LLM; ảnh/footage synthetic. Giữ source aspect/preset khi dựng plan để đối chiếu EVAL cũ, sau đó mô hình output target 1080×1920; không coi đây là plan re-direct mới theo aspect portrait. Lúc replay đặt rankFootage:false vì working tree đã có ranking part 3, source fixture rỗng tags không còn qua filter mới. File fixture source SHA-256: 5a980fdb9813c0ddeefd18963c97a72b91723ab0eba08d5aa66041968e3277bc.

| Fixture | Video s | Scenes / shots | Kinetic / chart / footage / still | Tổng graphic s |
|---|---:|---|---|---:|
| explainer | 34.200 | 4 / 13 | 1 / 2 / 6 / 4 | 7.780 |
| listicle | 32.167 | 5 / 17 | 4 / 0 / 8 / 5 | 7.560 |
| story | 29.000 | 4 / 11 | 2 / 0 / 6 / 3 | 3.340 |

| Mode / path | Explainer s/min | Listicle s/min | Story s/min | Loại con số |
|---|---:|---:|---:|---|
| ECO | 33.4 | 35.4 | 31.1 | Dự báo compose, cold cache, tuần tự |
| BALANCED | 36.3 | 40.3 | 33.8 | Dự báo compose, cold cache, tuần tự |
| QUALITY | 105.8 | 115.3 | 71.3 | Dự báo compose, cold cache, tuần tự |
| MAX | 129.8 | 139.3 | 83.1 | Dự báo compose, cold cache, tuần tự |
| Cũ WebM v0 + encode | 163.7 | 177.1 | 102.9 | Dự báo compose, cold cache, tuần tự |

CUSTOM không có một giá trị cố định: chọn thông số tương ứng rồi dùng công thức dưới. Nếu chọn QUALITY thì cùng dòng QUALITY, nếu off/static thì cùng dòng đó. Nhánh WebM v0 là mốc so sánh optimistic cho đường cũ; variant 1 thực tế có thể chậm hơn đáng kể.

### Hệ số và công thức tái lập

Giây/shot 3 s: kinetic opaque v0 standard/API 17.107, chart opaque v0 standard/API 17.014, kinetic grain v1 22.209, chart grain v1 22.338, still 1.487, footage 0.773, extra graphic encode 0.584, scene concat 0.572. PNG cold K/C=0.836/0.745 s; static-motion K/C=1.221/1.242 s.

- Animated mới: C(d)=2,5+(C3−2,5)×d/3 (prototype API); mốc cũ CLI dùng intercept 5 s. Đây là **giả định mô hình** từ module/browser/page, không phải fit nhiều duration; chưa đo shot 1/5/10 s. Thời gian âm bị clamp 0.
- Still/footage: C(d)=0,15+(C3−0,15)×d/3; static: PNG cold + 0,10+(motion3−0,10)×d/3. Các intercept là giả định process cost, cần hiệu chỉnh bằng telemetry.
- Scene concat: cộng 0,10 mỗi scene + (concat3−0,10)×videoSec/3. Tổng project = tổng shot + concat. Chuẩn hoá ×60/videoSec.
- ECO thay tất cả graphics thành still (giả định fallback cho dự báo, không đọc kho tài sản); vẫn cùng duration/word ranges. QUALITY dùng chi phí layout v0 không grain. MAX dùng v1/grain như kịch bản texture nặng, không giả vờ đã đo mọi mix variant 0/1/2 và mọi chart type. Chi phí variant 2: null, chưa đo.
- Đã cộng pass extra encode ở mốc cũ; các mode MP4 giả định TASK-075 bỏ pass đó khi clip đã đúng resolution/fps/frames/pix_fmt/codec. Nếu vẫn giữ pass, cộng extra encode theo graphic duration. Không nhận gain đó trước khi kiểm output stream thực.

Sai số chưa thể cho khoảng tin cậy thống kê: chỉ ba lượt/mẫu, tải nền dao động, số từ/độ phức tạp ảnh/source video khác thực tế. Đề xuất UI hiện khoảng dự phòng **±40% như heuristic**, không gọi là CI; báo thêm tải hiện tại và cache-hit status. Preset quality tên standard của HF được đo thêm vì draft MP4 thực tế là ultrafast CRF28; không khuyên dùng draft cho QUALITY/MAX chỉ để lấy số nhanh. Projection giả định wrapper API trong cùng process với config giống prototype; nếu chỉ đổi CLI format, standard qua CLI chưa đo riêng (null), cần hiệu chỉnh startup. Concurrency đã đo bằng draft, chưa benchmark lại premium song song. Các số chưa bao gồm tải ảnh/footage, LLM/TTS, subtitle burn-in, nhạc/voice mix, render gate scan và mux cuối toàn video. Thời gian full pipeline tương ứng: **null**, chưa đo. Không dùng bảng này hứa tổng SLA.

### Mục tiêu video 10 phút

Nhân s/min ở bảng trên với 10 chỉ cho chi phí compose với mật độ shot tương đương. Chọn QUALITY 30 fps/opaque là hướng giữ chất lượng, BALANCED static khi cần nhanh. Dùng cache đúng cho lần sửa; không giảm fps hay độ phân giải ngầm. Browser anchor tái dùng đã xác nhận nhưng chưa thắng median default; không trừ thêm gain warm browser vào model. Kiểm lại opt-in EVAL 1080p cho từng mode trước khi đặt kỳ vọng 10 phút dưới một giờ; throughput nhóm song song không được trừ vào dự báo tuần tự này.

## Song song, cache và nghiệm thu trước khi bật mặc định


- Mặc định 1 shot trên máy đang dùng chung 16 GiB; concurrency 2 là lựa chọn giới hạn khi đủ RAM, đo nhóm ở profile.md. Chỉ cân nhắc 3/4 khi máy rảnh và headroom đủ; không dùng auto=16. Nếu memory thấp hạ về 1. Mốc headroom cụ thể là policy đề xuất, chưa là threshold đã nghiệm thu.
- Cache key phải có render mode/fps/format/quality/grain, màu/ngôn ngữ/variant và version/font/template/GSAP. Sửa scene cache thiếu context trước; không đổi sang text-only key.
- Static prototype có ngắt dòng khác HF animated dù cùng HTML/vars; nguyên nhân chưa chốt (null), nên không coi pixel-equivalent. Static phải chờ fonts + layout + timeline ready và seek finished state (duration−hold hoặc trạng thái finish rõ), không chụp last frame sau fade-out. Kiểm dấu tiếng Việt, safe zone, text contrast, giá trị biểu đồ và frame count.
- Opaque MP4 chỉ cho compose full-scene có nền kín; alpha overlay khác vẫn giữ format cần thiết. Stream-copy concat chỉ sau kiểm codec/timebase/size/pix_fmt và chính xác số frame; chưa benchmark concat -c copy, không cộng gain giả.
- Golden images/short previews cho 15/24/30 và static, test 90 frame/3 s, cache invalidation khi đổi màu/lang/mode/font, cùng retry/timeout/cancellation/cleanup. Prototype native nhanh nhưng layout khác; chưa phải lựa chọn production.

## Nguồn

Kế hoạch fixture từ [runEval.ts](../../../apps/server/src/compose/eval/runEval.ts), [EVAL.md](../../compose/EVAL.md), budget modes từ [modes.ts](../../../packages/shared/src/budget/modes.ts), kiểm 2026-11-11. Dữ liệu đo/nguồn kỹ thuật: [profile.md](profile.md), [alternatives.md](alternatives.md). Các estimate là inference nội bộ, không phải benchmark upstream.
