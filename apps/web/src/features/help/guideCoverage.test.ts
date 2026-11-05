import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { anchorsInMarkdown, featureMap, GUIDE_PAGES, helpPageId, isGuidePage } from "@vg/shared";
import { describe, expect, it } from "vitest";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const repoRoot = resolve(webRoot, "../..");
const guideDir = join(repoRoot, "docs", "user-guide");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function appRoutes(source: string): string[] {
  const routes: string[] = [];
  for (const line of source.split("\n")) {
    if (!line.includes("<Route")) continue;
    if (line.includes("Navigate")) continue;
    if (/path="\*"/.test(line)) continue;
    const path = /path="([^"]+)"/.exec(line);
    if (path) routes.push(`/${path[1].replace(/^\//, "")}`);
    else if (/\bindex\b/.test(line)) routes.push("/");
  }
  return routes;
}

function patternFits(pattern: string, candidate: string): boolean {
  if (pattern === "/") return candidate === "/";
  const left = pattern.split("/").filter(Boolean);
  const right = candidate.split("/").filter(Boolean);
  if (left.length !== right.length) return false;
  return left.every((part, index) => part.startsWith(":") || right[index].startsWith(":") || part === right[index]);
}

function tabIds(source: string): string[] {
  const block = /const TABS = \[([\s\S]*?)\] as const;/.exec(source);
  if (!block) throw new Error("TABS list missing");
  const ids = [...block[1].matchAll(/id:\s*"([^"]+)"/g)].map((match) => match[1]);
  if (ids.length > 0) return ids;
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function newestDoneTask(): string {
  const dir = join(repoRoot, "docs", "tasks");
  const ranked = readdirSync(dir)
    .map((name) => /^(TASK-(\d+)([A-Za-z0-9-]*))\.done$/.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ id: match[1], number: Number(match[2]), suffix: match[3] }))
    .sort((a, b) => b.number - a.number || b.suffix.localeCompare(a.suffix));
  if (ranked.length === 0) throw new Error("no done tasks");
  return ranked[0].id;
}

function markdownLinks(source: string): string[] {
  const withoutFences = source.replace(/```[\s\S]*?```/g, "");
  return [...withoutFences.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1].trim());
}

const secretPatterns: RegExp[] = [
  /sk-[A-Za-z0-9]/,
  /oma_/,
  /Bearer /,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  /\b[a-fA-F0-9]{32,}\b/,
  /\b(?=[A-Za-z0-9+/]{40,}={0,2}\b)(?=.*[A-Z])(?=.*[a-z])(?=.*\d)[A-Za-z0-9+/]{40,}={0,2}\b/,
];

describe("user guide coverage", () => {
  const routes = appRoutes(read(join(webRoot, "src", "App.tsx")));
  const webRoutes = featureMap.flatMap((feature) => feature.webRoutes);

  it("covers every App route except redirects and the catch-all", () => {
    expect(routes.length).toBeGreaterThan(10);
    for (const route of routes) {
      const covered = webRoutes.some((web) => patternFits(route, web) || patternFits(web, route));
      expect(covered, route).toBe(true);
    }
  });

  it("covers every profile tab and every project tab", () => {
    const profileTabs = tabIds(read(join(webRoot, "src", "features", "profiles", "ProfileDetailPage.tsx")));
    const projectTabs = tabIds(read(join(webRoot, "src", "features", "projects", "ProjectDetailPage.tsx")));
    expect(profileTabs).toEqual(["direction", "brief", "topics", "automation", "insights", "accounts", "comments", "projects"]);
    expect(projectTabs).toContain("overview");
    expect(projectTabs).toContain("render");
    for (const tab of profileTabs) {
      expect(webRoutes.some((route) => route === `/profiles/:id/${tab}`), tab).toBe(true);
    }
    for (const tab of projectTabs) {
      expect(webRoutes.some((route) => route === `/projects/:id/${tab}`), tab).toBe(true);
    }
  });

  it("points each feature at a real file and anchor", () => {
    for (const feature of featureMap) {
      const page = helpPageId(feature.docPage);
      expect(isGuidePage(page), feature.key).toBe(true);
      const path = join(repoRoot, feature.docPage);
      const text = read(path);
      expect(anchorsInMarkdown(text).has(feature.docAnchor), `${feature.key} #${feature.docAnchor}`).toBe(true);
    }
  });

  it("rejects missing guide links, secrets and broken UTF-8", () => {
    const files = readdirSync(guideDir).filter((name) => name.endsWith(".md"));
    expect(files.map((name) => name.replace(/\.md$/, "")).sort()).toEqual([...GUIDE_PAGES].sort());
    for (const name of files) {
      const path = join(guideDir, name);
      const bytes = readFileSync(path);
      expect(bytes.includes(0), name).toBe(false);
      expect(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes)).not.toThrow();
      const text = new TextDecoder("utf-8").decode(bytes);
      for (const pattern of secretPatterns) {
        expect(text, name).not.toMatch(pattern);
      }
      for (const href of markdownLinks(text)) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
        const [filePart, anchor] = href.split("#");
        const targetName = (filePart || name).replace(/^\.\//, "");
        const targetPath = filePart ? join(guideDir, targetName) : path;
        expect(files.includes(targetName) || targetName === "", `${name} -> ${href}`).toBe(true);
        if (!anchor) continue;
        const target = read(targetPath);
        expect(anchorsInMarkdown(target).has(anchor), `${name} -> #${anchor}`).toBe(true);
      }
    }
  });

  it("requires a changelog entry for the newest finished task", () => {
    const newest = newestDoneTask();
    const changelog = read(join(guideDir, "nhat-ky-thay-doi.md"));
    expect(changelog).toContain(newest);
    expect(changelog).toContain(`## ${newest}`);
  });
});
