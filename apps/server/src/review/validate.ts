import { motionTemplate, type ReviewAssistantOutput, type ReviewProposal } from "@vg/shared";

export type ReviewValidationContext = {
  sceneIds: Set<string>;
  sceneCount: number;
  graphicIds?: Set<string>;
};

export type ValidatedReviewOutput = {
  reply: string;
  proposals: ReviewProposal[];
  droppedNotes: string[];
};

export function validateReviewOutput(
  output: ReviewAssistantOutput,
  context: ReviewValidationContext,
): ValidatedReviewOutput {
  const proposals: ReviewProposal[] = [];
  const droppedNotes: string[] = [];

  for (const proposal of output.proposals) {
    const reason = dropReason(proposal, context);
    if (reason) {
      droppedNotes.push(reason);
      continue;
    }
    proposals.push(proposal);
  }

  let reply = output.reply.trim();
  if (droppedNotes.length > 0) {
    reply = `${reply}\n\n(Một số đề xuất đã bỏ: ${droppedNotes.join("; ")})`;
  }

  return { reply, proposals, droppedNotes };
}

function dropReason(proposal: ReviewProposal, context: ReviewValidationContext): string | null {
  switch (proposal.type) {
    case "EDIT_NARRATION":
    case "EDIT_DURATION":
    case "EDIT_VISUAL_QUERY":
    case "SET_MOTION":
      if (!context.sceneIds.has(proposal.sceneId)) {
        return `sceneId không hợp lệ (${proposal.type})`;
      }
      if (proposal.type === "EDIT_DURATION" && proposal.durationSec !== null
        && (proposal.durationSec < 1 || proposal.durationSec > 60)) {
        return "thời lượng ngoài khoảng 1–60s";
      }
      return null;
    case "REORDER_SCENES": {
      if (proposal.sceneIds.length !== context.sceneCount) {
        return "thứ tự scene không đủ số lượng";
      }
      const unique = new Set(proposal.sceneIds);
      if (unique.size !== proposal.sceneIds.length) {
        return "thứ tự scene trùng id";
      }
      for (const id of proposal.sceneIds) {
        if (!context.sceneIds.has(id)) return "thứ tự scene chứa id lạ";
      }
      return null;
    }
    case "MUSIC_MIX":
    case "MUSIC_QUERY":
    case "EDIT_METADATA":
    case "NOTE":
    case "SET_SUBTITLE_STYLE":
      return null;
    case "SET_TRANSITION":
      return context.sceneIds.has(proposal.afterSceneId) ? null : "sceneId không hợp lệ (SET_TRANSITION)";
    case "SET_EMPHASIS":
    case "REMOVE_EMPHASIS":
    case "DELETE_SCENE":
    case "SPLIT_SCENE":
    case "REGENERATE_SCENE_VOICE":
      return context.sceneIds.has(proposal.sceneId) ? null : `sceneId không hợp lệ (${proposal.type})`;
    case "ADD_GRAPHIC":
      if (proposal.sceneId && !context.sceneIds.has(proposal.sceneId)) return "sceneId không hợp lệ (ADD_GRAPHIC)";
      return motionTemplate(proposal.templateId) ? null : "mẫu đồ họa không có";
    case "EDIT_GRAPHIC":
    case "REMOVE_GRAPHIC":
      return context.graphicIds && !context.graphicIds.has(proposal.graphicId)
        ? "không thấy đồ họa"
        : null;
    default: {
      const _exhaustive: never = proposal;
      return `loại đề xuất không hỗ trợ: ${String((_exhaustive as ReviewProposal).type)}`;
    }
  }
}
