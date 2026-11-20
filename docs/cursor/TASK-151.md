# TASK-151: sửa trùng tên skill `research-provider`

Kích thước: S. Không migration. Không đổi hành vi người dùng ngoài tên một skill nghiên cứu.

## Vấn đề (đã đọc mã, 2026-11-20)

Hai mục cùng tên `research-provider` trong `OPERATOR_SKILLS` (`apps/server/src/operator/skills.ts:18`, mảng ghép `...RESEARCH_SKILLS` ở dòng 19):

- Mục nghiên cứu: `apps/server/src/research/skills.ts:13`, `area: "tu-cai-tien"`, có `research: {kind, question, outputKinds, sources}`.
- Mục không nghiên cứu: `apps/server/src/operator/skills.ts:120-121`, `area: "nha-cung-cap"`, có tool `intel_*`, trigger "nghiên cứu nhà cung cấp".

Hệ quả đã thấy:

1. Bảo vệ `skill.name === name && !skill.research` (`autoActivation.ts:47`, `service.ts:818`, `855`, `902`) khớp mục không nghiên cứu, nên mục nghiên cứu không bao giờ tự kích hoạt. Đây là hướng an toàn, nhưng sai ý định.
2. `behaviourGate.ts:98` dùng `OPERATOR_SKILLS.find(...)`, trả về mục nghiên cứu (đứng trước), nên bản nền của tên này là mục nghiên cứu. Một skill nói về nhà cung cấp có thể bị so với bản nền khác.
3. `workspace.ts:106` ghi cả hai file (`skills/tu-cai-tien/research-provider.md` và `skills/nha-cung-cap/research-provider.md`). Không ghè nhau về đường dẫn, nhưng agent thấy hai skill cùng tên.
4. `skillVersions.ts:28` kiểm metadata nghiên cứu theo `.some(... && skill.research)`, nên mục nghiên cứu vẫn áp dụng quy tắc của nó cho mọi bản lưu tên này.

Ghi nhận: không có test nào chặn tên trùng trong `OPERATOR_SKILLS`.

## Quyết định mặc định (có thể đảo)

- Đổi tên **mục nghiên cứu** thành `research-provider-terms`. Giữ nguyên mục không nghiên cứu (`operator/skills.ts:120`), vì nó có trigger "nghiên cứu nhà cung cấp", tool `intel_*`, và tên này xuất hiện trong mô tả tool ở `agentSkillPack.test.ts:71-75`. TASK-047 ghi rõ skill này nằm ngoài phạm vi của nó, nên không dựa vào TASK-047.
- Thêm test chặn trùng tên, chạy đỏ trước khi đổi.
- Không migration có chủ đích. Các nơi có thể lưu tên cũ, đã đọc định nghĩa cột (chưa đọc dữ liệu):
  - `research_runs.skill` (`apps/server/src/db/schema.ts:2264-2266`): lịch sử nghiên cứu. Dòng cũ giữ tên `research-provider`; trang nghiên cứu hiển thị nhãn theo tên nên cần khóa cũ (bước 3).
  - `operator_skill_versions` (`schema.ts:1307`) và `operator_skill_shadow_runs.skill_name` (`schema.ts:1347`): có thể có bản mang tên cũ.
  - `skill_claims.skill` (`schema.ts:1710`) và `skill_reports.skill` (`schema.ts:1727`): cột tên `skill`, chưa rõ có chứa tên này không. Bước 5 đọc cả chúng.

## Việc cần làm

1. Trước tiên, thêm test `apps/server/test/operatorSkillNames.test.ts`: mọi `name` trong `OPERATOR_SKILLS` là duy nhất. Chạy, xác nhận đỏ với `research-provider`.
2. Đổi `name` ở `src/research/skills.ts:13` thành `research-provider-terms`. `topic` và `triggers` được suy ra từ `name` ở dòng 19-20, nên đổi theo; trigger của mục nghiên cứu cũng đổi theo. Không đổi `question`, `outputKinds`, `sources`.
3. Cập nhật `apps/web/src/features/research/ResearchPage.tsx:22` (bảng `skillLabels`): thay khóa `research-provider` bằng `research-provider-terms`, giữ nhãn tiếng Việt cũ. Giữ thêm khóa `research-provider` với cùng nhãn để dòng lịch sử vẫn có nhãn (đây là chỗ duy nhất cần giữ tên cũ).
4. Kiểm tra chuỗi tham chiếu tên cũ, rồi đổi các chỗ sau. Phạm vi grep: `apps/server/src apps/server/test apps/web/src apps/mcp/src packages/shared/src .agents/skills`. Đã thấy khi viết hướng dẫn:
   - `apps/server/src/research/skills.ts:13`: đổi (mục nghiên cứu).
   - `apps/web/src/features/research/ResearchPage.tsx:22` (bảng `skillLabels`): thêm khóa `research-provider-terms`; giữ khóa `research-provider` cùng nhãn.
   - `apps/web/src/features/research/ResearchPage.test.tsx:35`: fixture dùng `skill: "research-provider"` để kiểm dòng lịch sử cũ. Giữ nguyên fixture; đây là bằng chứng cho khóa cũ.
   - `.agents/skills/video-tu-nghien-cuu/SKILL.md:30`: liệt kê `research-provider`; đổi thành `research-provider-terms`.
   - `docs/cursor/TASK-074.md:96`: đây là tài liệu lịch sử; không sửa, chỉ ghi chú trong báo cáo.
   - `apps/server/src/operator/skills.ts:120-121` (mục không nghiên cứu) và `agentSkillPack.test.ts:71-75`: không đổi.
