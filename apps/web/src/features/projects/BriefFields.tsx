import { recommendBrief, type BriefSettings } from "@vg/shared";
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

  function field(path: string, label: string, control: ReactNode) {
    const recommendation = result.recommendations[path];
    return (
      <label className="form-field brief-field" key={path}>
        <span>
          {label}
          {recommendation.source === "recommended" ? (
            <span className="recommendation-badge" title={recommendation.reason} aria-hidden="true">Gợi ý</span>
          ) : (
            <button className="recommendation-reset" type="button" aria-label={`Reset ${label} to recommendation`} onClick={() => onReset(path)}>↺</button>
          )}
        </span>
        {control}
        <small className="field-hint" title={recommendation.reason}>{recommendation.reason}</small>
      </label>
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
  return (
    <div className="brief-fields">
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
