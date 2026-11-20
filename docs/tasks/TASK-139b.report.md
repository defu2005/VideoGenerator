# TASK-139b — báo cáo đo và chẩn đoán (2026-11-19)

Trạng thái: **chặn.** Ngân sách khung hình 3 s chưa đạt ổn định ở lần gọi đầu tiên trong tiến trình. Chưa có `docs/tasks/TASK-139b.done`. Việc tiếp theo thuộc về implementer (bước 4), chưa làm.

## Kết luận hiện tại

- **Steady state** (lần gọi thứ hai trở đi trong cùng một tiến trình server): khoảng **1.5 s**, đạt ngân sách 3 s. Đây là con số tạm, có căn cứ từ 3 tiến trình × 4 lần (xem bảng).
- **Lần gọi đầu tiên trong một tiến trình:** không đạt ổn định. Trong 20 lần cold (mỗi lần một tiến trình), 10 lần vượt 3 s, phạm vi 2371–3949 ms.
- Sheet và clip đạt ngân sách với biên lớn (xem bảng).
- Đường fallback (full-shot, khoảng 28 s) không đạt. Quyết định đã chốt: xem phần quyết định.

## Phương pháp

- Script: `tmp/task139-preview-benchmark.ts direct <frame|sheet|clip>`. Mỗi lần chạy là một tiến trình mới. Chuỗi chạy bằng `tmp/task139b-series.sh`; log `tmp/task139b-series.log`.
- Tải CPU và RAM đo trước và sau mỗi chuỗi (`Get-CimInstance`).
- Phạm vi: fixture tổng hợp 10 cảnh, chế độ QUALITY, đường direct (Chromium có sẵn trên máy này). Chưa đo Docker, worker node hay dự án thật. Dùng thư mục dữ liệu tạm; không chạm `data/` hay dự án `56374fb2-…`.
- Warm probe (`tmp/task139b-warm-probe.ts`): năm lần frame liên tiếp trong **một** tiến trình, `atSec` khác nhau (5.2–6.0) để tránh cache.
- Launch probe (`tmp/task139b-launch-probe.ts`): chỉ mở, chụp và đóng Chromium với cùng tham số launch như `shotRenderer.ts`.

## Số đo

### Cold, mỗi lần một tiến trình

| Thao tác | Chuỗi | Số lần | Min (ms) | Median (ms) | Max (ms) | Ngân sách (ms) | Kết quả |
|---|---|---|---|---|---|---|---|
| Frame | 1 | 10 | 2934 | 3232 | 3949 | 3000 | 7/10 vượt |
| Frame | 2 | 10 | 2371 | 2904 | 3099 | 3000 | 3/10 vượt |
| Contact sheet (10 cảnh) | 1 | 5 | 6406 | 6439 | 6637 | 20000 | đạt |
| Clip 3 s | 1 | 5 | 7499 | 7580 | 8324 | 15000 | đạt |

Thứ tự chạy, chuỗi 1 frame: 3949, 3293, 3837, 3563, 2954, 2934, 3077, 2972, 3170, 3422 ms. Bốn lần chậm nhất là bốn lần đầu, ngay sau lần đọc CPU 56%.

Chuỗi 2 frame: 2371, 2948, 2801, 3085, 2983, 2803, 3099, 3045, 2860, 2744 ms (chạy sau khi tắt hai preview server).

Tải hệ thống (CPU % / RAM trống MB):
- Chuỗi 1 frame: trước 56% / 1122; sau 3% / 1076.
- Sheet: trước 8% / 1073; sau 30% / 1172.
- Clip: trước 45% / 1178; sau 43% / 1064.
- RAM trống khoảng 1.1 GB trên 16 GB trong suốt; preview server đã tắt trước chuỗi 2.

Đây **không phải** phép đo sạch. Sheet (6439 ms) và clip (7580 ms) chậm hơn đáng kể so với số đo trước trên cùng máy (3550 và 5246 ms), nên tải nền cao hơn lần trước. Chưa cô lập được nguyên nhân. Không lần nào bị loại.

### Warm, nhiều lần gọi trong một tiến trình

| Tiến trình | Lần 1 (ms) | Lần 2–5 (ms) |
|---|---|---|
| A | 3599 | 1509, 1509, 1577, 1583 |
| B | 3167 | 1535, 1632, 1735, 1572 |
| C | 2790 | 1493, 1642, 1580, 1507 |

