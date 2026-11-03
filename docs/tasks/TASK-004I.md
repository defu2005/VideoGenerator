# TASK-004I — Xem token tiêu thụ theo video và theo quá trình

> Trạng thái: **ghi chú / chưa giao**. Yêu cầu của user (2026-11-03): "thêm tính năng xem token tiêu thụ theo video và quá trình".

## GOAL
Cho user thấy mỗi video (project) đã tốn bao nhiêu token / lượt gọi LLM, chia theo:
- **quá trình** (stage: research, script, scenes, visuals, … render),
- **tác vụ LLM** (research, script, scriptReview, sceneQueries, visualRerank, visionCheck, …),
- **provider / model**,
- **từng lần chạy** (job, kể cả chạy lại / retry / fallback).

Và một trang tổng toàn app (theo ngày / tháng, theo provider).

## CONTEXT — dữ liệu đã có
- Mỗi job lưu `usage` (`JobUsageSchema`, `packages/shared/src/schemas/job.ts`): tổng `llmCalls`, `inputTokens`, `outputTokens`, `costUsd`, `tokensUnknown`, và từ TASK-004F là `calls[]` (task, provider, model, input/output tokens, premiumRequests, cached, fallback, ok).
- Job có `projectId`, `stage`, `scope` (vd sceneId), `startedAt`, `finishedAt`, `attempt`.
- ⇒ **Không cần ghi thêm dữ liệu cho LLM**. Đây là việc tổng hợp (aggregate) + UI. 0 LLM call.

## REQUIREMENTS

### 1. Tổng hợp (server, code thuần)
- `apps/server/src/services/usageService.ts`: đọc jobs (kể cả job lỗi / bị hủy, vì token đã tốn), cộng dồn từ `usage.calls` (nếu job cũ không có `calls`, dùng tổng của job và gán task = stage).
- Quy ước:
  - `cached: true` → đếm riêng (lượt gọi tiết kiệm được), **không** cộng token.
  - `tokensUnknown` (vd copilot-cli không báo token) → hiển thị "không rõ" + số premium request, không coi là 0.
  - `fallback: true` / `ok: false` → vẫn cộng (đã tốn), có cờ để UI tách.
  - `costUsd` là ước tính; CLI dùng subscription (claude-cli, copilot-cli, antigravity-cli) → cost 0 nhưng vẫn hiện token.
- Không thêm bảng mới nếu query trên `jobs` đủ nhanh (index `project_id` đã có). Nếu cần bảng phẳng `llm_calls` thì sinh migration bằng drizzle-kit, kèm backfill từ `jobs.usage`.

### 2. API
- `GET /api/projects/:id/usage` → `{ totals, byStage[], byTask[], byModel[], runs[] }`
  - `runs[]`: mỗi job có LLM call: jobId, stage, scope, attempt, status, startedAt, durationMs, tokens, calls[].
- `GET /api/usage?from&to&groupBy=day|provider|model|project` → tổng toàn app.
- Schema zod trong `packages/shared`.

### 3. UI (tiếng Việt)
- **Trang project → tab "Token"** (hoặc khối trong tab tổng quan):
  - Thẻ tổng: token vào / ra, số lượt gọi, lượt dùng cache, lượt dự phòng, chi phí ước tính.
  - Bảng/biểu đồ thanh theo **quá trình** (stage), bấm vào stage → các tác vụ + từng lần chạy.
  - Bảng theo model.
  - So với **ước tính trước khi chạy** (`/budget-estimate` của TASK-004E): "ước tính ~N lượt, thực tế M lượt".
- **Danh sách project / dashboard:** cột hoặc badge tổng token mỗi video.
- **Trang "Mô hình AI"** (hoặc trang "Mức dùng" mới): tổng theo ngày / tháng, theo provider/model, top video tốn nhiều nhất.
- Responsive 375 / 768 / 1280 px. Số lớn định dạng `12.3K`.
- Cập nhật trực tiếp qua SSE khi job đang chạy (đã có event job).

### 4. MCP
- Tool `get_project_usage(projectId)` trả cùng dữ liệu như API.

## DO NOT
- Không gọi LLM. Không thêm dependency (biểu đồ vẽ bằng CSS/SVG). Không tự viết tay migration. Không commit.

## ACCEPTANCE CRITERIA
1. Typecheck, build, test, drizzle-kit (không thay đổi, hoặc migration sinh đúng), audit 0.
2. Unit test cộng dồn: cached, tokensUnknown, fallback, job lỗi, job cũ không có `calls`, nhiều attempt.
3. Live (architect): chạy 1 project BALANCED với claude-cli → số liệu tab Token khớp tổng `usage.calls` trong DB; stage visuals hiện riêng rerank.

## REPORT BACK
`docs/tasks/TASK-004I.report.md` + file rỗng `docs/tasks/TASK-004I.done`.
