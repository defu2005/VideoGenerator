import { estimateBudget, FORMAT_RECIPES, FORMAT_RECIPE_IDS, recommendBrief, resolveBudget, type BriefSettings, type BudgetFeatures } from "@vg/shared";
import type { ReactNode } from "react";

type BriefField = keyof Omit<BriefSettings, "subtitles" | "music" | "userSet">;

export function BriefFields({
  topic,
  settings,
  onChange,
  onReset,
}: {
  topic: string;
  settings: BriefSettings;
  onChange: (path: string, value: string | number | boolean) => void;
  onReset: (path: string) => void;
}) {
  const result = recommendBrief({ topic, settings });
  const budgetFeatures = resolveBudget(settings.budget);
  const budgetEstimate = estimateBudget({ topic, settings });

  function field(path: string, label: string, control: ReactNode) {
    const recommendation = result.recommendations[path] ?? {
      source: "user" as const,
      reason: "Custom budget feature",
    };
    const isFull = path === "format";
    return (
      <div className={`form-field brief-field${isFull ? " brief-field-full" : ""}`} key={path}>
        <span>
          <span>{label}</span>
          {recommendation.source === "recommended" ? (
            <span className="recommendation-badge" title={recommendation.reason} aria-hidden="true">Gợi ý</span>
          ) : (
            <button className="recommendation-reset" type="button" aria-label={`Reset ${label} to recommendation`} onClick={() => onReset(path)}>↺</button>
          )}
        </span>
        {control}
        <small className="field-hint" title={recommendation.reason}>{recommendation.reason}</small>
      </div>
    );
  }

  function select<T extends string>(
    path: BriefField | "tone" | "audience" | "visualStyle",
    label: string,
    choices: readonly T[],
  ) {
    const value = result.recommendations[path].value as T;
    return field(path, label, (
      <select aria-label={label} value={value} onChange={(event) => onChange(path, event.target.value)}>
        {choices.map((choice) => <option key={choice} value={choice}>{choice.replaceAll("_", " ")}</option>)}
      </select>
    ));
  }

  const resolved = result.values.settings;
  const customFeature = <K extends keyof BudgetFeatures>(key: K, value: BudgetFeatures[K]) => {
    const path = `budget.features.${key}`;
    const labels: Partial<Record<keyof BudgetFeatures, string>> = {
      knowledgeContext: "Tri thức kênh (token mỗi lần; 0 = tắt)",
      knowledgeEmbeddings: "Tìm tri thức theo nghĩa (cần nhà cung cấp)",
      altQueryAssist: "Alternative visual query assistance (BALANCED/QUALITY/CUSTOM)",
      sceneQueryAssist: "Scene query assist (BALANCED/QUALITY/CUSTOM)",
      semanticImageRerank: "Semantic image rerank (QUALITY/CUSTOM)",
      scriptReviewPasses: "Script review passes",
      visionCheck: "Kiểm tra ảnh bằng AI nhìn (MAX/CUSTOM)",
      visionRetryRounds: "Số vòng tìm lại khi AI nhìn chưa đạt",
      visionThreshold: "Ngưỡng điểm AI nhìn (0–10)",
      visualSearchBreadth: "Số ảnh liên quan tối thiểu mỗi scene",
      renderVerify: "Kiểm tra frame sau render bằng AI nhìn",
      thumbnailPick: "Chọn thumbnail bằng AI nhìn (MAX)",
      factCheck: "Đối chiếu fact script với research",
      musicAssist: "Music assist (BALANCED/QUALITY/CUSTOM)",
      metadata: "Publishing metadata (BALANCED/QUALITY/CUSTOM)",
      guidelineCheck: "Kiểm tra định hướng nội dung bằng AI",
      webImageSearch: "Tìm ảnh trên web (số scene tối đa; 999 = tất cả)",
      modelAdvisor: "Gợi ý model bằng AI (mọi chế độ)",
      topicSuggest: "Gợi ý chủ đề hồ sơ (mọi chế độ)",
      assistantChat: "Trợ lý AI điều khiển app (mọi chế độ)",
      financeInsight: "Nhận xét báo cáo doanh thu tháng (BALANCED+)",
      performanceInsight: "Bài học hiệu suất từ số liệu (ECO mỗi 2 tuần)",
      clipPick: "Chọn đoạn Shorts bằng AI (BALANCED+)",
      commentAssist: "Phân loại và gợi ý trả lời bình luận (BALANCED+)",
      trendMatch: "Ghép xu hướng với kênh (mọi chế độ)",
      translateScript: "Dịch kịch bản sang ngôn ngữ khác (BALANCED+)",
      providerIntelExtract: "Trích trang nhà cung cấp bằng AI (BALANCED+)",
      editPlan: "Kế hoạch dựng bằng AI (BALANCED+)",
      formatPick: "Chọn mẫu video bằng AI (BALANCED+)",
      stageTimeouts: "Tính thời gian tối đa mỗi bước (mọi chế độ)",
      composeGraphics: "Đồ hoạ cảnh: tắt, một khung, hoặc chuyển động",
      graphicGrain: "Hạt nhiễu trên đồ hoạ chuyển động",
      operatorPlan: "Đọc mục tiêu tự vận hành (mọi chế độ)",
      operatorClassify: "Phân loại lời chủ kênh (mọi chế độ)",
    };
    const label = labels[key] ?? key;
    if (typeof value === "boolean") {
      return field(path, label, (
        <input
          aria-label={key}
          type="checkbox"
          checked={value}
          onChange={(event) => onChange(path, event.target.checked)}
        />
      ));
    }
    return field(path, label, (
      <select aria-label={key} value={String(value)} onChange={(event) => onChange(
        path,
        key === "knowledgeContext" || key === "repairAttempts" || key === "scriptReviewPasses" || key === "visionRetryRounds" || key === "visionThreshold" || key === "visualSearchBreadth" || key === "webImageSearch"
          ? Number(event.target.value)
          : event.target.value,
      )}>
        {(
          key === "knowledgeContext" ? ["0", "600", "1500", "3000"] : key === "storyMode" ? ["merged", "separate"]
            : key === "guidelineCheck" ? ["off", "check", "checkAndFix"]
              : key === "visualSearchBreadth" ? ["8", "16", "32"]
                : key === "webImageSearch" ? ["0", "3", "8", "999"]
                : key === "visionThreshold" ? ["5", "6", "7", "8", "9"]
                  : key === "composeGraphics" ? ["off", "static", "animated"]
                  : ["0", "1", "2"]
        ).map((choice) => (
          <option key={choice} value={choice}>{choice}</option>
        ))}
      </select>
    ));
  };
  return (
    <div className="brief-fields">
      <div className="brief-budget-card brief-field-full">
        {field("budget.mode", "Chế độ AI / Budget mode", (
          <select
            aria-label="Chế độ AI / Budget mode"
            value={resolved.budget.mode}
            onChange={(event) => onChange("budget.mode", event.target.value)}
          >
            <option value="ECO">ECO — Rẻ nhất (~2 lượt gọi AI/video)</option>
            <option value="BALANCED">BALANCED — Cân bằng chất lượng/chi phí (~11–17 lượt)</option>
            <option value="QUALITY">QUALITY — Chất lượng cao: AI tự review &amp; sửa script (~9–26 lượt)</option>
            <option value="MAX">MAX — Không tiết kiệm token — kiểm tra ảnh bằng AI nhìn</option>
            <option value="CUSTOM">CUSTOM</option>
          </select>
        ))}
        <div className="brief-budget-meta">
          <small className="field-hint">
            Ước tính: ~{budgetEstimate.total.min === budgetEstimate.total.max
              ? budgetEstimate.total.min
              : `${budgetEstimate.total.min}–${budgetEstimate.total.max}`} lượt gọi AI ({budgetEstimate.mode})
            {budgetEstimate.tokens
              ? ` · ~${budgetEstimate.tokens.input + budgetEstimate.tokens.output} token`
              : ""}
          </small>
          <small className="field-hint">
            Visual Search: {budgetEstimate.perStage.find((item) => item.stage === "VISUAL_SEARCH")?.calls.max
              ? `up to ${budgetEstimate.perStage.find((item) => item.stage === "VISUAL_SEARCH")?.calls.max} LLM calls`
              : "0 LLM calls"}
            {budgetFeatures.webImageSearch > 0
              ? ` · Web ảnh: tối đa ${budgetFeatures.webImageSearch >= 999 ? "mọi" : budgetFeatures.webImageSearch} scene yếu (Brave + grounding)`
              : ""}
            {budgetEstimate.perStage.find((item) => item.stage === "RENDER")?.calls.max
              ? ` · Render vision up to ${budgetEstimate.perStage.find((item) => item.stage === "RENDER")?.calls.max}`
              : ""}
            {" · "}Đồ hoạ: {budgetFeatures.composeGraphics === "off" ? "tắt" : budgetFeatures.composeGraphics === "static" ? "một khung" : "chuyển động"}
            {budgetFeatures.graphicGrain ? " · có hạt" : ""}
          </small>
        </div>
      </div>
      {resolved.budget.mode === "CUSTOM" && (
        <fieldset className="budget-custom-fields">
          <legend>Custom AI features</legend>
          {customFeature("knowledgeContext", budgetFeatures.knowledgeContext)}
          {customFeature("knowledgeEmbeddings", budgetFeatures.knowledgeEmbeddings)}
          {customFeature("storyMode", budgetFeatures.storyMode)}
          {customFeature("repairAttempts", budgetFeatures.repairAttempts)}
          {customFeature("scriptReviewPasses", budgetFeatures.scriptReviewPasses)}
          {customFeature("altQueryAssist", budgetFeatures.altQueryAssist)}
          {customFeature("sceneQueryAssist", budgetFeatures.sceneQueryAssist)}
          {customFeature("semanticImageRerank", budgetFeatures.semanticImageRerank)}
          {customFeature("visionCheck", budgetFeatures.visionCheck)}
          {customFeature("visionRetryRounds", budgetFeatures.visionRetryRounds)}
          {customFeature("visionThreshold", budgetFeatures.visionThreshold)}
          {customFeature("visualSearchBreadth", budgetFeatures.visualSearchBreadth)}
          {customFeature("renderVerify", budgetFeatures.renderVerify)}
          {customFeature("thumbnailPick", budgetFeatures.thumbnailPick)}
          {customFeature("factCheck", budgetFeatures.factCheck)}
          {customFeature("musicAssist", budgetFeatures.musicAssist)}
          {customFeature("metadata", budgetFeatures.metadata)}
          {customFeature("guidelineCheck", budgetFeatures.guidelineCheck)}
          {customFeature("webImageSearch", budgetFeatures.webImageSearch)}
          {customFeature("modelAdvisor", budgetFeatures.modelAdvisor)}
          {customFeature("topicSuggest", budgetFeatures.topicSuggest)}
          {customFeature("assistantChat", budgetFeatures.assistantChat)}
          {customFeature("financeInsight", budgetFeatures.financeInsight)}
          {customFeature("performanceInsight", budgetFeatures.performanceInsight)}
          {customFeature("clipPick", budgetFeatures.clipPick)}
          {customFeature("commentAssist", budgetFeatures.commentAssist)}
          {customFeature("trendMatch", budgetFeatures.trendMatch)}
          {customFeature("translateScript", budgetFeatures.translateScript)}
          {customFeature("providerIntelExtract", budgetFeatures.providerIntelExtract)}
          {customFeature("editPlan", budgetFeatures.editPlan)}
          {customFeature("formatPick", budgetFeatures.formatPick)}
          {customFeature("stageTimeouts", budgetFeatures.stageTimeouts)}
          {customFeature("composeGraphics", budgetFeatures.composeGraphics)}
          {customFeature("graphicGrain", budgetFeatures.graphicGrain)}
        </fieldset>
      )}
      {field("format", "Mẫu video", (
        <div role="radiogroup" aria-label="Mẫu video" className="format-cards">
          <label>
            <input type="radio" name="format" checked={!settings.format} onChange={() => onChange("format", "")} />
            Tự chọn
          </label>
          {FORMAT_RECIPE_IDS.map((id) => (
            <label key={id}>
              <input type="radio" name="format" value={id} checked={settings.format === id} onChange={() => onChange("format", id)} />
              <strong>{FORMAT_RECIPES[id].nameVi}</strong>
              <span>{FORMAT_RECIPES[id].descriptionVi}</span>
            </label>
          ))}
        </div>
      ))}
      {select("platform", "Platform", ["youtube", "youtube_shorts", "tiktok", "facebook_reels", "custom"])}
      {select("style", "Style", ["storytelling", "documentary", "explainer", "news", "listicle"])}
      {select("tone", "Tone", ["neutral", "dramatic", "inspiring", "humorous", "serious"])}
      {select("audience", "Audience", ["general", "kids", "students", "professionals"])}
      {field("language", "Language (ISO code)", (
        <input aria-label="Language (ISO code)" value={resolved.language} maxLength={20} onChange={(event) => onChange("language", event.target.value)} />
      ))}
      {field("targetDurationSec", "Target duration (seconds)", (
        <input aria-label="Target duration (seconds)" type="number" min={30} max={1800} value={resolved.targetDurationSec} onChange={(event) => onChange("targetDurationSec", Number(event.target.value))} />
      ))}
      {field("aspectRatio", "Aspect ratio", (
        <select aria-label="Aspect ratio" value={resolved.aspectRatio} onChange={(event) => onChange("aspectRatio", event.target.value)}>
          {["16:9", "9:16", "1:1"].map((value) => <option key={value}>{value}</option>)}
        </select>
      ))}
      {field("wordsPerMinute", "Words per minute", (
        <input aria-label="Words per minute" type="number" min={100} max={220} value={resolved.wordsPerMinute} onChange={(event) => onChange("wordsPerMinute", Number(event.target.value))} />
      ))}
      {field("sceneDurationSec", "Average scene duration (seconds)", (
        <input aria-label="Average scene duration (seconds)" type="number" min={2} max={20} value={resolved.sceneDurationSec} onChange={(event) => onChange("sceneDurationSec", Number(event.target.value))} />
      ))}
      {select("visualStyle", "Visual style", ["photo", "illustration", "mixed"])}
      {field("subtitles.enabled", "Subtitles", (
        <select aria-label="Subtitles" value={String(resolved.subtitles.enabled)} onChange={(event) => onChange("subtitles.enabled", event.target.value === "true")}>
          <option value="true">On</option><option value="false">Off</option>
        </select>
      ))}
      {field("subtitles.maxCharsPerLine", "Subtitle characters per line", (
        <input aria-label="Subtitle characters per line" type="number" min={1} value={resolved.subtitles.maxCharsPerLine} onChange={(event) => onChange("subtitles.maxCharsPerLine", Number(event.target.value))} />
      ))}
      {field("music.enabled", "Music", (
        <select aria-label="Music" value={String(resolved.music.enabled)} onChange={(event) => onChange("music.enabled", event.target.value === "true")}>
          <option value="true">On</option><option value="false">Off</option>
        </select>
      ))}
      {field("music.volume", "Music volume", (
        <input aria-label="Music volume" type="number" min={0} max={1} step={0.01} value={resolved.music.volume} onChange={(event) => onChange("music.volume", Number(event.target.value))} />
      ))}
      {result.warnings.map((warning) => <small className="field-warning" key={warning}>{warning}</small>)}
    </div>
  );
}