Lần 2–5 trong cả ba tiến trình: 1493–1735 ms. Lần đầu trong mỗi tiến trình: 2790–3599 ms.

## Chẩn đoán

**Vòng đời trình duyệt.** `apps/server/src/preview/service.ts:368` gọi `renderer.close()` sau mỗi thao tác. `PreviewShotRenderer` (`service.ts:410`) được tạo mới cho từng thao tác. Chromium **không** được giữ giữa các lần gọi preview. Trong một thao tác, các cảnh dùng chung một trình duyệt (`shotRenderer.ts:109`).

**Vì sao lần đầu chậm hơn.** `PreviewService` chỉ được tạo một lần khi khởi động server (`apps/server/src/app.ts:811`). Các chi phí chỉ trả một lần trong mỗi tiến trình gồm: import động `puppeteer-core`, quét đường dẫn trình duyệt (`previewBrowserPath`), và `assets()` trong `shotRenderer.ts` đọc và mã hóa base64 font và gsap (biến `inlineAssets`). Bằng chứng đã đo: lần đầu và các lần sau chênh khoảng 1.2–2.1 s trong cùng tiến trình. **Chưa đo từng chi phí riêng**; phần tách theo nguồn là giả thuyết cần instrumentation.

**Chi phí Chromium đã đo** (launch probe, 5 lần): launch 1127 ms ở lần đầu, sau đó khoảng 590–630 ms; chụp một trang 218–255 ms; đóng 240–320 ms. Phần Chromium chiếm khoảng 1 s mỗi lần gọi, cả lần đầu lẫn lần sau.

**Phần còn lại** trong một lần frame (ước lượng, chưa đo): dựng trang HyperFrames (`setContent`, chờ font và ảnh), biến đồ họa, và `prepare()` của service.

**Biến động không do cache.** Cùng một cảnh, cùng `atSec` 5.2, cho `lumaFlag` khác nhau (`"dark"` khoảng 25 ở 5/10 lần chuỗi 1; `null` khoảng 34 ở các lần còn lại) và phash khác nhau. Fixture chỉ có ngẫu nhiên ở UUID id (không ảnh hưởng pixel). `capture()` seek timeline về một thời điểm cố định, nên hoạt ảnh không giải thích được chênh lệch. **Nguyên nhân chưa rõ**: ghi nhận như chụp không tất định ở một thời điểm cố định. Đây là điểm cho reviewer TASK-139 (`lumaFlag` không ổn định), không chặn 139b.

## Quyết định đã chốt (advisor, 2026-11-19)

1. **Fallback** (full-shot, khoảng 28 s): là chế độ suy giảm có nhãn (`FALLBACK_NOTE`, `apps/server/src/preview/service.ts:82`), không phải mục tiêu. Chưa đặt số ngân sách riêng; chỉ có dữ liệu của 3 lần chạy fix4, chưa đo trên Docker hay worker, là nơi fallback thực sự chạy.
2. **Định nghĩa phép đo:** ngân sách 3 s áp dụng cho **mọi** lần gọi, kể cả lần đầu sau khi khởi động. Không lấy warm làm căn cứ, vì làm vậy là đổi định nghĩa để đạt số.

Hai quyết định này không phải là người dùng chấp nhận số đo. Không viết `.done`, không đổi chữ ngân sách.

## Việc còn lại (implementer, bước 4)

- Đo từng giai đoạn của lần gọi đầu (import, assets, launch, `prepare`, dựng trang, chụp, encode) trước khi thay đổi gì.
- Đưa chi phí một lần ra khỏi lần gọi đầu (ví dụ nạp trước `assets()` và đường dẫn trình duyệt khi server khởi động). Sau đó đo lại bằng cold per-process, và ghi số.
- Không đổi đường RENDER. Chạy lại `apps/server/test/preview.test.ts` và typecheck.
- `.done` chỉ viết khi ngân sách đạt cho lần gọi đầu, hoặc người dùng chấp nhận số đo.

## Bước 4 — đo lại sau warm-up (đã hoàn tất)

