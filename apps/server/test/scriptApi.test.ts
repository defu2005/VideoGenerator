import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Project } from "@vg/shared";
import { buildApp } from "../src/app.js";
import { parseConfig, type AppConfig } from "../src/lib/config.js";
import { MergedStorySchema, ResearchNotesSchema, activeGuidelines, guidelinePromptBlock } from "@vg/shared";
import { mergedStoryPrompt } from "../src/stages/script/mergedStoryPrompt.js";
import { scriptPrompt } from "../src/stages/script/prompt.js";
import { z } from "zod";

const root = mkdtempSync(join(tmpdir(), "vg-script-api-test-"));
let config: AppConfig;
let app: ReturnType<typeof buildApp>;
let dataDir: string;

beforeEach(() => {
  dataDir = join(root, `run-${randomUUID()}`);
  config = parseConfig({
    DATA_DIR: dataDir,
    DATABASE_PATH: join(dataDir, "app.db"),
    WORKER_ENABLED: "false",
    LOG_LEVEL: "silent",
    LLM_DEFAULT_PROVIDER: "mock",
    ANTHROPIC_API_KEY: "never-return-this",
  });
  app = buildApp({ config });
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function createProject(settings?: unknown): Promise<Project> {
  const response = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: { title: "Script API", topic: "A topic", settings },
  });
  expect(response.statusCode).toBe(201);
  return response.json<Project>();
}

const userScript = {
  title: "Written by me",
  hook: "A short hook.",
  sections: [{
    id: "opening",
    heading: "Opening",
    narration: "My own narration.",
    visualQueries: { primary: "Notebook", alternatives: [] },
    visualNotes: "Notebook",
    musicMood: "",
    energy: "medium",
    estDurationSec: 1,
  }],
  outro: "Goodbye.",
  music: { mood: "", energy: "medium", keywords: [] },
};
const researchNotes = {
  summary: "Research summary.",
  keyFacts: Array.from({ length: 5 }, (_, index) => ({
    fact: `Fact ${index + 1}`,
    confidence: "medium" as const,
    sourceHint: null,
  })),
  timeline: [{ date: "Today", event: "An event" }],
  angles: ["A storytelling angle"],
  outline: [
    { section: "Opening", purpose: "Introduce the topic", points: ["One"] },
    { section: "Context", purpose: "Explain the background", points: ["Two"] },
    { section: "Conclusion", purpose: "Close the story", points: ["Three"] },
  ],
  cautions: ["Verify the dates"],
};

