import type { ReviewAssistantOutput, ReviewProposal } from "@vg/shared";

export type ReviewValidationContext = {
  sceneIds: Set<string>;
  sceneCount: number;
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
      return null;
    default: {
      const _exhaustive: never = proposal;
      return `loại đề xuất không hỗ trợ: ${String((_exhaustive as ReviewProposal).type)}`;
    }
  }
}
