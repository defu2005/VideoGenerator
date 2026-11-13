# TASK-061

Ảnh của các cảnh được gán sao cho không trùng: dHash 64 bit, Hamming tối đa 6 là trùng, 7–12 là gần trùng, gán toàn cục. Ảnh có watermark theo host hoặc đường dẫn bị loại. Chế độ ảnh Tốt nhất không bị kéo về mức tiết kiệm. Khi không còn ảnh khác biệt, cảnh dùng title card. Công cụ `dedupe_scene_visuals` nằm trong danh sách quyền và cần duyệt.

Hướng dẫn người dùng đã có trong `hinh-anh-va-giong-doc.md` và nhật ký thay đổi. Bài kiểm tra đơn vị nằm ở `packages/shared/test/phash.test.ts` và các bài gán ảnh của server.

Chưa chạy lại kiểm tra trực tiếp trên giao diện trong lượt này. Không đụng dự án được bảo vệ.
