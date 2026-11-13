# TASK-063

App đọc `SKILL.md` dạng YAML gấp hoặc literal, bỏ qua symlink, file lớn hơn 64KB và skill không thuộc operator. Skill trong repo được đồng bộ vào workspace. `find_skills` và `read_skill` chỉ đọc, không thêm quyền.

Nội dung hướng dẫn nằm trong `tro-ly-va-telegram.md` (mục kỹ năng repo) vì danh sách trang hướng dẫn là danh sách đóng. Bảy skill `video-*` đã có trong `.agents/skills`. Bài kiểm tra: `skillParse.test.ts`, `repoSkills.test.ts`.

Chưa chạy lại kiểm tra trực tiếp trên giao diện trong lượt này.
