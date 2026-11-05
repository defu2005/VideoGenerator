import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GUIDE_PAGES,
  isGuidePage,
  searchUserGuide,
  splitGuideSections,
  type GuideSearchHit,
  type GuideSection,
} from "@vg/shared";
import { AppError } from "../lib/errors.js";

export function findGuideDir(start = dirname(fileURLToPath(import.meta.url))): string {
  let dir = start;
  for (let hop = 0; hop < 8; hop += 1) {
    const candidate = join(dir, "docs", "user-guide");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new AppError(500, "HELP_UNAVAILABLE", "Không thấy thư mục hướng dẫn.");
}

/** Reject anything that is not an exact whitelist stem. */
export function assertGuidePage(page: string): string {
  if (!/^[A-Za-z0-9-]+$/.test(page) || page.includes("..") || !isGuidePage(page)) {
    const knownShape = /^[A-Za-z0-9-]+$/.test(page);
    const status = knownShape ? 404 : 400;
    throw new AppError(
      status,
      status === 404 ? "HELP_NOT_FOUND" : "HELP_PATH_REJECTED",
      status === 404 ? "Không có trang hướng dẫn này." : "Đường dẫn hướng dẫn không hợp lệ.",
    );
  }
  return page;
}

export function readGuideMarkdown(page: string, root = findGuideDir()): string {
  const safe = assertGuidePage(page);
  const path = join(root, `${safe}.md`);
  if (!existsSync(path)) throw new AppError(404, "HELP_NOT_FOUND", "Không có trang hướng dẫn này.");
  return readFileSync(path, "utf8");
}

export function allGuideSections(root = findGuideDir()): GuideSection[] {
  return GUIDE_PAGES.flatMap((page) => splitGuideSections(page, readGuideMarkdown(page, root)));
}

export function searchGuide(query: string, root = findGuideDir()): { query: string; sections: GuideSearchHit[] } {
  const sections = searchUserGuide(allGuideSections(root), query).map((section) => ({
    ...section,
    text: section.text.slice(0, 700),
  }));
  return { query, sections };
}
