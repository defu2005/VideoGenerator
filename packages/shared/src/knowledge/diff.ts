import type { KnowledgeEntry } from "./schema.js";
type Json = KnowledgeEntry["value"];
export type JsonPatchOperation = { op: "remove"; path: string } | { op: "add" | "replace"; path: string; value: Json };

export function diffJson(before: Json, after: Json, path = ""): JsonPatchOperation[] {
  if (before === after) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const common = Math.min(before.length, after.length);
    const patch = before.slice(0, common).flatMap((value, index) => diffJson(value, after[index], `${path}/${index}`));
    for (let i = before.length - 1; i >= after.length; i--) patch.push({ op: "remove", path: `${path}/${i}` });
    for (let i = common; i < after.length; i++) patch.push({ op: "add", path: `${path}/-`, value: after[i] });
    return patch;
  }
  if (before && after && typeof before === "object" && typeof after === "object"
    && !Array.isArray(before) && !Array.isArray(after)) {
    const pointer = (key: string) => `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    const patch: JsonPatchOperation[] = [];
    for (const key of Object.keys(before).sort()) {
      if (!Object.hasOwn(after, key)) patch.push({ op: "remove", path: pointer(key) });
    }
    for (const key of Object.keys(after).sort()) {
      if (!Object.hasOwn(before, key)) patch.push({ op: "add", path: pointer(key), value: after[key] });
      else patch.push(...diffJson(before[key], after[key], pointer(key)));
    }
    return patch;
  }
  return [{ op: "replace", path, value: after }];
}
