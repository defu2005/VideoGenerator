import { clampTransitionDuration, type EditPlan } from "../edit/plan.js";
import { clampGraphics } from "../motion/plan.js";
import { motionTemplate } from "../motion/templates.js";
import type { ReviewProposal } from "../schemas/review.js";
import type { Timeline, TimelineScene } from "../schemas/timeline.js";

const TIMELINE_TYPES = new Set<ReviewProposal["type"]>([
  "SET_TRANSITION",
  "SET_EMPHASIS",
  "REMOVE_EMPHASIS",
  "ADD_GRAPHIC",
  "EDIT_GRAPHIC",
  "REMOVE_GRAPHIC",
  "SET_SUBTITLE_STYLE",
  "DELETE_SCENE",
  "SPLIT_SCENE",
  "REGENERATE_SCENE_VOICE",
]);

export function proposalEditsTimeline(proposal: ReviewProposal): boolean {
  return TIMELINE_TYPES.has(proposal.type);
}

export function timelineRevision(timeline: Timeline): number {
  return timeline.revision ?? 0;
}

function blankPlan(timeline: Timeline): EditPlan {
  return timeline.editPlan ?? {
    preset: "story",
    transitions: [],
    motions: [],
    emphasis: [],
    subtitleStyle: "karaoke",
    source: "user",
  };
}

function shiftAfter(scenes: TimelineScene[], removedDuration: number, fromStart: number): TimelineScene[] {
  return scenes.map((scene, index) => {
    if (scene.startSec < fromStart) return { ...scene, order: index };
    const startSec = Math.max(0, scene.startSec - removedDuration);
    return {
      ...scene,
      order: index,
      startSec,
      endSec: startSec + scene.durationSec,
    };
  });
}

