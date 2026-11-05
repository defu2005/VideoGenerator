import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { TrendService } from "../trends/trendService.js";

const IdParams = z.object({ id: z.string().uuid() }).strict();
const KeyBody = z.object({ apiKey: z.string().trim().min(8).max(200) }).strict();

export function registerTrendRoutes(app: FastifyInstance, trends: TrendService): void {
  app.post("/api/profiles/:id/trends/refresh", async (request) => {
    const { id } = IdParams.parse(request.params);
    return trends.refresh(id, request.signal);
  });

  app.post("/api/profiles/:id/trends/topics", async (request) => {
    const { id } = IdParams.parse(request.params);
    return trends.addIdea(id, request.body);
  });

  app.get("/api/trends/youtube-key", async () => ({
    configured: trends.youtubeKeyConfigured(),
  }));

  app.put("/api/trends/youtube-key", async (request) => {
    const body = KeyBody.parse(request.body);
    trends.setYoutubeApiKey(body.apiKey);
    return { configured: true };
  });
}
