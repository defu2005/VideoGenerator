import { z } from "zod";
import { StyleTokensPatchSchema } from "@vg/shared";
import type { AssistantToolDef } from "../assistant/tools.js";
import { StyleDesigner } from "./designer.js";
import { StyleService } from "./service.js";

const profileArgs = z.object({ profileId: z.string().uuid() }).strict();
const proposeArgs = z.object({ profileId: z.string().uuid(), note: z.string().trim().max(500).optional() }).strict();
const setArgs = z.object({
  profileId: z.string().uuid(),
  presetId: z.string().min(1).max(60).optional(),
  pack: StyleTokensPatchSchema.optional(),
  reason: z.string().trim().min(1).max(200),
}).strict().refine((value) => Boolean(value.presetId) !== Boolean(value.pack), { message: "Chọn presetId hoặc pack, không cả hai." });

/** TASK-111: one set of style-pack tools for the assistant, MCP and the operator. */
export const styleToolDefs: AssistantToolDef[] = [
  {
    name: "get_style_pack",
    description: "Xem phong cách (bảng màu, phông, nhịp) của một kênh và các bản đã lưu.",
    risk: "read",
    argsSchema: profileArgs,
    summarize: () => "Xem phong cách kênh",
    execute: async (args, ctx) => {
      const { profileId } = profileArgs.parse(args);
      const styles = new StyleService(ctx.sqlite);
      const versions = styles.versions(profileId);
      if (!versions) throw new Error("Không tìm thấy hồ sơ.");
      const [latest] = versions;
      return { pack: latest, versions: versions.map((pack) => ({ version: pack.version, origin: pack.origin })) };
    },
  },
  {
    name: "propose_style_pack",
    description: "AI gợi ý một phong cách cho kênh, khác các kênh khác. Chỉ trả bản nháp, không lưu. ECO không gọi AI.",
    risk: "safe",
    argsSchema: proposeArgs,
    summarize: () => "Gợi ý phong cách kênh",
    execute: async (args, ctx) => {
      const { profileId, note } = proposeArgs.parse(args);
      const designer = new StyleDesigner({ sqlite: ctx.sqlite, registry: ctx.registry, config: ctx.config });
      return designer.propose(profileId, note, ctx.signal);
    },
  },
  {
    name: "set_style_pack",
    description: "Đổi phong cách của kênh sang một mẫu (presetId) hoặc sửa token (pack). Lưu thành bản mới, chỉ áp dụng cho video render sau. Cần người dùng xác nhận.",
    risk: "confirm",
    argsSchema: setArgs,
    summarize: (args) => {
      const parsed = setArgs.safeParse(args);
      return parsed.success && parsed.data.presetId ? `Đổi phong cách kênh sang mẫu ${parsed.data.presetId}` : "Sửa phong cách kênh";
    },
    execute: async (args, ctx) => {
      const input = setArgs.parse(args);
      const designer = new StyleDesigner({ sqlite: ctx.sqlite });
      return input.presetId
        ? designer.fromPreset(input.profileId, input.presetId)
        : designer.patch(input.profileId, input.pack!, input.reason);
    },
  },
];
