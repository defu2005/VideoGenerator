# DEEP RESEARCH: AGENT SKILLS CHO QUY TRÌNH SẢN XUẤT VIDEO AI

**Phiên bản:** 1.0  
**Ngày tổng hợp:** 17/11/2026  
**Đối tượng:** AI Video Agent (storytelling, documentary, explainer, YouTube dài và Shorts)  
**Trạng thái:** Tài liệu nghiên cứu & đề xuất triển khai; **chưa** phải kết quả benchmark thực nghiệm.

> **Phạm vi:** Tổng hợp các kỹ năng viết kịch bản và các khâu tiếp theo, đánh giá nguồn Agent Skills công khai, đề xuất kiến trúc áp dụng cho ứng dụng tạo video bằng narration + ảnh tĩnh + motion/Ken Burns + subtitle + âm nhạc + FFmpeg. Các mức ưu tiên và đánh giá phù hợp là nhận định kỹ thuật của tài liệu, không phải chứng nhận chất lượng hay bảo mật của repository.

## 1. Executive summary

**Khuyến nghị trọng tâm:** không xây dựng một "siêu prompt" lo toàn bộ sản xuất. Phân rã thành những **skill ra quyết định sáng tạo**, các **tool thực thi có thể kiểm thử**, và **gate kiểm duyệt**. Trong bối cảnh video kể chuyện tự động, ba khâu đáng cải thiện trước là: (1) **kịch bản/nhịp kể**, (2) **storyboard và gán tư liệu đúng ngữ nghĩa**, (3) **motion + dựng đồng bộ với lời đọc**.

- **Creative skills:** chọn chủ đề, nghiên cứu, story structure, hook, narration, pacing, continuity, script critique.
- **Production skills:** storyboard, asset selection, visual direction, TTS, alignment, subtitle, music, motion, timeline, render.
- **Quality & operations skills:** fact-check, rights-audit, technical QC, creative QA, thumbnail, publishing, analytics, cost & retry control.

**Skill khác tool/MCP:** Skill thường là hướng dẫn quy trình (`SKILL.md`, tài liệu, script tùy chọn); tool/MCP/API là năng lực thực thi. Ví dụ `motion-director` quyết định cảnh cần parallax, còn FFmpeg/Remotion dựng hiệu ứng. Chuẩn chung tham khảo tại https://agentskills.io/. [R1]

**Định hướng triển khai:** giữ API + database ứng dụng video làm **source of truth**; Hermes/Codex/Claude là operator. Mỗi stage trả dữ liệu theo schema; duyệt tại checkpoint; chỉ invalidation/rerun phần bị thay đổi; ghi nguồn, giấy phép, chi phí và provenance.

## 2. Danh mục repository và mức độ phù hợp

Thang **1–5** biểu thị *độ phù hợp dự kiến với mục tiêu*, không phải điểm benchmark. Các repository dưới đây đã được kiểm tra ở mức trang công khai/README trong đợt tổng hợp; **chưa audit toàn bộ dependency, mã chạy, chất lượng video đầu ra hoặc giấy phép mọi thành phần**.

