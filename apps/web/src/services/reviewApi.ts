import type {
  ReviewApplyResult,
  ReviewEstimate,
  ReviewGetResponse,
  ReviewMessage,
  ReviewProposal,
} from "@vg/shared";
import { apiRequest } from "./apiClient";

const reviewPath = (projectId: string) => `/projects/${projectId}/review`;

export function getProjectReview(projectId: string, text = ""): Promise<ReviewGetResponse> {
  const query = text ? `?text=${encodeURIComponent(text)}` : "";
  return apiRequest<ReviewGetResponse>(`${reviewPath(projectId)}${query}`);
}

export function estimateReviewTokens(projectId: string, text: string): Promise<ReviewEstimate> {
  return apiRequest<ReviewEstimate>(
    `${reviewPath(projectId)}/estimate?text=${encodeURIComponent(text)}`,
  );
}

export function sendReviewMessage(
  projectId: string,
  body: { text: string; attachImages?: boolean },
): Promise<ReviewMessage> {
  return apiRequest<ReviewMessage>(`${reviewPath(projectId)}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function applyReviewProposal(
  projectId: string,
  messageId: string,
  index: number,
): Promise<ReviewApplyResult> {
  return apiRequest<ReviewApplyResult>(
    `${reviewPath(projectId)}/proposals/${messageId}/${index}/apply`,
    { method: "POST", body: "{}" },
  );
}

export function applyRawReviewProposal(
  projectId: string,
  proposal: ReviewProposal,
): Promise<ReviewApplyResult> {
  return apiRequest<ReviewApplyResult>(`${reviewPath(projectId)}/apply`, {
    method: "POST",
    body: JSON.stringify({ proposal }),
  });
}

export function undoReviewTimeline(projectId: string): Promise<ReviewApplyResult> {
  return apiRequest<ReviewApplyResult>(`${reviewPath(projectId)}/undo`, { method: "POST" });
}

export function resetProjectReview(projectId: string): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>(reviewPath(projectId), { method: "DELETE" });
}