describe("script API", () => {
  it("validates and stores research, completes the user stage, and stales downstream stages on change", async () => {
    const project = await createProject({ stageExecutors: { script: "USER" } });
    const invalid = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/research`,
      payload: { summary: "Incomplete" },
    });
    expect(invalid.statusCode).toBe(400);

    await app.inject({ method: "POST", url: `/api/projects/${project.id}/pipeline/run`, payload: {} });
    const saved = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/research`,
      payload: researchNotes,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().research).toMatchObject({
      data: researchNotes,
      provider: "user",
      model: "user",
      cached: false,
    });
    const completed = await app.inject({ method: "GET", url: `/api/projects/${project.id}/pipeline` });
    expect(completed.json().stages.find((stage: { stage: string }) => stage.stage === "RESEARCH").state).toBe("DONE");
    expect(completed.json().stages.find((stage: { stage: string }) => stage.stage === "SCRIPT").state).toBe("WAITING_USER");

    const sqlite = new Database(config.DATABASE_PATH);
    sqlite.prepare("UPDATE project_stages SET state = 'DONE', progress = 100 WHERE project_id = ? AND stage IN ('SCRIPT', 'SCENE_PLAN')")
      .run(project.id);
    sqlite.close();
    const changed = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/research`,
      payload: { ...researchNotes, summary: "Updated research." },
    });
    expect(changed.statusCode).toBe(200);
    const stale = await app.inject({ method: "GET", url: `/api/projects/${project.id}/pipeline` });
    expect(stale.json().stages.find((stage: { stage: string }) => stage.stage === "SCRIPT").state).toBe("WAITING_USER");
    expect(stale.json().stages.find((stage: { stage: string }) => stage.stage === "SCENE_PLAN").state).toBe("STALE");
  });

  it("rejects research saves while a job is active", async () => {
    const project = await createProject();
    await app.inject({ method: "POST", url: `/api/projects/${project.id}/pipeline/run`, payload: {} });
    const response = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/research`,
      payload: researchNotes,
    });
    expect(response.statusCode).toBe(409);
  });

  it("returns shared prompt content and JSON schemas for the exact executor prompts", async () => {
    const project = await createProject({ budget: { mode: "ECO" } });
    await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/research`,
      payload: researchNotes,
    });
    const storyGuidance = guidelinePromptBlock(activeGuidelines(project), ["script", "subtitles"]);
    const story = await app.inject({ method: "GET", url: `/api/projects/${project.id}/prompts/STORY` });
    expect(story.statusCode).toBe(200);
    expect(story.json()).toMatchObject({
      stage: "STORY",
      system: mergedStoryPrompt(project, config.SPEECH_WORDS_PER_MINUTE, "standard", storyGuidance).system,
      user: mergedStoryPrompt(project, config.SPEECH_WORDS_PER_MINUTE, "standard", storyGuidance).prompt,
      jsonSchema: z.toJSONSchema(MergedStorySchema),
      language: project.settings.language,
      targetDurationSec: project.settings.targetDurationSec,
    });

    const researchResponse = await app.inject({ method: "GET", url: `/api/projects/${project.id}/prompts/RESEARCH` });
    expect(researchResponse.json().system).toBe(story.json().system);
    expect(researchResponse.json().user).toBe(story.json().user);

    const script = await app.inject({ method: "GET", url: `/api/projects/${project.id}/prompts/SCRIPT` });
    expect(script.statusCode).toBe(200);
    expect(script.json().system).toBe(scriptPrompt(project, ResearchNotesSchema.parse(researchNotes), config.SPEECH_WORDS_PER_MINUTE, storyGuidance).system);
    expect(script.json().user).toBe(scriptPrompt(project, ResearchNotesSchema.parse(researchNotes), config.SPEECH_WORDS_PER_MINUTE, storyGuidance).prompt);
  });

  it("includes the compact resolved brief line in the existing story prompt", async () => {
    const project = await createProject({
      platform: "youtube_shorts",
      style: "documentary",
      tone: "serious",
      audience: "students",
    });
    const response = await app.inject({ method: "GET", url: `/api/projects/${project.id}/prompts/STORY` });
    expect(response.statusCode).toBe(200);
    expect(response.json().user).toContain(
      "Style: documentary; tone: serious; audience: students; platform: youtube_shorts (vertical, fast pacing)",
    );
  });

  it("stores user scripts, skips research, versions edits, and stales downstream stages", async () => {
    const project = await createProject({ stageExecutors: { script: "USER" } });
    const initial = await app.inject({ method: "GET", url: `/api/projects/${project.id}/script` });
    expect(initial.json()).toMatchObject({ script: null, research: null, origin: null, version: 0, stale: false });

    const run = await app.inject({ method: "POST", url: `/api/projects/${project.id}/pipeline/run`, payload: {} });
    expect(run.json().stages.find((stage: { stage: string }) => stage.stage === "RESEARCH").state).toBe("WAITING_USER");
    const saved = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/script`,
      payload: userScript,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ origin: "USER", version: 1, stale: false, script: { origin: "USER" } });
    const pipeline = await app.inject({ method: "GET", url: `/api/projects/${project.id}/pipeline` });
    expect(pipeline.json().stages.find((stage: { stage: string }) => stage.stage === "RESEARCH").state).toBe("SKIPPED");
    expect(pipeline.json().stages.find((stage: { stage: string }) => stage.stage === "SCRIPT").state).toBe("DONE");
    await app.inject({ method: "POST", url: `/api/projects/${project.id}/pipeline/cancel` });

    const sqlite = new Database(config.DATABASE_PATH);
    sqlite.prepare("UPDATE project_stages SET state = 'DONE', progress = 100 WHERE project_id = ? AND stage IN ('SCENE_PLAN', 'VISUAL_SEARCH', 'VISUAL_REVIEW')")
      .run(project.id);
    sqlite.close();
    const edited = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/script`,
      payload: { ...userScript, hook: "A changed hook." },
    });
    expect(edited.json()).toMatchObject({ origin: "USER", version: 2 });
    const afterEdit = await app.inject({ method: "GET", url: `/api/projects/${project.id}/pipeline` });
    expect(afterEdit.json().stages.find((stage: { stage: string }) => stage.stage === "SCENE_PLAN").state).toBe("STALE");
    expect(afterEdit.json().stages.find((stage: { stage: string }) => stage.stage === "VISUAL_SEARCH").state).toBe("STALE");
    expect(afterEdit.json().stages.find((stage: { stage: string }) => stage.stage === "VISUAL_REVIEW").state).toBe("STALE");
  });

  it("rejects saves while a job is active", async () => {
    const project = await createProject();
    await app.inject({ method: "POST", url: `/api/projects/${project.id}/pipeline/run`, payload: {} });
    const response = await app.inject({ method: "PUT", url: `/api/projects/${project.id}/script`, payload: userScript });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("INVALID_PIPELINE_STATE");
  });

  it("returns provider metadata without exposing API keys", async () => {
    const response = await app.inject({ method: "GET", url: "/api/llm/providers" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toContainEqual(expect.objectContaining({
      id: "anthropic",
      label: "Anthropic",
      configured: true,
      defaultModel: "claude-haiku-5-5",
      usage: { monthCalls: 0 },
    }));
    expect(response.body).not.toContain("never-return-this");
    expect(response.json().find((provider: { id: string }) => provider.id === "ollama"))
      .toMatchObject({ configured: false, hint: "Set OLLAMA_MODEL" });
  });
});
