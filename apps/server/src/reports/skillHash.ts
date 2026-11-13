import { createHash } from "node:crypto";

export function skillHash(markdown: string): string {
  return createHash("sha256").update(markdown.replaceAll("\r\n", "\n")).digest("hex").slice(0, 8);
}
