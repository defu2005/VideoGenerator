# TASK-148d — báo cáo (trạng thái: hoàn tất sau cập nhật 2026-11-19)

Ngày: 2026-11-18, cập nhật 2026-11-19. Chưa commit, chưa push. Mục "Chưa làm" 1 và 2 đã đóng ở cập nhật 2026-11-19 (xem cuối file).

## Đã làm (đã có từ Vòng 25–28)
- Module `apps/server/src/learning/queryPatterns.ts`: dạng truy vấn (tên riêng, năm, từ chung, không phải Latin, truy vấn ngắn), tag chủ đề, ghi kết quả đạt/không đạt, gợi ý tối đa 5 truy vấn.
- Nối vào `visualToolkit.ts` (ghi kết quả khi agent đánh giá ảnh), tool `visual_cache_query` trả thêm `queryHints` khi có `topic`.
- Bảng `visual_query_patterns` (migration có sẵn).
- Tài liệu người dùng, featureMap, nhật ký thay đổi, mô tả tool, ARCHITECTURE 14.1: ghi nhận từ ghi chú Vòng 28, **chưa kiểm lại trong lượt này**.

## Tag chủ đề (giới hạn đã biết, thiết kế đã chốt)
- Production truyền `project.topic` (chuỗi tự do, cột `projects.topic`) qua `topicTagFor`, chỉ chuẩn hoá hoa thường và khoảng trắng. Schema không có trường ngách (niche) hay tag chuẩn hoá nào. Vì vậy gợi ý chỉ khớp khi hai chủ đề giống hệt nhau sau khi chuẩn hoá. Đây là mục mở; chưa tạo bộ gán tag (không tự thêm tagger).

## Đã làm trong lượt này
- **Sửa xếp hạng gợi ý.** Trước đây `queryHints` cộng `accepted` qua mọi dòng dạng của cùng một truy vấn, nên truy vấn có nhiều dạng hơn được ưu tiên quá mức. Mọi dòng dạng của một truy vấn có cùng số đạt/không đạt, nên nay lấy MAX theo truy vấn (`queryPatterns.ts`, `queryHints`).
- Test hồi quy mới trong `apps/server/test/queryPatterns.test.ts`: "ranks by accepted count per query, not inflated by how many shapes the query has". Kết quả: `queryPatterns.test.ts` 5/5 pass. `tsc --noEmit` của server exit 0.

## Chưa làm, và vì sao
1. (ĐÃ ĐÓNG 2026-11-19, xem cuối file) **Khoá theo kênh (spec: "per channel and topic tag").** Bảng hiện khoá theo workspace và tag chủ đề, không có kênh. Kênh = profile id. Đã thử `drizzle-kit generate`:
   - Đã sửa một phần lệch có sẵn: `publications_mission_idx` nay được khai báo trong `schema.ts` (migration 0095 đã có index này). Generate thử không còn xoá index.
   - Còn chặn: snapshot `0095` ghi default `missions` (`[]`, `planning`) không kèm dấu nháy SQL, còn schema sinh `'[]'`, `'planning'`. Nên generate vẫn tạo lại bảng `missions`. Đây là lệch biểu diễn trong snapshot, không đổi DB.
   - Không viết tay migration. Thay đổi schema khoá kênh đã huỷ, `drizzle/` đã khôi phục từ bản sao (193 file, khớp). Ba lựa chọn và kiểm chứng DDL nằm trong `GOAL-2026-11-18.decisions.md`, mục "Lệch migration/schema".
2. **Gợi ý trong ngữ cảnh visual scout.** Đã làm (workspace + chủ đề): `visualToolkit.ts` `context()` thêm `queryHints` chỉ khi có kết quả, cùng một lời gọi `queryHints`. Chỉ khớp khi chủ đề giống hệt sau chuẩn hoá. Khi có kênh (mục 1), chỉ đổi một chỗ gọi này. Test: `agentVisualToolkit.test.ts` "TASK-148d: scout context carries accepted query hints…".

