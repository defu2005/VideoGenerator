import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { describe, expect, it } from "vitest";
import type { Project } from "@vg/shared";
import { ASSISTANT_TOOLS, type AssistantToolContext } from "../src/assistant/tools.js";
import { registerReviewRoutes } from "../src/api/review.js";
import { setReviewHooks } from "../src/review/hooks.js";
import type { ReviewService } from "../src/review/service.js";

const projectId = "11111111-1111-4111-8111-111111111111";
const proposal = { type: "NOTE" as const, text: "Giữ lời kể." };

describe("review apply path", () => {
  it("sends the assistant tool and the MCP route through one method", async () => {
    const calls: string[] = [];
    const project = { id: projectId } as Project;
    const review = {
      applyRawProposal: async (_project: Project, _proposal: unknown, source: "assistant" | "mcp" = "mcp") => {
        calls.push(source);
        return { result: { ok: true }, staleStages: [] };
      },
    };
    setReviewHooks({
      loadProject: async () => project,
      applyRawProposal: (loaded, raw, source) => review.applyRawProposal(loaded, raw, source),
      undoTimeline: async () => ({ result: null, staleStages: [] }),
    });
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    registerReviewRoutes(app, review as unknown as ReviewService, { getProject: async () => project });
    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/review/apply`,
      payload: { proposal },
    });
    expect(response.statusCode).toBe(200);
    await ASSISTANT_TOOLS.apply_review_proposal.execute(
      { projectId, proposal },
      {} as AssistantToolContext,
    );
    expect(calls).toEqual(["mcp", "assistant"]);
    await app.close();
  });
});
