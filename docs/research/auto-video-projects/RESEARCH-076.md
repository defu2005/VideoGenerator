# RESEARCH-076 — Khảo sát project tự động tạo video

**Ngày:** 2026-11-16  
**Phạm vi:** khảo sát các project mã nguồn mở tạo video tự động, faceless video, podcast-to-Shorts, agentic editing và storyboard/video generation.  
**Mục tiêu:** tìm tính năng và bài học mà project hiện tại chưa có hoặc chưa đóng gói thành trải nghiệm sản phẩm.

## Tóm tắt điều hành

Project hiện tại mạnh hơn phần lớn project được khảo sát về control plane, stage checkpoint, retry, gate, quota, provider routing, worker/node, policy và audit.

Các project bên ngoài thường mạnh hơn ở đường đi ngắn từ ý tưởng đến video dùng được:

- demo chạy ngay, local-first và không cần API key;
- batch topic và nhiều format video có sẵn;
- podcast/video dài → Shorts;
- quality loop: tạo → chấm → sửa → chạy lại;
- preview frame nhanh cho agent tự kiểm tra;
- character/style bible và continuity;
- timeline/editor có thể chỉnh trực tiếp;
- đóng gói title, thumbnail, metadata và publish thành một deliverable.

Khuyến nghị lớn nhất: bổ sung lớp **recipe + evaluation + repair**, không thay thế kiến trúc stage/worker hiện tại.

## Bảng project đã khảo sát