export function applyTimelineProposal(
  timeline: Timeline,
  proposal: ReviewProposal,
): { timeline: Timeline; bornSceneId?: string } | { error: string } {
  if (proposal.baseRevision !== undefined && proposal.baseRevision !== timelineRevision(timeline)) {
    return { error: "Timeline đã thay đổi, tạo lại đề xuất?" };
  }
  const next: Timeline = {
    ...timeline,
    scenes: timeline.scenes.map((scene) => ({ ...scene, visuals: scene.visuals.map((visual) => ({ ...visual })) })),
    graphics: timeline.graphics?.map((graphic) => ({ ...graphic, variables: { ...graphic.variables } })),
    editPlan: timeline.editPlan ? {
      ...timeline.editPlan,
      transitions: timeline.editPlan.transitions.map((item) => ({ ...item })),
      motions: timeline.editPlan.motions.map((item) => ({ ...item })),
      emphasis: timeline.editPlan.emphasis.map((item) => ({ ...item, effects: [...item.effects] })),
    } : undefined,
    revision: timelineRevision(timeline) + 1,
  };
  const scene = (id: string) => next.scenes.find((item) => item.sceneId === id);

  switch (proposal.type) {
    case "SET_TRANSITION": {
      const target = scene(proposal.afterSceneId);
      if (!target) return { error: "Không thấy cảnh để đổi chuyển cảnh." };
      const durationSec = clampTransitionDuration(proposal.durationSec);
      target.transitionOut = { type: proposal.transitionType, durationSec };
      const plan = blankPlan(next);
      const transitions = plan.transitions.filter((item) => item.afterSceneId !== proposal.afterSceneId);
      transitions.push({ afterSceneId: proposal.afterSceneId, type: proposal.transitionType, durationSec });
      next.editPlan = { ...plan, transitions, source: "user" };
      return { timeline: next };
    }
    case "SET_EMPHASIS": {
      if (!scene(proposal.sceneId)) return { error: "Không thấy cảnh để nhấn mạnh." };
      if (proposal.wordIndexEnd < proposal.wordIndexStart) return { error: "Khoảng nhấn mạnh không hợp lệ." };
      const plan = blankPlan(next);
      next.editPlan = {
        ...plan,
        source: "user",
        emphasis: [
          ...plan.emphasis.filter((item) => item.sceneId !== proposal.sceneId || item.wordIndexStart !== proposal.wordIndexStart),
          {
            sceneId: proposal.sceneId,
            wordIndexStart: proposal.wordIndexStart,
            wordIndexEnd: proposal.wordIndexEnd,
            effects: proposal.effects,
          },
        ],
      };
      return { timeline: next };
    }
    case "REMOVE_EMPHASIS": {
      const plan = blankPlan(next);
      next.editPlan = {
        ...plan,
        source: "user",
        emphasis: plan.emphasis.filter((item) => !(item.sceneId === proposal.sceneId && item.wordIndexStart === proposal.wordIndexStart)),
      };
      return { timeline: next };
    }
    case "ADD_GRAPHIC": {
      const spec = motionTemplate(proposal.templateId);
      if (!spec) return { error: "Mẫu đồ họa không có." };
      const host = proposal.sceneId ? scene(proposal.sceneId) : next.scenes[0];
      const startSec = proposal.startSec ?? host?.startSec ?? 0;
      const graphic = {
        id: crypto.randomUUID(),
        templateId: proposal.templateId,
        sceneId: proposal.sceneId,
        startSec,
        durationSec: proposal.durationSec ?? spec.defaultDurationSec,
        variables: proposal.variables,
        layer: spec.kinds.includes("overlay") ? "overlay" as const : "fullscreen" as const,
        source: "user" as const,
      };
      const clamped = clampGraphics({
        graphics: [...(next.graphics ?? []), graphic],
        totalDurationSec: next.totalDurationSec,
        scenes: next.scenes.map((item) => ({
          sceneId: item.sceneId,
          startSec: item.startSec,
          durationSec: item.durationSec,
          label: item.label,
          placeholder: item.visuals.every((visual) => visual.kind === "PLACEHOLDER"),
        })),
      });
      if (!clamped.graphics.some((item) => item.id === graphic.id)) return { error: "Đồ họa bị loại vì chồng vùng hoặc ngoài khung." };
      next.graphics = clamped.graphics;
      return { timeline: next };
    }
    case "EDIT_GRAPHIC": {
      const graphics = next.graphics ?? [];
      if (!graphics.some((item) => item.id === proposal.graphicId)) return { error: "Không thấy đồ họa." };
      next.graphics = graphics.map((item) => item.id === proposal.graphicId ? {
        ...item,
        ...(proposal.templateId ? { templateId: proposal.templateId } : {}),
        ...(proposal.startSec === undefined ? {} : { startSec: proposal.startSec }),
        ...(proposal.durationSec === undefined ? {} : { durationSec: proposal.durationSec }),
        ...(proposal.variables ? { variables: { ...item.variables, ...proposal.variables } } : {}),
        source: "user" as const,
      } : item);
      return { timeline: next };
    }
    case "REMOVE_GRAPHIC": {
      if (!(next.graphics ?? []).some((item) => item.id === proposal.graphicId)) return { error: "Không thấy đồ họa để xóa." };
      next.graphics = (next.graphics ?? []).filter((item) => item.id !== proposal.graphicId);
      return { timeline: next };
    }
    case "SET_SUBTITLE_STYLE": {
      const plan = blankPlan(next);
      next.editPlan = { ...plan, subtitleStyle: proposal.style, source: "user" };
      return { timeline: next };
    }
    case "DELETE_SCENE": {
      const target = scene(proposal.sceneId);
      if (!target) return { error: "Không thấy cảnh để xóa." };
      if (next.scenes.length < 2) return { error: "Không xóa cảnh cuối cùng." };
      const kept = next.scenes.filter((item) => item.sceneId !== proposal.sceneId);
      next.scenes = shiftAfter(kept, target.durationSec, target.startSec);
      next.totalDurationSec = Math.max(0, next.totalDurationSec - target.durationSec);
      next.graphics = (next.graphics ?? []).filter((item) => item.sceneId !== proposal.sceneId);
      return { timeline: next };
    }
    case "SPLIT_SCENE": {
      const target = scene(proposal.sceneId);
      if (!target) return { error: "Không thấy cảnh để tách." };
      const half = target.durationSec / 2;
      if (half < 0.4) return { error: "Cảnh quá ngắn để tách." };
      const born: TimelineScene = {
        ...target,
        sceneId: crypto.randomUUID(),
        startSec: target.startSec + half,
        durationSec: target.durationSec - half,
        endSec: target.endSec,
        durationFrames: Math.max(1, Math.round((target.durationSec - half) * next.target.fps)),
        visuals: target.visuals.map((visual) => ({ ...visual })),
      };
      target.durationSec = half;
      target.endSec = target.startSec + half;
      target.durationFrames = Math.max(1, Math.round(half * next.target.fps));
      const index = next.scenes.findIndex((item) => item.sceneId === proposal.sceneId);
      next.scenes.splice(index + 1, 0, born);
      next.scenes = next.scenes.map((item, order) => ({ ...item, order }));
      return { timeline: next, bornSceneId: born.sceneId };
    }
    case "REGENERATE_SCENE_VOICE": {
      const target = scene(proposal.sceneId);
      if (!target) return { error: "Không thấy cảnh để đọc lại." };
      target.voice = null;
      return { timeline: next };
    }
    default:
      return { error: "Đề xuất này không sửa timeline." };
  }
}

export function markMissingVoices(
  timeline: Timeline,
  fileExists: (path: string) => boolean,
): Timeline {
  return {
    ...timeline,
    scenes: timeline.scenes.map((scene) => {
      if (!scene.voice?.path || fileExists(scene.voice.path)) return scene;
      return { ...scene, voice: null };
    }),
  };
}
