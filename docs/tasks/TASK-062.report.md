# TASK-062

`planCrop` cắt theo tỉ lệ: cùng tỉ lệ thì giữ 9/10 mỗi cạnh, tỉ lệ khác thì lấy khung lớn nhất đúng tỉ lệ. Cắt chỉ chạy khi được gọi, không chạy trong pipeline. Ảnh đã cắt tay không bị ghi đè. `crop_scene_images` cần duyệt.

Hướng dẫn nằm ở mục Cắt ảnh. Bài kiểm tra: `packages/shared/test/crop.test.ts`, `smartcrop.test.ts`, `apps/server/test/imageCrop.test.ts`.

Chưa chạy lại kiểm tra trực tiếp trên giao diện trong lượt này.
