import { KNOWLEDGE_SNAPSHOT, snapshotKnowledge } from "../knowledge/snapshot.js";
import { GuidelinePackSchema, type GuidelinePack } from "./schema.js";

export const BUILT_IN_GUIDELINE_PACKS: readonly GuidelinePack[] = KNOWLEDGE_SNAPSHOT
  .filter((entry) => entry.kind === "guideline_pack")
  .map((entry) => GuidelinePackSchema.parse(entry.value));

export function builtInGuidelinePack(
  id: string,
  lookup = (key: string) => snapshotKnowledge(key)?.value,
): GuidelinePack | undefined {
  const value = lookup(`guideline.${id}`);
  return GuidelinePackSchema.safeParse(value).data;
}
