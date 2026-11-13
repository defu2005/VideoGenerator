import {
  ApiErrorSchema,
  AspectRatioSchema,
  LAYOUT_FAMILIES,
  StylePackSchema,
  StyleTokensPatchSchema,
  StyleTokensSchema,
  stylePackTokens,
  VideoLookSchema,
} from "@vg/shared";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import type { AppConfig } from "../lib/config.js";
import { AppError } from "../lib/errors.js";
import type { LlmProviderRegistry } from "../providers/llm/registry.js";
import { StyleDesigner, summarizeStyle, type StyleDesignerDeps } from "../style/designer.js";
import { StylePreviewer, type FrameRenderer } from "../style/preview.js";
import { StyleService } from "../style/service.js";

const ProfileParamsSchema = z.object({ id: z.string().uuid() }).strict();
const LooksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

const PresetSchema = z.object({
  id: z.string(),
  nameVi: z.string(),
  descriptionVi: z.string(),
  tokens: StyleTokensPatchSchema,
}).strict();

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Màu dạng #RRGGBB");

const FromPresetBody = z.object({ presetId: z.string().min(1).max(60) }).strict();
const FromChoicesBody = z.object({
  presetId: z.string().min(1).max(60).optional(),
  brand: Hex.optional(),
  accent: Hex.optional(),
  mode: z.enum(["dark", "light"]).optional(),
  energy: z.enum(["calm", "balanced", "lively"]).optional(),
  layout: z.enum(LAYOUT_FAMILIES).optional(),
}).strict();
const FromBrandBody = z.object({
  colors: z.array(Hex).min(1).max(6),
  presetId: z.string().min(1).max(60).optional(),
}).strict();
const ProposeBody = z.object({ note: z.string().trim().max(500).optional() }).strict();
const PutBody = z.object({
  patch: StyleTokensPatchSchema,
  reason: z.string().trim().min(1).max(200),
}).strict();
const PreviewBody = z.object({
  pack: StylePackSchema.optional(),
  tokens: StyleTokensPatchSchema.optional(),
}).strict();
const RevertBody = z.object({ version: z.number().int().min(1) }).strict();

const IssuesSchema = z.object({
  contrast: z.array(z.object({ pair: z.string(), ratio: z.number(), min: z.number() }).passthrough()),
  fonts: z.array(z.object({}).passthrough()),
}).passthrough();
const StyleSummarySchema = z.object({
  fingerprint: z.string(),
  color: z.record(z.string(), z.unknown()),
  fonts: z.object({ display: z.string(), body: z.string() }),
  issues: IssuesSchema,
  adjusted: z.array(z.string()),
}).strict();
const SimilarSchema = z.array(z.object({ profileId: z.string(), name: z.string(), score: z.number() }).strict());
const SaveResponse = z.object({
  pack: StylePackSchema,
  tokens: StyleTokensSchema,
  changed: z.boolean(),
  style: StyleSummarySchema,
  similar: SimilarSchema,
}).strict();
const DraftResponse = z.object({
  pack: StylePackSchema,
  tokens: StyleTokensSchema,
  dropped: z.array(z.string()),
  source: z.enum(["llm", "preset"]),
  message: z.string(),
  style: StyleSummarySchema,
  similar: SimilarSchema,
}).strict();
const PreviewResponse = z.object({
  fingerprint: z.string(),
  aspect: AspectRatioSchema,
  frames: z.array(z.object({ id: z.string(), label: z.string(), dataUrl: z.string() }).strict()),
  style: StyleSummarySchema,
  warning: z.string().optional(),
  cached: z.boolean(),
}).strict();
const VersionsResponse = z.object({
  versions: z.array(z.object({
    version: z.number().int(),
    name: z.string(),
    origin: StylePackSchema.shape.origin,
    fingerprint: z.string(),
    current: z.boolean(),
    tokens: StyleTokensSchema,
  }).strict()),
}).strict();

const ErrorResponses = { 400: ApiErrorSchema, 404: ApiErrorSchema, 500: ApiErrorSchema, 503: ApiErrorSchema };

export type StyleRouteDeps = {
  registry?: LlmProviderRegistry;
  config?: AppConfig;
  /** Test hooks. */
  generate?: StyleDesignerDeps["generate"];
  contrastOf?: StyleDesignerDeps["contrastOf"];
  renderFrame?: FrameRenderer;
};

