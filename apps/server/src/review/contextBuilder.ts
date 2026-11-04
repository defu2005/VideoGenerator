import { createHash } from "node:crypto";
import type {
  Project,
  ReviewProposal,
} from "@vg/shared";
import type { GuidelineService } from "../guidelines/service.js";
import type { MusicService } from "../services/musicService.js";
import type { SceneService } from "../services/sceneService.js";
import type { TimelineService } from "../services/timelineService.js";
import type { VisualService } from "../services/visualService.js";

const MAX_NARRATION_CHARS = 400;
const COMPACT_TOTAL_CHARS = 12_000;

export type ReviewContextDocument = {
  brief: {
    topic: string;
    title: string;
    language: string;
    platform: string;
    style: string;
    tone: string;
    audience: string;
    targetDurationSec: number;
    aspectRatio: string;
  };
  guidelines: {
    text: string;
    openFindings: Array<{
      severity: string;
      ruleId: string;
      text: string;
      sceneId: string | null;
    }>;
  };
  scenes: Array<{
    id: string;
    order: number;
    label: string;
    startSec: number | null;
    endSec: number | null;
    durationSec: number | null;
    narration: string;
    visual: {
      title: string | null;
      source: string | null;
      license: string | null;
      motion: unknown;
      placeholder: boolean;
      status: string | null;
    };
  }>;
  music: {
    enabled: boolean;
    title: string | null;
    mix: {
      volume: number;
      fadeInSec: number;
      fadeOutSec: number;
      duckingDb: number;
    } | null;
    license: string | null;
    query: string | null;
  };
  subtitles: { cueCount: number } | null;
  timeline: {
    totalDurationSec: number | null;
    warnings: Array<{ code: string; sceneId: string | null; message: string }>;
  };
  appliedProposals: ReviewProposal[];
};

export type BuiltReviewContext = {
  document: ReviewContextDocument;
  contextHash: string;
  json: string;
};

export function buildReviewContext(input: {
  project: Project;
  scenes: SceneService;
  visuals: VisualService;
  music: MusicService;
  timelines: TimelineService;
  guidelines: GuidelineService;
  appliedProposals?: ReviewProposal[];
}): BuiltReviewContext {
  const { project } = input;
  const plan = input.scenes.get(project.id);
  const visuals = input.visuals.getProjectVisuals(project.id);
  const music = input.music.getProjectMusic(project);
  const timelineRow = input.timelines.get(project.id);
  const timeline = timelineRow.timeline;
  const findings = input.guidelines.responseFor(project);
  const guidance = input.guidelines.guidanceFor(project, ["script", "visuals", "music", "subtitles", "metadata"]);

  const visualByScene = new Map(visuals.scenes.map((scene) => [scene.sceneId, scene]));
  const timelineByScene = new Map(timeline?.scenes.map((scene) => [scene.sceneId, scene]) ?? []);

  let document: ReviewContextDocument = {
    brief: {
      topic: project.topic,
      title: project.title,
      language: project.settings.language,
      platform: project.settings.platform,
      style: project.settings.style,
      tone: project.settings.tone,
      audience: project.settings.audience,
      targetDurationSec: project.settings.targetDurationSec,
      aspectRatio: project.settings.aspectRatio,
    },
    guidelines: {
      text: guidance,
      openFindings: findings.findings
        .filter((finding) => finding.status === "OPEN")
        .map((finding) => ({
          severity: finding.severity,
          ruleId: finding.ruleId,
          text: finding.text,
          sceneId: finding.sceneId,
        })),
    },
    scenes: plan.scenes.map((scene) => {
      const visual = visualByScene.get(scene.id);
      const timed = timelineByScene.get(scene.id);
      const selected = visual?.selectedCandidate ?? null;
      return {
        id: scene.id,
        order: scene.order,
        label: scene.label,
        startSec: timed?.startSec ?? null,
        endSec: timed?.endSec ?? null,
        durationSec: timed?.durationSec ?? scene.durationOverrideSec ?? scene.estDurationSec,
        narration: scene.narration,
        visual: {
          title: selected?.title ?? null,
          source: selected?.sourceSite ?? selected?.provider ?? null,
          license: selected?.license.kind ?? null,
          motion: visual?.selection?.motion ?? null,
          placeholder: visual?.status === "NO_VISUAL" || visual?.status === "SKIPPED" || !selected,
          status: visual?.status ?? null,
        },
      };
    }),
    music: {
      enabled: music.enabled,
      title: music.selectedCandidate?.title ?? null,
      mix: music.selection
        ? {
          volume: music.selection.volume,
          fadeInSec: music.selection.fadeInSec,
          fadeOutSec: music.selection.fadeOutSec,
          duckingDb: music.selection.duckingDb,
        }
        : null,
      license: music.selectedCandidate?.license.kind ?? null,
      query: music.selection?.queryOverride ?? music.query,
    },
    subtitles: timeline?.subtitles
      ? { cueCount: timeline.subtitles.cueCount }
      : null,
    timeline: {
      totalDurationSec: timeline?.totalDurationSec ?? null,
      warnings: (timeline?.warnings ?? []).map((warning) => ({
        code: warning.code,
        sceneId: warning.sceneId,
        message: warning.message,
      })),
    },
    appliedProposals: input.appliedProposals ?? [],
  };

  const rough = stableStringify(document);
  if (rough.length > COMPACT_TOTAL_CHARS) {
    document = {
      ...document,
      scenes: document.scenes.map((scene) => ({
        ...scene,
        narration: scene.narration.length > MAX_NARRATION_CHARS
          ? `${scene.narration.slice(0, MAX_NARRATION_CHARS)}…`
          : scene.narration,
      })),
    };
  }

  const json = stableStringify(document);
  const contextHash = createHash("sha256").update(json).digest("hex");
  return { document, contextHash, json };
}

/** Deterministic JSON with sorted object keys. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries.map(([key, entry]) => [key, sortKeys(entry)]));
  }
  return value;
}
