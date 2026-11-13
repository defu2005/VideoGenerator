# BUGFIX-117: báo cáo

## Đã sửa

1. **HyperFrames treo khi stdout đầy** (`apps/server/src/compose/hyperframes.ts`)
   - Tiến trình con mở pipe stdout nhưng không ai đọc, nên khi buffer của pipe đầy thì tiến trình bị chặn và treo đến hết giờ.
   - Nay cả stdout và stderr đều được đọc liên tục. Mỗi luồng chỉ giữ 20 dòng cuối (hàm `tailCollector`), nên bộ nhớ không tăng theo dung lượng log.
   - Khi lỗi, thông báo lấy 20 dòng cuối của stderr; nếu stderr trống thì lấy stdout; nếu cả hai trống thì dùng `hyperframes thoát <mã>`.
   - `runHyperframes` được export để test.
2. **edge-tts trong Docker** (`deploy/docker/Dockerfile`, `deploy/README.md`)
   - Stage runtime cài thêm `python3`, `python3-pip`, `python3-venv`.
   - Tạo venv `/opt/edge-tts` thuộc uid 10001, chạy `pip install edge-tts` bằng user đó, liên kết `/usr/local/bin/edge-tts` và chạy `edge-tts --version` để kiểm tra khi build.
   - `EDGE_TTS_PATH` mặc định là `edge-tts` nên tìm thấy lệnh trong PATH, không cần cấu hình thêm.
   - README có mục "edge-tts trong image", gồm cách nâng cấp.

## Test

- `apps/server/test/composePlan.test.ts`, nhóm mới `runHyperframes`, dùng lệnh giả là `node` (không mạng, không CLI thật):
  - ghi hơn 1 MB ra stdout rồi thoát mã 0: phải kết thúc, không treo;
  - ghi hơn 1 MB rồi thoát mã 3: lỗi chỉ có tối đa 20 dòng và dòng cuối là `last-line`.
- `npm run typecheck`: đạt cho cả 4 workspace.
- Test compose của server (`vitest run test/composePlan.test.ts test/compose`): 89 đạt, 4 bỏ qua, 7 file đạt, 1 file bỏ qua (bỏ qua có sẵn từ trước).
- Chưa chạy `npm run build`, `npm test --workspaces` đầy đủ và chưa build image Docker (máy này không build image trong phạm vi sửa nhanh).

## Lệch so với yêu cầu / chưa làm

- `edge-tts` cài không ghim phiên bản (lấy bản mới nhất lúc build). Nếu cần build lặp lại được, hãy ghim phiên bản.
- Không đổi dependency npm, không commit, không động `.env`, `.claude/`, `data/`, `scripts/`.
- Không đổi hướng dẫn người dùng vì không có thay đổi hiển thị cho người dùng.