export function registerStyleRoutes(app: FastifyInstance, sqlite: Database.Database, deps: StyleRouteDeps = {}): void {
  const service = new StyleService(sqlite);
  const designer = new StyleDesigner({
    sqlite,
    ...(deps.registry ? { registry: deps.registry } : {}),
    ...(deps.config ? { config: deps.config } : {}),
    ...(deps.generate ? { generate: deps.generate } : {}),
    ...(deps.contrastOf ? { contrastOf: deps.contrastOf } : {}),
  });
  const previewer = new StylePreviewer(deps.config?.DATA_DIR ?? "data", deps.renderFrame);

  app.get("/api/style/presets", {
    schema: {
      response: { 200: z.object({ presets: z.array(PresetSchema) }).strict(), ...ErrorResponses },
    },
  }, async () => ({ presets: service.presets() }));

  app.get("/api/profiles/:id/style-pack", {
    schema: {
      params: ProfileParamsSchema,
      response: {
        200: z.object({ pack: StylePackSchema.nullable(), tokens: StyleTokensSchema.nullable() }).strict(),
        ...ErrorResponses,
      },
    },
  }, async (request) => {
    const { id } = ProfileParamsSchema.parse(request.params);
    const linked = service.linkedPack(id);
    if (!linked.found) throw new AppError(404, "NOT_FOUND", "Không tìm thấy hồ sơ.");
    return { pack: linked.pack, tokens: linked.tokens };
  });

  app.post("/api/profiles/:id/style-pack/from-preset", {
    schema: { params: ProfileParamsSchema, body: FromPresetBody, response: { 200: SaveResponse, ...ErrorResponses } },
  }, async (request) => {
    const { id } = ProfileParamsSchema.parse(request.params);
    return designer.fromPreset(id, FromPresetBody.parse(request.body).presetId);
  });

  app.post("/api/profiles/:id/style-pack/from-choices", {
    schema: { params: ProfileParamsSchema, body: FromChoicesBody, response: { 200: SaveResponse, ...ErrorResponses } },
  }, async (request) => {
    const { id } = ProfileParamsSchema.parse(request.params);
    return designer.fromChoices(id, FromChoicesBody.parse(request.body));
  });

  app.post("/api/profiles/:id/style-pack/from-brand", {
    schema: { params: ProfileParamsSchema, body: FromBrandBody, response: { 200: SaveResponse, ...ErrorResponses } },
  }, async (request) => {
    const { id } = ProfileParamsSchema.parse(request.params);
    return designer.fromBrand(id, FromBrandBody.parse(request.body));
  });

  app.post("/api/profiles/:id/style-pack/propose", {
    schema: { params: ProfileParamsSchema, body: ProposeBody, response: { 200: DraftResponse, ...ErrorResponses } },
  }, async (request) => {
    const { id } = ProfileParamsSchema.parse(request.params);
    const body = ProposeBody.parse(request.body);
    const controller = new AbortController();
    request.raw.once("close", () => { if (!request.raw.complete) controller.abort(); });
    return designer.propose(id, body.note, controller.signal);
  });

  app.put("/api/profiles/:id/style-pack", {
    schema: { params: ProfileParamsSchema, body: PutBody, response: { 200: SaveResponse, ...ErrorResponses } },
  }, async (request) => {
    const { id } = ProfileParamsSchema.parse(request.params);
    const body = PutBody.parse(request.body);
    return designer.patch(id, body.patch, body.reason);
  });

  app.post("/api/profiles/:id/style-pack/preview", {
    schema: { params: ProfileParamsSchema, body: PreviewBody, response: { 200: PreviewResponse, ...ErrorResponses } },
  }, async (request) => {
    const { id } = ProfileParamsSchema.parse(request.params);
    const body = PreviewBody.parse(request.body);
    const facts = service.profileFacts(id);
    if (!facts) throw new AppError(404, "NOT_FOUND", "Không tìm thấy hồ sơ.");
    const current = service.packForProfile(id)!;
    const pack = body.pack ?? (body.tokens ? { ...current, tokens: { ...current.tokens, ...body.tokens } as typeof current.tokens } : current);
    return previewer.preview(pack, facts.aspect);
  });

  app.get("/api/profiles/:id/style-pack/versions", {
    schema: { params: ProfileParamsSchema, response: { 200: VersionsResponse, ...ErrorResponses } },
  }, async (request) => {
    const { id } = ProfileParamsSchema.parse(request.params);
    const packs = service.versions(id);
    if (!packs) throw new AppError(404, "NOT_FOUND", "Không tìm thấy hồ sơ.");
    return {
      versions: packs.map((pack, index) => ({
        version: pack.version,
        name: pack.name,
        origin: pack.origin,
        fingerprint: summarizeStyle(pack).fingerprint,
        current: index === 0,
        tokens: stylePackTokens(pack),
      })),
    };
  });

  app.post("/api/profiles/:id/style-pack/revert", {
    schema: { params: ProfileParamsSchema, body: RevertBody, response: { 200: SaveResponse, ...ErrorResponses } },
  }, async (request) => {
    const { id } = ProfileParamsSchema.parse(request.params);
    return designer.revert(id, RevertBody.parse(request.body).version);
  });

  app.get("/api/profiles/:id/looks", {
    schema: {
      params: ProfileParamsSchema,
      querystring: LooksQuerySchema,
      response: { 200: z.object({ looks: z.array(VideoLookSchema) }).strict(), ...ErrorResponses },
    },
  }, async (request) => {
    const { id } = ProfileParamsSchema.parse(request.params);
    const { limit } = LooksQuerySchema.parse(request.query);
    const looks = service.looksForProfile(id, limit);
    if (!looks) throw new AppError(404, "NOT_FOUND", "Không tìm thấy hồ sơ.");
    return { looks };
  });
}
