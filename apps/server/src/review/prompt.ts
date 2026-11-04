import type { Project, ReviewMessage, ReviewProposal } from "@vg/shared";
import type { BuiltReviewContext } from "./contextBuilder.js";

const HISTORY_WINDOW = 12;

export function buildReviewPrompt(input: {
  project: Project;
  context: BuiltReviewContext;
  history: ReviewMessage[];
  appliedProposals: ReviewProposal[];
  userText: string;
}): { system: string; prompt: string } {
  const earlier = input.history.length > HISTORY_WINDOW
    ? input.history.slice(0, -HISTORY_WINDOW)
    : [];
  const recent = input.history.slice(-HISTORY_WINDOW);
  const earlierDecisions = summarizeEarlierDecisions(earlier, input.appliedProposals);

  const system = [
    "You are helping the user refine a video right before render.",
    `Answer in the project language: ${input.project.settings.language}.`,
    "Only propose changes using the allowed proposal types.",
    "Use only scene ids that appear in the context document.",
    "Use NOTE for advice that does not need an apply button.",
    "Never claim a change was already applied — the user must click Apply.",
    "Return structured JSON matching the schema.",
  ].join("\n");

  const prompt = [
    "## Context",
    input.context.json,
    "",
    earlierDecisions ? `## Earlier decisions\n${earlierDecisions}\n` : "",
    "## Recent messages",
    formatHistory(recent),
    "",
    "## User",
    input.userText,
  ].filter(Boolean).join("\n");

  return { system, prompt };
}

function formatHistory(messages: ReviewMessage[]): string {
  if (messages.length === 0) return "(none yet)";
  return messages.map((message) => {
    const proposals = message.proposals?.length
      ? `\nProposals: ${JSON.stringify(message.proposals)}`
      : "";
    return `${message.role.toUpperCase()}: ${message.content}${proposals}`;
  }).join("\n\n");
}

function summarizeEarlierDecisions(
  earlier: ReviewMessage[],
  applied: ReviewProposal[],
): string {
  const fromMessages = earlier.flatMap((message) => {
    if (!message.proposals?.length || !message.appliedIndexes.length) return [];
    return message.appliedIndexes
      .map((index) => message.proposals?.[index])
      .filter((proposal): proposal is ReviewProposal => Boolean(proposal));
  });
  const all = [...fromMessages, ...applied];
  if (all.length === 0) return "";
  return all.map((proposal, index) => `${index + 1}. ${JSON.stringify(proposal)}`).join("\n");
}

export { HISTORY_WINDOW };