| Repository | Điểm (chủ quan) | Khâu nổi bật | Nhận xét triển khai |
|---|---:|---|---|
| [screenwriting-skills](https://github.com/jtydhr88/screenwriting-skills) [R2] | 5/5 | Story structure, scene, dramaturgy, dialogue | 26 skills; nhiều nội dung gốc tiếng Trung, cần điều chỉnh khi dùng lời đọc tiếng Việt. |
| [story-skills](https://github.com/danjdewhurst/story-skills) [R3] | 5/5 | Plot, worldbuilding, continuity, editorial review | 24 skills, có story bible và continuity CLI; nên trích xuất nguyên tắc, không nhất thiết nhập nguyên hệ thống. |
| [video-agent-skills](https://github.com/chenyuxiaojin/video-agent-skills) [R4] | 5/5 | Research → writer → storyboard → voice → visual → editor | Pipeline 11 skills, tham khảo handoff và checkpoint; mục tiêu gốc là DaVinci/CapCut, cần adapter cho FFmpeg. |
| [video-talkcraft](https://github.com/Vincentwei1021/video-talkcraft) [R5] | 5/5 | Word-level sync, motion recipes, chống slideshow | Tham khảo hệ thống SHOTBOOK và motion; runtime Remotion có chi phí tích hợp. |
| [Remotion skills](https://github.com/remotion-dev/skills) [R6] | 5/5 | Compositions, animation, subtitles, graphics | Nguồn chính thức; có thể dùng cho những shot đồ họa phức tạp, không buộc thay FFmpeg. |
| [faceless-channel-factory](https://github.com/TomGranot/faceless-channel-factory) [R7] | 5/5 | Rights evidence, publishing state, analytics, repair | Tập trung nguồn tư liệu và audit; phù hợp triển khai vận hành an toàn. |
| [video-production-skills](https://github.com/sb-dev/video-production-skills) [R8] | 4.5/5 | Previsualization, shot evaluation, bounded retries | Học cơ chế thay đổi nhỏ nhất, kiểm soát ngân sách, layer-based diagnosis. |
| [drama-skills](https://github.com/zenstory-ai/drama-skills) [R9] | 4.5/5 | Chuyển thể, storyboard, nhân vật, shot prompts | Mạnh khi video mang tính truyện/drama; cần giản lược với explainer. |
| [youtube-creator-skills](https://github.com/ITZSHOAIB/youtube-creator-skills) [R10] | 4.5/5 | Topic scout, fact-check, scripts, thumbnail, analytics | Hữu dụng để nối creative với hiệu quả YouTube; chú ý phân biệt dữ liệu thực và suy đoán. |
| [video-editing-skills](https://github.com/zaddy99999/video-editing-skills) [R11] | 4/5 | FFmpeg automation, captions, audio polish, render QC | Có script CLI thực thi, proof sheet, duyệt xuất bản; thiên về short-form. |
| [youtube-research-skills](https://github.com/TubeLabHQ/youtube-research-skills) [R12] | 4/5 | Niche, competitor, transcript, hooks | Phụ thuộc TubeLab MCP/tài khoản và quota; không phải toàn bộ tính năng miễn phí. |
| [youtube-researcher-skill](https://github.com/cartcodes/youtube-researcher-skill) [R13] | 4/5 | Research brief, transcript & metadata | Local-first; cần đánh giá điều khoản nền tảng trước khi tự động thu thập. |

**Cách dùng đúng:** dùng repository làm **nguồn học quy trình và thiết kế**, không mặc định clone rồi cấp quyền shell, network, credential hoặc auto-publish.

## 3. Kỹ năng viết kịch bản (đào sâu)

### 3.1 Story architecture / cấu trúc kể chuyện

**Skill đề xuất:** `story-architect`  
**Đầu vào:** topic, genre, audience, targetDuration, evidencePack, styleBible.  
**Đầu ra:** `story-outline.json` gồm thesis, chapters, beats, các câu hỏi mở, setup/payoff và luận điểm có nguồn.

Các khung nên **biết chọn**, không áp cứng:

| Kỹ thuật | Quy tắc cốt lõi | Hợp với video |
|---|---|---|
| Three-Act Structure | Setup → confrontation → resolution | Truyện, tiểu sử, kể chuyện dài |
| Save the Cat / Beat Sheet | Từng beat phục vụ chức năng cụ thể | Narrative có nhân vật |
| Story Circle | Hành trình biến đổi qua các trạng thái | Hành trình, hồi ký |
| Freytag Pyramid | Tăng căng thẳng tới đỉnh điểm, sau đó giải quyết | Truyện kịch tính |
| Mystery / Question Driven | Câu hỏi → giả thuyết → bằng chứng → đáp án | Lịch sử, bí ẩn, khoa học |
| Setup & Payoff | Giới thiệu thông tin có chủ đích và giải đáp đúng lúc | Gần như mọi thể loại |
| Open Loops | Đưa ra câu hỏi, theo dõi để **đóng** vòng lặp | Explainer, video dài |

**Checklist:** (a) video hứa trả lời điều gì? (b) mỗi chương có vai trò nào? (c) luận điểm nào cần nguồn? (d) có đoạn giữa trống rỗng? (e) những open loop đã được giải đáp? (f) kết luận có đáp ứng nhan đề và hook?

### 3.2 Hook engineering / mở đầu

**Skill:** `hook-engineer`. Sinh ít nhất 3 phương án *khác chiến thuật*, đánh giá độc lập trước khi chọn.

- **Curiosity gap:** đưa ra bất thường thật, không đánh lừa.
- **Cold open:** mở ngay tại biến cố.
- **Contradiction:** hai sự kiện trái kỳ vọng.
- **High stakes:** nêu hệ quả đáng quan tâm.
- **Question hook:** vấn đề rõ và có đáp án phù hợp với nội dung.

Rubric 0–5: sự rõ ràng, độ tò mò, mức độ chính xác, mức phù hợp khán giả, mối liên hệ giữa hook–thumbnail–title, khả năng hỗ trợ bằng tư liệu. Tránh hook đưa ra lời hứa mà script không thực hiện.

**Ví dụ diễn đạt (minh họa, không phải khẳng định lịch sử hoàn chỉnh):**

- Yếu: “Hôm nay chúng ta tìm hiểu lịch sử Đế quốc La Mã.”
- Tốt hơn: “Vì sao một đế quốc vượt qua vô số cuộc chiến lại không thể duy trì quyền lực ở phía Tây? Câu trả lời không nằm ở một trận đánh duy nhất.”

### 3.3 Narrative pacing / nhịp kể và retention

**Skill:** `narrative-pacing`. Mỗi đoạn được gán một **purpose**: reveal, setup, evidence, tension, explanation, payoff, reflection, transition. Phát hiện đoạn lặp, mở vòng lặp không đóng, giải thích thiếu tiền đề.

**Không áp máy móc** quy luật “mỗi N giây phải đổi cảnh”. Nhịp dựng phải theo ngữ nghĩa, mức độ khó của thông tin, thời lượng audio thực tế và sự thoải mái khi xem. Không nhất thiết tăng căng thẳng liên tục; đoạn nghỉ có thể giúp người xem tiếp thu.

Đề xuất đánh dấu tại beat-level: `newInformation`, `emotionalShift`, `visualChangeReason`, `openLoopsCreated`, `openLoopsResolved`, `sourceClaimIds`.

### 3.4 Narration writing / lời đọc tiếng Việt

**Skill:** `narration-writer`. Lời đọc phải **nghe tự nhiên**, khác văn bản học thuật hoặc lời tóm tắt máy móc.

- Câu đủ ngắn để đọc rõ; đa dạng tiết tấu, tránh cụm từ AI sáo rỗng.
- Chuẩn hóa số, năm, đơn vị đo, tên riêng, viết tắt theo cách phát âm.
- Chỉ dẫn tạm dừng/cảm xúc/tốc độ nằm trong metadata, không chèn vào text đưa cho TTS.
- Không tự thêm lời trích dẫn, con số hoặc sự kiện không thuộc Evidence Pack.
- Với chủ đề lịch sử/tài liệu: phân biệt dữ kiện, suy luận, ý kiến nghiên cứu và tái hiện nghệ thuật.
- Có cơ chế rewrite theo độ dài **sau khi** kiểm tra tốc độ TTS thực tế.

**Đầu ra:** `script.json` chứa segmentId, narration, purpose, emotion, claimIds, desiredPause, estimatedDurationSec. Đồng bộ kịch bản và subtitle từ **cùng một văn bản nguồn**.

### 3.5 Critic, fact-check, continuity

Tách vai trò để tránh “model tự chấm mình”:

- `script-critic`: Hook yếu, lan man, lập luận nhảy cóc, đoạn không có tác dụng, mở–kết thiếu liên hệ.
- `fact-checker`: tách claim dạng atomic, đối chiếu nguồn gốc, xử lý nguồn mâu thuẫn, gắn confidence/verificationStatus. **Không tự đánh dấu verified khi chỉ suy luận nội bộ.**
- `continuity-checker`: nhất quán niên đại, nhân vật, địa điểm, vật thể, tên riêng, voice/style, mở–đóng câu hỏi.

**Quy tắc gate:** nếu có claim quan trọng chưa kiểm chứng hoặc tài liệu xung đột, chuyển `REVIEW_REQUIRED`, không tự giả định đúng.

## 4. Kỹ năng cho toàn bộ pipeline

### 4.1 Topic & research

**Skills:** `topic-scout`, `source-researcher`, `competitor-analysis`, `evidence-pack-builder`.

- Xếp đề tài theo: audience fit, tính cấp thiết, nguồn tin cậy, khả năng tìm hình, độ khó sản xuất, quyền sử dụng.
- Không suy ra “trending” từ một nguồn hoặc vài video ít dữ liệu.
- Tạo Evidence Pack: `claimId`, câu claim, source URL, sourceType, publisher/date, verifiedAt, confidence, contradictions, approvedForNarration.
- Không coi transcript video khác là nguồn duy nhất xác nhận dữ kiện.

**Nguồn:** youtube-creator-skills [R10], youtube-researcher-skill [R13], TubeLab [R12]. TubeLab cần tài khoản/MCP và có chính sách quota, chi phí riêng.

### 4.2 Storyboard & visual direction

**Skills:** `storyboard-director`, `shot-planner`, `style-bible-manager`.

Một segment lời đọc chưa phải là một shot. Tạo cấu trúc có thể nhiều shot cho một segment hoặc nhiều segment dùng chung hình, kèm lý do biên tập.

Phân loại visual: **tư liệu gốc**, ảnh stock, document/screenshot, ảnh AI minh họa, bản đồ, timeline, chart/diagram, typography, archival video, visual trừu tượng.

Mỗi shot cần: mục đích, ý tưởng chính, framing, subject/visualFocus, source/assetCandidates, chuyển động, ước lượng thời lượng, giới hạn và trạng thái quyền sử dụng.

### 4.3 Asset discovery, ranking & provenance

**Skills:** `visual-search`, `asset-ranker`, `rights-auditor`.

Tiêu chí xếp hạng: (1) đúng ngữ nghĩa, (2) đúng thời kỳ/sự kiện/nhân vật, (3) bố cục phù hợp khung hình, (4) chất lượng kỹ thuật, (5) đồng nhất style, (6) giấy phép và bằng chứng.

**Thứ tự giá rẻ:** lọc URL/metadata/size/license → ảnh preview → vision cho nhóm shortlist khó → human review nếu nội dung lịch sử/chính trị/nhân vật thật gây hiểu nhầm. Không dùng AI để giả mạo bằng chứng lịch sử mà không chú thích.

Metadata nên lưu: `sourceUrl`, `creator`, `licenseName`, `licenseUrl`, `attribution`, `retrievedAt`, `rightsEvidence`, `generatedBy`, `promptHash`, `isIllustration`.

### 4.4 Voice/TTS, alignment, subtitle

**Skills:** `narration-director`, `tts-producer`, `speech-aligner`, `subtitle-designer`.

- TTS theo segment để retry cục bộ; ưu tiên output kèm timestamp từ provider nếu tin cậy.
- Đồng bộ timeline với thời gian audio **thực**, không dựa hoàn toàn vào tốc độ đọc ước tính.
- Có thể khảo sát [WhisperX](https://github.com/m-bain/WhisperX) cho forced alignment, nhưng cần test tiếng Việt và chi phí/CPU/GPU trước khi áp dụng.
- Subtitles: dòng vừa độ dài, ngắt theo ngữ nghĩa, safe-area 16:9/9:16, không che nội dung quan trọng; kiểm tra tràn chữ và độ lệch tiếng–hình.

### 4.5 Music & sound design

**Skills:** `sound-director`, `music-selector`, `audio-mixer`.

Agent chọn mood theo chương, vị trí vào/ra và cue; xử lý loudness, ducking, fades và kiểm tra peak bằng quy trình deterministic. Không “thêm SFX cho sinh động” nếu không có lý do. Bắt buộc lưu nguồn và giấy phép nhạc, SFX, tránh nhầm royalty-free với public domain.

### 4.6 Motion, transitions, editing

**Skills:** `motion-director`, `timeline-editor`, `transition-validator`.

Nhóm có giá trị lớn đối với video ảnh tĩnh. Tham khảo video-talkcraft [R5], Remotion skills [R6], video-production-skills [R8].

| Recipe | Mục đích chính | Điều kiện cần kiểm tra |
|---|---|---|
| Slow push-in/out | Dẫn sự chú ý và cảm xúc | Không zoom quá sâu gây pixelation |
| Ken Burns pan | Khám phá ảnh rộng | Không cắt mất chủ thể/đoạn chữ |
| Parallax layers | Tạo chiều sâu từ ảnh tĩnh | Cần phân lớp/mask tốt, tránh artifact |
| Map route animation | Hành trình, chiến dịch | Đúng địa lý và mốc thời gian |
| Timeline reveal | Sự kiện theo chuỗi | Nhãn rõ, chính xác mốc |
| Evidence highlight | Tập trung vào một dòng/tài liệu | Không gây hiểu sai bằng cách cắt ngữ cảnh |
| Split-screen | So sánh hai trường hợp | Tỷ lệ chữ/hình đủ đọc |
| Kinetic typography | Nhấn mạnh số liệu, quote | Đúng chính tả, không giấu visual |
| Match cut | Nối các thành phần tương đồng | Có liên hệ thị giác thật |
| Hard cut / dissolve / fade | Điều chỉnh nhịp | Tránh lạm dụng hiệu ứng |
| J-cut / L-cut | Tiếp diễn âm thanh qua điểm cắt | Không gây hiểu nhầm thời gian |

**Chiến lược kỹ thuật:** FFmpeg cho compositing phổ thông; có thể thêm Remotion riêng cho shot kiểu map/chart/typography phức tạp, render thành clip và ghép vào timeline chung. Đây là **đề xuất kiến trúc**, chưa phải cam kết khả năng tương thích sẵn có.

### 4.7 Render, technical QA, creative review

**Skills:** `render-engineer`, `render-qc`, `video-critic`, `repair-planner`.

- Technical: ffprobe codec/fps/ratio/duration; phát hiện black/frozen frames; audio peak/loudness; lỗi subtitle; asset thiếu; hình ngoài safe area; lỗi container.
- Creative: hình sai narration; nhịp chậm/quá nhanh; style thiếu nhất quán; voice đọc sai tên riêng; music lấn giọng; caption gây rối.
- Rủi ro cao hoặc lỗi nhiều lớp: chuyển reviewer thủ công. Agent nên mô tả **mức độ tin cậy** trong phát hiện, không tự xác nhận hoàn hảo.
- Sinh contact sheet/proof sheet để người kiểm duyệt xem nhanh trước khi render master.

**Repair tối thiểu:** sai từ → sửa TTS segment; sai ảnh → thay asset + affected timeline; sai pacing → chỉnh edit; corrupt media → sửa renderer; **không tự rerun toàn pipeline**.

### 4.8 Metadata, publishing & analytics

**Skills:** `title-strategist`, `thumbnail-strategist`, `description-writer`, `publish-auditor`, `retention-analyst`.

Tạo title/thumbnail bám đúng script; mô tả ghi credit/nguồn cần thiết; upload qua OAuth hợp lệ. Bảo vệ bằng `FINAL_APPROVAL`; mặc định publish private/draft nếu chưa được xác nhận. Lưu publish ledger (asset hash / platform ID) để tránh đăng trùng.

Sau khi có dữ liệu thực, so sánh retention, top moments, spikes/dips, CTR (có bối cảnh), phản hồi; đừng coi mối tương quan là quan hệ nhân quả. A/B test chỉ khi nền tảng/quy trình cho phép.

## 5. Bộ 18 skill nội bộ nên xây

| Priority | Skill | Deliverable | Người duyệt / gate |
|---|---|---|---|
| P0 | `topic-research` | evidence-pack.json | Nguồn/claim quan trọng |
| P0 | `story-architect` | story-outline.json | Outline approval |
| P0 | `hook-engineer` | hook-candidates.json | Script review |
| P0 | `narration-writer` | script.json | Script review |
| P0 | `script-critic` | script-critique.json | Sửa tới mức đạt rubric |
| P0 | `fact-checker` | claims-audit.json | Block claim chưa xác minh |
| P0 | `storyboard-director` | storyboard.json | Visual review |
| P0 | `visual-asset-ranker` | ranked-assets.json | Visual review |
| P0 | `motion-director` | shot-motion-plan.json | Preview check |
| P0 | `rights-auditor` | rights-report.json | Block rủi ro quyền sử dụng |
| P1 | `tts-director` | tts-plan.json | Sample voice |
| P1 | `subtitle-director` | captions.srt/ass | Subtitle QA |
| P1 | `sound-director` | audio-mix-plan.json | Music review |
| P1 | `continuity-checker` | continuity-report.json | Creative QA |
| P1 | `video-critic` | review-report.json | Final approval |
| P1 | `thumbnail-strategist` | thumbnail-brief.json | Publish review |
| P2 | `retention-analyst` | performance-retro.md | Monthly learning |
| P2 | `series-bible-manager` | series-bible.md | Approval on canon changes |

**Thứ tự P0 không có nghĩa tất cả phải thành agent riêng.** Có thể gom ở cấp orchestration và tải riêng SKILL.md theo nhiệm vụ để giảm context/token.

## 6. Tích hợp vào kiến trúc AI Video Agent

### 6.1 Ranh giới trách nhiệm

```text
Hermes / Operator / IDE Agent
  └── load SKILL.md + call MCP/REST
       ├── Research & Evidence ──> evidence-pack.json
       ├── Story + Narration ────> story-outline.json / script.json
       ├── Storyboard + Visual ──> storyboard.json / asset manifest
       ├── Voice + Timeline ────> timestamps / subtitles / shot plan
       └── QA + Publish ────────> report / approval / publish ledger
                           │
                           ▼
                    AI Video App API
           SQLite + Drizzle / queue / SSE / worker
                           │
                provider calls + FFmpeg
```

Ứng dụng quản lý artifact, trạng thái stage, inputHash, version, quota, approval; agent **không** sửa database hoặc file trạng thái tùy tiện ngoài API. MCP làm adapter `stdio → REST`. Các quyền rủi ro (publish, delete, replace file, chargeable providers) phải có xác nhận phù hợp.

### 6.2 Gate và invalidation

Gợi ý thứ tự gate: `SCRIPT_REVIEW` (mới đề xuất) → `VISUAL_REVIEW` → `MUSIC_REVIEW` → `FINAL_APPROVAL`. Nếu muốn giữ cấu hình gốc, `SCRIPT_REVIEW` có thể là một workflow check tự động/human-optional, không làm thay đổi ba gate đã có.

- Sửa narration → invalidation TTS, alignment, subtitles, timeline, render.
- Thay một ảnh → invalidation asset selection/shot affected, timeline, render; không viết lại script.
- Đổi nhạc → invalidation audio mix và render; không tự viết lại outline.
- Đổi metadata/thumbnail → không render lại video nếu nội dung video không đổi.

### 6.3 Hợp đồng dữ liệu mẫu

```json
{
  "segmentId": "seg_004",
  "narration": "Nhưng đây mới chỉ là khởi đầu của cuộc khủng hoảng.",
  "purpose": "escalation",
  "emotion": "tense",
  "claimIds": ["claim_012"],
  "visualIntent": "show rising tension",
  "visualType": "historical_map",
  "estimatedDurationSec": 4.5,
  "tts": {"pace": "deliberate", "pauseAfterMs": 400},
  "approvalState": "PENDING"
}
```

Đề xuất mỗi artifact còn có `schemaVersion`, `producerSkill`, `producerModel`, `inputHash`, `createdAt`, `costEstimate`, `sourceRefs` và `reviewerDecision` để audit và retry.

### 6.4 Bố cục skill portable

```text
<repo>/
  .agents/skills/
    story-architect/SKILL.md
    narration-writer/SKILL.md
    storyboard-director/SKILL.md
    motion-director/SKILL.md
    video-critic/SKILL.md
  docs/
    AI_VIDEO_AGENT_SKILLS_RESEARCH.md
  apps/api/...
  apps/mcp/...
```

Thư mục global và cơ chế auto-load của Hermes, Codex, Claude Code, Cursor có thể khác nhau theo phiên bản; **kiểm tra tài liệu của phiên bản đang dùng**. Ví dụ repo screenwriting-skills cung cấp đường cài đặt project-level `.agents/skills` cho Codex và `.claude/skills` cho Claude Code. [R2]

### 6.5 Skill nên chứa gì?

```yaml
---
name: narration-writer
description: Viết lời đọc tiếng Việt từ outline đã duyệt, bám bằng chứng, xuất script JSON.
---
```

Nội dung skill nên có: **trigger**, điều kiện đầu vào, các nguyên tắc biên kịch, thứ tự thao tác, schema output, ví dụ tốt/xấu, các kiểm tra tự động, điều kiện escalate, giới hạn token/cost, chính sách không tự bịa nguồn, và danh sách tool cho phép. Hạn chế hard-code API key, endpoint nội bộ và đường dẫn máy cá nhân.

## 7. Bảo mật, bản quyền, nền tảng

### 7.1 Kiểm soát cài skill bên thứ ba

1. Xem chủ repo, license, commit history, issues, code review và sự hiện diện của script thực thi.
2. Inspect mọi `SKILL.md`, `scripts/`, `package.json`, postinstall, network endpoints và nơi lưu secrets.
3. Pin commit hoặc release trước khi tích hợp; ghi provenance/version.
4. Chạy sandbox/least-privilege, tách network và credential theo stage; chỉ cấp write/publish khi cần.
5. Duyệt thủ công khi skill muốn chạy shell, truy cập dữ liệu riêng, sửa config, xóa file, upload hoặc thanh toán.

### 7.2 Bản quyền hình/nhạc/nội dung

- Phân biệt **public domain**, **CC BY**, **CC BY-SA**, **CC BY-NC**, **CC BY-ND**, stock license và “free download”; xem điều kiện bản chuyển thể/thương mại và phạm vi lãnh thổ.
- Ghi credit theo nguyên tắc TASL (Title, Author, Source, License) khi thích hợp; xem hướng dẫn Creative Commons [R14].
- `rights-auditor` phải lưu bằng chứng quyền sử dụng tại thời điểm lấy dữ liệu; **không** tự cho rằng AI-generated nghĩa là hết rủi ro.
- Với nhân vật, tác phẩm, hình ảnh có bản quyền, hoặc ảnh AI làm như bằng chứng thật: cần review theo bối cảnh và luật áp dụng.
- Copyright claim / Content ID vẫn có thể xảy ra dù đã đánh giá quyền sử dụng; không hứa an toàn tuyệt đối.

### 7.3 Chất lượng kênh YouTube

Tránh nội dung hàng loạt lặp lại không có đóng góp mới. Chọn topic/source, narration, visuals, dựng và phân tích phải thể hiện sự khác biệt có ý nghĩa giữa video. Kiểm tra chính sách YouTube hiện hành trước khi xuất bản, bao gồm nội dung tổng hợp hoặc chỉnh sửa trông như thật và nghĩa vụ công bố nếu áp dụng. [R15]

## 8. Benchmark skill thực nghiệm

### 8.1 Nguyên tắc

Dùng cùng **bộ đề bài, evidence pack, model, effort, context, temperature và chi phí tối đa** để so sánh pipeline gốc và pipeline có skill. Nên có ít nhất 10 chủ đề/độ dài/genre khác nhau. Chấm mù đầu ra nếu có reviewer. Kết quả YouTube thực tế cần thu thập đủ thời gian và kiểm soát ảnh hưởng thumbnail, traffic source, lịch đăng trước khi kết luận.

### 8.2 Rubric viết kịch bản (đề xuất)

| Tiêu chí | Trọng số | Hướng dẫn chấm |
|---|---:|---|
| Cấu trúc kể chuyện | 20% | Các beat có mục đích; không loãng đoạn giữa |
| Hook và kỳ vọng | 20% | Khơi gợi hợp lý, đáp ứng điều đã hứa |
| Độ chính xác + nguồn | 20% | Claim có evidence, không tự bịa |
| Tự nhiên khi TTS | 15% | Nhịp câu, phát âm, cách diễn đạt |
| Khả năng chuyển thành hình ảnh | 15% | Mỗi đoạn có visual intent rõ |
| Tính nguyên bản / đóng góp | 10% | Góc nhìn và tổ chức thông tin độc lập |

Điểm mỗi tiêu chí 0–5; tổng = Σ(trọng số × điểm/5). **Điểm mẫu không được coi là kết quả đã đo.**

### 8.3 KPI cho toàn video

- Tỷ lệ factual claim được xác minh và tỷ lệ bị block.
- Visual semantic match rate; tỷ lệ asset cần thay thủ công.
- Subtitle alignment error; lỗi tràn chữ; lỗi phát âm tên riêng.
- Render-QC pass rate; tỷ lệ shot phải rerender.
- Thời gian sản xuất / chi phí LLM, TTS, image, vision, render theo video.
- Số can thiệp của người và chi phí mỗi lần sửa.
- Khi đã đăng: retention ở những chương cụ thể, video average view duration, CTR có bối cảnh (không dùng một chỉ số đơn lẻ để tuyên bố thắng).

## 9. Roadmap triển khai

**Phase A — Script quality (P0):** story-architect → hook-engineer → narration-writer → script-critic → fact-checker; có rubric và 10 đề bài so sánh. Đầu ra `story-outline.json` / `script.json` / `claims-audit.json`.

**Phase B — Visual semantic quality (P0):** storyboard-director + asset-ranker + rights-auditor; chuẩn hóa visual intent, license/provenance; human VISUAL_REVIEW.

**Phase C — Motion quality (P0):** thư viện 10–15 motion recipe; timeline bám timestamp TTS; thử kết hợp Remotion cho shot đồ họa, FFmpeg cho render master; giới hạn độ phức tạp và số lần rerender.

**Phase D — QA & operations (P1):** sound-director, subtitle QA, creative critic, render-QC, bounded retry, final approval, publishing ledger.

**Phase E — Learning loop (P2):** kết nối analytics có quyền truy cập, đo hiệu quả, rút bài học có bằng chứng, cập nhật style bible/skill với version và reviewer approval.

**Definition of Done tối thiểu cho một stage:** input schema hợp lệ; output schema hợp lệ; nguồn/provenance đầy đủ; chi phí trong budget; chạy được với `mock` provider ở test; failed stage không ghi đè artifact đã duyệt; có log, retry policy và trạng thái REVIEW_REQUIRED khi chưa đủ dữ liệu.

## 10. Kết luận / quyết định đề xuất

**5 nguồn nên đọc kỹ trước:** screenwriting-skills [R2], video-agent-skills [R4], story-skills [R3], video-talkcraft [R5], Remotion skills [R6]. Với vận hành dài hạn và bản quyền, bổ sung faceless-channel-factory [R7] và video-production-skills [R8].

**Quyết định kiến trúc:** dùng Agent Skills cho **judgment** (đánh giá/ra quyết định), tool+API cho **execution** (thực thi có thể tái hiện), validator cho **correctness**, human gate cho **risk**. Tránh cài nguyên khối repository nếu mục tiêu chỉ là học kỹ thuật. Giữ pipeline free-first và ưu tiên thay đổi cục bộ.

---

## Phụ lục A. Nguồn tham khảo (URL gốc)

- **[R1]** Agent Skills specification — https://agentskills.io/
- **[R2]** screenwriting-skills — https://github.com/jtydhr88/screenwriting-skills
- **[R3]** story-skills — https://github.com/danjdewhurst/story-skills
- **[R4]** video-agent-skills — https://github.com/chenyuxiaojin/video-agent-skills
- **[R5]** video-talkcraft — https://github.com/Vincentwei1021/video-talkcraft
- **[R6]** Remotion skills — https://github.com/remotion-dev/skills ; https://github.com/remotion-dev/remotion/blob/main/packages/skills/README.md
- **[R7]** faceless-channel-factory — https://github.com/TomGranot/faceless-channel-factory
- **[R8]** video-production-skills — https://github.com/sb-dev/video-production-skills
- **[R9]** drama-skills — https://github.com/zenstory-ai/drama-skills
- **[R10]** youtube-creator-skills — https://github.com/ITZSHOAIB/youtube-creator-skills
- **[R11]** video-editing-skills — https://github.com/zaddy99999/video-editing-skills
- **[R12]** youtube-research-skills — https://github.com/TubeLabHQ/youtube-research-skills
- **[R13]** youtube-researcher-skill — https://github.com/cartcodes/youtube-researcher-skill
- **[R14]** Creative Commons best practices for attribution — https://wiki.creativecommons.org/wiki/Best_practices_for_attribution
- **[R15]** YouTube Help (policies, altered/synthetic content, monetization) — https://support.google.com/youtube/
- **[R16]** WhisperX — https://github.com/m-bain/WhisperX

## Phụ lục B. Những điều chưa kiểm chứng / việc cần làm sau nghiên cứu

1. Benchmark A/B chất lượng từng skill bằng cùng một model và 10+ video thật.
2. Audit license, dependency, script thực thi, hoạt động mạng của các repository trước khi cài.
3. Test word alignment/TTS tiếng Việt trên máy và provider thực tế.
4. Đo chi phí render/video khi thêm Remotion vào pipeline FFmpeg.
5. Xác minh đường dẫn skill và phiên bản Hermes/Codex/Claude Code đang chạy trước khi hướng dẫn cài đặt.
6. Rà soát cập nhật của chính sách YouTube và quy định bản quyền theo thị trường xuất bản trước khi đưa pipeline vào sản xuất.

*Hết tài liệu.*