## Kiểm chứng
- `npx vitest run test/queryPatterns.test.ts`: 5/5 pass.
- `npx tsc --noEmit` (apps/server): exit 0.
- `npx tsc --noEmit` (apps/server) chạy lại sau khi thêm index `publications_mission_idx` vào `schema.ts`: exit 0.
- Suite đầy đủ apps/server (`npx vitest run`, chạy sau khi đổi schema và `queryPatterns.ts`): 225 file pass / 4 skip, 1875 test pass / 8 skip (sau khi thêm test watchdog ở 129c).
- Test scout hint mới: `agentVisualToolkit.test.ts` "TASK-148d: scout context carries accepted query hints…" pass. Cùng file và `queryPatterns.test.ts`: 23/23 pass.
- Lưu ý: `visualToolkit.context()` được gọi làm `buildContext` của stage adapter; `stages.claim` trả context này nguyên vẹn (không có mapper nào lọc `openScenes`), nên gợi ý đến được agent.

## Cập nhật 2026-11-19: khoá theo kênh và migration 0096 (đã đóng)
- Migration `apps/server/drizzle/0096_visual_query_channel.sql`: sinh bởi `drizzle-kit generate`, đã cắt mọi câu lệnh dựng lại `missions` (theo quyết định generate-then-trim của advisor). Còn lại: rebuild `visual_query_patterns` với cột `channel TEXT NOT NULL DEFAULT ''`, khoá chính `(workspace_id, channel, topic_tag, shape, example_query)`. Dòng cũ nhận `channel = ''`, không backfill. Không sửa 0093, 0095 hay file đã áp dụng.
- Chạy `drizzle-kit generate` lần hai: "No schema changes".
- Kiểm trên bản sao `data-dev/app.db` (scratchpad, không đụng DB thật): seed 2 dòng pattern và 2 dòng missions; sau migration số dòng giữ nguyên, `channel` = `''`, DDL của `missions` không đổi, `integrity_check` ok, `foreign_key_check` 0 vi phạm.
- Code: `queryPatterns.ts` nhận `channel` (mặc định `''`) cho `recordQueryOutcome` và `queryHints`. `visualToolkit.ts` truyền `project.profileId ?? ""`. Tool `visual_cache_query` không có ngữ cảnh dự án nên dùng kênh `''`: chỉ nhận gợi ý của dự án không gắn kênh, không lẫn kênh khác.
- Chủ đề: tag là `project.topic` đã chuẩn hoá (theo thiết kế, không thêm tagger).
- Test mới: "keeps hints per channel…" trong `test/queryPatterns.test.ts`. `queryPatterns.test.ts` + `agentVisualToolkit.test.ts`: 24/24 pass. `tsc --noEmit` apps/server: sạch.
- Kiểm migrator thật (2026-11-19): `migrateDatabase()` của server chạy trên bản sao mới của `data-dev/app.db`. `__drizzle_migrations` 96 → 97 dòng (đúng một dòng, 0096, `created_at` 1795063679293, lớn hơn mọi mục trước). Cột `channel` có trong `visual_query_patterns`. `integrity_check` ok, `foreign_key_check` 0.
- Các nơi đọc/ghi `visual_query_patterns`: chỉ `queryPatterns.ts` và `schema.ts`. Không có export, import hay cleanup nào khác.
- Giới hạn còn lại: `visual_cache_query` (`toolDefs.ts`) không có ngữ cảnh dự án, nên gọi `queryHints` với kênh `''`. Gợi ý theo kênh chỉ đến visual scout. Không sửa; ghi nhận là giới hạn.

## Kiểm chứng cuối (2026-11-19)
- `npx tsc --noEmit` (apps/server): exit 0.
- `npx vitest run` (apps/server, foreground): 243 file pass / 4 skip; 1956 test pass / 8 skip. Log: scratchpad `full148d.log`.
- Tất cả mục acceptance có bằng chứng: migration 0096 chạy qua `migrateDatabase()` trên bản sao; khoá kênh có test; docs đã đồng bộ (ARCHITECTURE 14.1, TASK-148.md, report này).