5. Chạy một lần đọc (không ghi) trên dữ liệu dev để xem có bản `operator_skill_versions`, `operator_skill_shadow_runs`, `skill_claims`, `skill_reports`, `research_runs` nào mang tên `research-provider` không. Nếu có bản `operator_skill_versions` mang tên này và có frontmatter nghiên cứu: dừng việc đổi tên, không kích hoạt, không đổi dữ liệu, ghi vào báo cáo và hỏi người dùng (xem mục "Hệ quả đổi tên" bên dưới). Không tự đổi dữ liệu.
6. Test và kiểm tra kiểu:
   - `apps/server`: `npx tsc -p tsconfig.json --noEmit`; `npx vitest run test/operatorSkillNames.test.ts test/operatorAutoActivation.test.ts test/operatorAutoWiring.test.ts test/agentSkillPack.test.ts`.
   - Nên thêm một ca: mục nghiên cứu `research-provider-terms` có bản shadow trong DB, không có bản `active`, bản nền là built-in, đủ điều kiện như các điều kiện khác, thì `checkAutoActivation` kích hoạt được. Lấy ca dương `research-market` (đã có trong `operatorAutoActivation.test.ts`) làm mẫu. Chứng minh đã thoát khỏi bẫy trùng tên.
   - `apps/web`: `npx vitest run src/features/research`; `npx tsc -p tsconfig.json --noEmit`.
7. Báo cáo ở `docs/tasks/TASK-151.report.md`: liệt kê file đã đổi, kết quả test, dữ liệu dev đã đọc gì.

## Hệ quả đổi tên (phải đọc trước khi làm)

Sau khi đổi, `research-provider` chỉ còn một mục: mục không nghiên cứu. Hệ quả:

- `skillVersions.ts:28` (`checkSkill`): tên `research-provider` không còn yêu cầu metadata nghiên cứu. Bản lưu theo tên cũ, nếu có frontmatter nghiên cứu, sẽ bị lệch. Đó là lý do bước 5 phải dừng nếu gặp.
- `behaviourGate.ts:98` (`OPERATOR_SKILLS.find`): bản nền của `research-provider` đổi từ mục nghiên cứu sang mục không nghiên cứu. Bản nền cũ không còn tồn tại theo tên đó.
- Guard `autoActivation.ts:47`, `service.ts:818`, `855`, `902`: giữ nguyên, nhưng với tên mới mục nghiên cứu không còn bị chặn. Đó là chủ đích.
- `run_research` (`research/service.ts:51-54`) tra tên trong `runtime.skills()` (`research/runtime.ts:55-64`), chỉ gồm mục nghiên cứu và bản DB đang `active` có metadata nghiên cứu. Sau khi đổi, `run_research` với `research-provider` bị từ chối `RESEARCH_SKILL_INVALID` (400), trừ khi có bản DB `active` mang tên cũ. Mục không nghiên cứu không đi qua đường này. Implementer phải thêm test cho việc từ chối này.
- Lịch sử `research_runs` cũ vẫn giữ `skill = 'research-provider'`. Không có chỗ nào tra lại theo tên đó ngoài nhãn trong `ResearchPage.tsx` (đã grep `apps/server/src`).
- File workspace: `workspace.ts:106` ghi `skills/tu-cai-tien/research-provider.md`. Sau khi đổi tên, file cũ có còn nằm trong workspace không? Implementer phải kiểm tra việc sync có xóa file của tên không còn tồn tại không. Nếu không, ghi vào báo cáo như một rủi ro, không tự xóa.

## Không làm

- Không commit, không push, không ghi `.done`.
- Không đổi tên mục không nghiên cứu.
- Không đụng dự án `56374fb2-54cf-48ff-9441-2e6c653295d4` hoặc `data/`.

## Mã nguồn mở có sẵn (open source)

Không áp dụng. Đây là đổi tên nội bộ và thêm một test; không thêm thư viện.

## Xong khi

- Test trùng tên xanh; không còn `research-provider` là tên của mục nghiên cứu trong mã; hai bộ test và tsc ở trên đạt; báo cáo ghi rõ những gì đã đọc và chưa xác minh.