**Phương pháp.** Mỗi lần đo là 10 process Node mới, mỗi process render một frame (`tmp/task139-preview-benchmark.ts direct frame`) với `VG_PREVIEW_TIMING=1`.
- Baseline (`WARM=0`): không warm, gọi thẳng `service.frame`.
- Warmed (`WARM=1`): benchmark `await warmPreviewRuntime()` rồi mới chạy lần gọi có tính giờ. Đây là hành vi mong đợi của một request đến sau khi warm xong.
- Script: `tmp/task139b-step4-series.sh`. Log: `tmp/task139b-step4-baseline2.log`, `tmp/task139b-step4-warmed2.log`.
- Lần đo đầu tiên lấy nhầm dòng `"ms"` của warm-up làm thời gian frame. Đã sửa script để chỉ đọc `"kind":"frame","ms"`. Số cũ của `warmed.log` bị loại khỏi kết luận; `baseline.log` không có dòng warm nên vẫn hợp lệ.

**Kết quả (thời gian lần gọi frame đầu, ms):**

| Chế độ | median | min | max | Tải CPU trước → sau |
|---|---|---|---|---|
| Baseline (không warm) | 2919 | 2643 | 3411 | 0% → 39% |
| Warmed (warm trước lần gọi) | 2122 | 1925 | 2202 | 56% → 46% |

- Chi phí warm-up (nằm ngoài lần gọi đầu): 683–1045 ms, 10/10 `ok:true`.
- Giai đoạn `import-puppeteer` (~0.8–0.95 s) nằm trong warm-up nên không còn trong lần gọi đầu. `launch()` dùng chung promise đã memo `loadPreviewPuppeteer()` (`shotRenderer.ts:93`, `:173`), không import lần hai.
- `renderer-frames` của lần đầu: baseline khoảng 1.8–2.4 s, warmed khoảng 1.06–1.13 s. Phần giảm này cũng do import: giai đoạn `launch-wait` của baseline bao gồm việc import puppeteer (lần đầu baseline2 `launch-wait` 1951 ms ≈ import ~0.8–1.0 s + launch ~0.7 s; warmed 715 ms). Import đã chuyển sang warm-up nên `renderer-frames` của lần gọi đầu giảm theo.
- Các giai đoạn còn lại (`puppeteer-launch` ~0.6–0.85 s, `new-page`, `screenshot`, `measure-luma-hash`) không đổi vì không thuộc phần warm-up.
- Kiểm tra tổng thời gian ≥ tổng các giai đoạn chỉ làm thủ công trên vài dòng mẫu, chưa tự động hóa.

**Ngân sách 3 s cho lần gọi đầu:** đạt trong 10/10 lần warmed (max 2202 ms). Baseline vượt 3000 ms ở 4/10 lần (3411, 3081, 3070, 3194 ms). Lần baseline đầu tiên (`tmp/task139b-step4-baseline.log`, đo trước khi sửa script; không có dòng warm nên hợp lệ) cho median 2996 ms, max 3346 ms, tương đồng với lần `baseline2`.

**Giới hạn cần biết:**
- Benchmark `await` warm trước lần gọi có tính giờ. Server trong `apps/server/src/index.ts:17` chạy warm không `await` sau `listen`. Request đến trong lúc warm (khoảng 0.7–1.0 s đầu sau listen) vẫn phải chờ import. Con số 2.1 s chỉ áp dụng khi request đến sau khi warm xong.
- Hook trong `index.ts` chưa được đo qua entry của server. Mới được kiểm bằng đọc code và `apps/server/test/previewWarm.test.ts`.
- Import `puppeteer-core` chủ yếu là đánh giá module đồng bộ, nên event loop có thể bận khoảng 1 s ngay sau khi listen.
- Không thêm trình duyệt giữ sống (kept-alive). Đề xuất đó cần hỏi advisor trước.
- `puppeteer-launch` median 697 ms (warmed) so với 682 ms (baseline): không khác biệt đáng kể, nên không có chênh lệch launch cần giải thích.
- Số tải CPU đầu chuỗi (0% baseline, 56% warmed) là lấy mẫu một lần, có thể là artefact của lấy mẫu. Không dựa vào số đó để kết luận.

**Kiểm tra:**
- `npx tsc --noEmit -p apps/server`: exit 0.
- `npx vitest run test/preview.test.ts test/previewWarm.test.ts` (trong `apps/server`): 2 files, 48/48 pass.

**Trạng thái:** ngân sách 3 s đạt trên benchmark, nên `docs/tasks/TASK-139b.done` được viết. Hook server-entry chưa đo end-to-end; ghi rõ ở trên.

**Ghi nhận khác (không xử lý):** `apps/server/src/preview/` đang untracked trong git (`??`). Cần quyết định có thêm vào git hay không.