| Project | Điểm đáng học | Liên quan trực tiếp |
|---|---|---|
| [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) | WebUI/API/CLI/Agent, batch, custom input, local Whisper, voice reference, scene version/reuse, 1:1 | UX local, batch, subtitle và scene editing |
| [OpenReels](https://github.com/tsensei/OpenReels) | Research-grounded script, vision-verified stock, retry ảnh, AI music, critic tự chấm và rerun | Quality loop, visual verification |
| [PurffleShorts](https://github.com/Chamanrajragu/purffle-shorts) | Reddit/chat/dialogue/gameplay/podcast/article, second-pass script review, multilingual, publish/schedule, MCP | Recipe theo content type, Shorts |
| [AutoShorts](https://github.com/shubhxtech/AutoShorts) | Local-only, podcast-to-Shorts, Whisper, face tracking, active speaker, render master rồi tạo variants, MCP review | Clip factory, privacy mode, preview |
| [Automated Video Generator](https://github.com/itsPremKumar/Automated-Video-Generator) | Script/JSON/prompt → local voice + stock → MP4, thumbnail, scene data, one-click/Docker/MCP | Demo path, artifact bundle |
| [AI Video Editor](https://github.com/sahandghavidel/ai-video-editor) | Scene-based production, reusable templates, dubbing, thumbnail variants, YouTube assets | Workspace/editor, multilingual |
| [OpenDirector](https://github.com/ThinkFlowLab/OpenDirector) | Canvas, reference assets, image presets, timeline, JSON/FCPXML/asset bundle | Editable project và asset graph |
| [ShortsFlow](https://github.com/ghost1412/shorts-generator) | Podcast-to-Shorts, face tracking, active speaker, benchmark cho clip quality | Evaluation harness |
| [Azelia Clips](https://github.com/anju2246/azelia-clips) | Finder/Critic/Ranker, face tracking, reframe, analytics-aware ranking | Multi-agent curation |
| [Story2Video](https://github.com/approximatelylinear/story2video) | Story → storyboard, style/color consistency pass | Visual continuity |
| [OpenVideoStudio](https://github.com/mne03005-png/OpenVideoStudio) | Storyboard, character/environment identity, keyframes, face-similarity QC | Character bible |
| [FTL Studio](https://github.com/uby174/ftl-studio) | Canon character still làm anchor cho các shot | Multi-shot consistency |
| [Kimo](https://github.com/ronak-create/FableCut) | Agent sửa timeline, render frame tại timecode, tự nhìn và sửa trước export | Agent self-verification |

## Các tính năng project hiện tại còn thiếu hoặc chưa hoàn thiện

### P0 — Nên ưu tiên

#### 1. Quality loop có critic và repair

```text
generate → score → explain → repair → rerender impacted stages → score again
```

Nên có điểm và bằng chứng cho script, visual, audio, subtitle và render; giới hạn số vòng, token và chi phí. Không cho agent sửa vô hạn.

#### 2. Podcast/video dài → Shorts

Pipeline đề xuất:

```text
source video → transcript → highlight candidates → rank → active speaker/face tracking
→ smart reframe → captions → review → schedule
```

Đây nên là pipeline riêng, không ép vào pipeline topic → video mới.

#### 3. Clip evaluation harness

Các metric nên kiểm:

- mở đầu đứng độc lập;
- không cắt giữa từ/câu;
- không overlap;
- gần độ dài mục tiêu;
- face được tìm và căn đúng;
- speaker đang nói được ưu tiên;
- subtitle nằm trong safe area;
- title không nói quá nội dung;
- không trùng clip đã đăng.

#### 4. Frame preview nhanh cho agent

Trước full render, cho phép render:

- một frame tại timecode;
- 3 giây đầu;
- contact sheet;
- đoạn subtitle dày nhất;
- đoạn có transition.

Agent có thể xem và sửa crop, text, màu, timing trước khi tiêu tốn full render.

#### 5. Director pass và continuity plan

Trước visual search/render, tạo plan có:

- shot type/camera;
- subject/action/location;
- visual priority;
- transition;
- asset type;
- continuity constraints.

Điều này giúp các scene không tự sinh prompt rời rạc.

### P1 — Nên làm tiếp

#### 6. Recipe theo content type

Tách `contentType` khỏi `presentationFormat`.

Content type:

- explainer;
- Reddit/story;
- chat;
- dialogue hai giọng;
- podcast;
- news;
- gameplay;
- article/PDF.

Presentation format:

- 9:16 / 16:9 / 1:1;
- caption style;
- stock/image/video/gameplay;
- host/no-host;
- voice/music preset.

#### 7. Character/brand bible

```text
canonical references
→ style/color/wardrobe rules
→ per-scene prompt constraints
→ similarity/continuity score
→ drift reason and repair
```

Nên mở rộng từ style pack/originality hiện tại thành identity có thể dùng lại giữa nhiều video.

#### 8. Local-only mode và demo không cần key

Preset đề xuất:

```text
LOCAL_ONLY:
- không gửi script/audio ra cloud
- chỉ dùng model/node local
- không provider trả phí
- hiển thị model và dữ liệu đã dùng
```

Thêm một demo project không cần key, không publish, không đụng project thật.

#### 9. Master render → nhiều variant

Tái sử dụng scene clips/intermediate để tạo:

- 9:16, 16:9, 1:1;
- nhiều caption style;
- nhiều thumbnail;
- nhiều ngôn ngữ.

Không render lại toàn bộ từ source nếu master assets chưa đổi.

#### 10. Dubbing đa ngôn ngữ theo cùng master

Giữ visual/timeline khi có thể; thay script dịch, TTS, subtitle, metadata và lịch đăng theo locale.

#### 11. YouTube asset bundle

```text
video.mp4
thumbnail variants
title
description
tags
chapters
credits
publish config
```

Cho người dùng review toàn bộ package một lần trước khi đăng.

#### 12. Timeline/editable project tối giản

Không cần thành Premiere clone. Chỉ cần sửa scene, start/end, speed, volume, caption style, asset và export project bundle.

## Tính năng không nên bê nguyên

- Một process chạy toàn pipeline: nhanh cho local nhưng không phù hợp với gate, retry, lease và nhiều node.
- Gửi toàn bộ API key/secret tới worker: trái với vault và lease-secret hiện tại.
- Chỉ tăng số lượng provider: ưu tiên capability, chất lượng, quota, chi phí và fallback.
- Dùng LLM để thay các phép đo cơ học: timing, loudness, silence, crop và duplicate vẫn nên kiểm bằng code.
- Tự động publish không có quality gate và user confirmation.

## Đề xuất roadmap gộp

### Đợt A — Feedback loop

1. `qualityScore` theo stage.
2. Critic report có evidence.
3. Repair plan giới hạn vòng.
4. Frame/contact-sheet preview.
5. Clip evaluation harness.

### Đợt B — Shorts factory

1. Import video/podcast.
2. Whisper/transcript.
3. Highlight candidates.
4. Face tracking/active speaker.
5. Smart reframe và nhiều clip.
6. Review, approve/reject, schedule.

### Đợt C — Identity và đa định dạng

1. Character/brand bible.
2. Director pass/continuity.
3. Content type recipes.
4. Master render và variants.
5. Dubbing đa ngôn ngữ.

### Đợt D — Trải nghiệm sản phẩm

1. Demo không cần key.
2. `LOCAL_ONLY`.
3. CLI/headless.
4. Timeline editor tối giản.
5. YouTube asset bundle.

## Đánh giá license và sử dụng mã nguồn

Các repository được khảo sát có license khác nhau và trạng thái phát triển khác nhau. Danh sách trên chỉ là nguồn tham khảo tính năng. Không thêm dependency hoặc copy code trước khi:

1. kiểm tra license trong repository cụ thể;
2. kiểm tra commit/release và mức duy trì;
3. đối chiếu với quy tắc open-source trong `docs/cursor/README.md`;
4. ghi rõ nguồn, license và quyết định dùng dependency, vendor hay chỉ mượn ý tưởng.

## Kết luận

Hướng nâng cấp có giá trị nhất không phải là thêm thật nhiều provider hay thay control plane. Đó là xây lớp:

```text
Recipe
  → Director plan
  → Stage execution
  → Measured quality
  → Evidence-based repair
  → Variant/publish bundle
```

Repo hiện tại đã có nền tảng stage, checkpoint, worker, agent, routing và quality gate để làm việc này. Các project bên ngoài cung cấp những mẫu UX và vòng lặp sản phẩm ngắn hơn; nên học các mẫu đó rồi tích hợp vào kiến trúc hiện tại.
