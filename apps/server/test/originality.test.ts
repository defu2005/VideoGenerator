import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTimeline, ScriptSchema, VideoLookSchema, type Project, type VideoLook } from "@vg/shared";
import * as schema from "../src/db/schema.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { OriginalityService } from "../src/originality/service.js";
import { buildSourceManifest, publicSourceUrl } from "../src/originality/manifest.js";
import { GuidelineService } from "../src/guidelines/service.js";
import { evaluatePublishGuardrail } from "../src/publishing/guardrail.js";
import { ASSISTANT_TOOLS } from "../src/assistant/tools.js";

const open: Database.Database[] = [];
const now = "2026-11-12T00:00:00.000Z";
const narration = "Chúng ta phân tích các nguyên nhân để giải thích sự thay đổi và so sánh hai kết quả một cách độc lập.";
const script = ScriptSchema.parse({ title: "Phân tích", hook: "Vì sao?", sections: [{ id: "analysis", heading: "Giải thích nguyên nhân", narration }], outro: "Kết luận." });
function fixture() {
  const sqlite = new Database(":memory:"); open.push(sqlite); sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }); migrateDatabase(db);
  const profileId = randomUUID();
  sqlite.prepare("INSERT INTO profiles (id,name,default_brief,guidelines,created_at,updated_at) VALUES (?,?,'{}','{}',?,?)").run(profileId, profileId, now, now);
  function project(channel: string | null = profileId) {
    const id = randomUUID(); const sceneId = randomUUID(); const voiceId = randomUUID();
    sqlite.prepare("INSERT INTO projects (id,title,topic,mode,settings,status,stage,profile_id,created_at,updated_at) VALUES (?,'Video','Topic','AUTO','{}','DONE','RENDER',?,?,?)").run(id, channel, now, now);
    sqlite.prepare("INSERT INTO scripts (project_id,data,origin,input_hash,updated_at) VALUES (?,?,'USER','fixture',?)").run(id, JSON.stringify(script), now);
    sqlite.prepare(`INSERT INTO scenes (id,project_id,"order",kind,section_id,label,narration,visual_notes,visual_queries,music_mood,energy,est_duration_sec,start_sec,transition_note,origin,input_hash,created_at,updated_at)
      VALUES (?,?,0,'BODY','analysis','Giải thích',?,'','{}','','medium',10,0,'','USER','fixture',?,?)`).run(sceneId, id, narration, now, now);
    sqlite.prepare(`INSERT INTO voice_tracks (id,project_id,scene_id,provider,voice,rate,origin,audio_path,duration_sec,input_hash,created_at,updated_at)
      VALUES (?,?,?,'mock','fixture','0%','USER','voice.wav',10,'fixture',?,?)`).run(voiceId, id, sceneId, now, now);
    const timeline = buildTimeline({
      aspectRatio: "16:9",
      musicEnabled: false,
      music: null,
      scenes: [{
        id: sceneId, order: 0, label: "Giải thích", noVisual: true, durationOverrideSec: null, estDurationSec: 10,
        voice: { trackId: voiceId, path: "voice.wav", durationSec: 10 }, visuals: [],
      }],
    });
    const { voiceOffsets: _, ...built } = timeline;
    // A full-screen template has its own evidence, independent of the placeholder underneath.
    const data = {
      ...built,
      subtitles: null,
      graphics: [{ id: "own", templateId: "quote_card" as const, sceneId, startSec: 0, durationSec: built.totalDurationSec, layer: "fullscreen" as const, source: "user" as const, variables: { quote: "Giải thích" } }],
    };
    sqlite.prepare("INSERT INTO timelines (project_id,data,input_hash,total_duration_sec,created_at,updated_at) VALUES (?,?,'fixture',?,?,?)").run(id, JSON.stringify(data), data.totalDurationSec, now, now);
    sqlite.prepare("INSERT INTO research_notes (project_id,input_hash,provider,model,created_at,data) VALUES (?,'fixture','mock','fixture',?,?)").run(id, now, JSON.stringify({ keyFacts: [{ sourceHint: "Nguồn https://example.org/research" }] }));
    return { id, sceneId, timeline: data };
  }
  function rendered(id: string) {
    const renderId = randomUUID();
    sqlite.prepare(`INSERT INTO renders (id,project_id,input_hash,status,output_path,credits_path,duration_sec,size_bytes,width,height,report,created_at)
      VALUES (?,?,'fixture','DONE','fixture.mp4','credits.txt',10,1,1280,720,'{"ok":true}',?)`).run(renderId, id, now);
    new OriginalityService(sqlite).recheck(id, { id: renderId, plan: null });
    return renderId;
  }
  return { sqlite, project, rendered, service: new OriginalityService(sqlite), profileId };
}
afterEach(() => { for (const db of open.splice(0)) db.close(); });
describe("source manifest and gate", () => {
  it("builds stored evidence, sanitizes URLs, and recognizes structured analysis without AI", () => {
    const f = fixture(); const p = f.project(); const report = f.service.recheck(p.id);
    expect(report.manifest?.script.sources).toEqual([{ url: "https://example.org/research", title: "Nguồn" }]);
    expect(report.manifest?.script.hasAnalysis).toBe(true);
    expect(report.manifest?.voice[0]?.provider).toBe("mock");
    expect(report.manifest?.contribution.ownShare).toBe(1);
    expect(publicSourceUrl("https://example.org/image?token=fixture#fragment")).toBe("https://example.org/image");
    expect(publicSourceUrl("https://user:password@example.org")).toBeNull();
    expect(publicSourceUrl("file:///private")).toBeNull();
    expect(buildSourceManifest({ script, research: null, timeline: null, candidates: [], scenes: [], voices: [], timelineHash: "none" }).contribution.ownShare).toBe(0);
  });
  it("compares the same channel, writes MUST, deduplicates and forces private", () => {
    const f = fixture(); const first = f.project(); f.rendered(first.id);
    const second = f.project(); const renderId = f.rendered(second.id);
    const report = f.service.recheck(second.id);
    expect(report.scores?.script).toMatchObject({ projectId: first.id, similarity: 1 });
    expect(report.findings.find((x) => x.ruleId === "ORIG_SCRIPT_SIMILAR")).toMatchObject({ severity: "MUST", source: "CODE", stage: "TIMELINE" });
    expect(evaluatePublishGuardrail(f.sqlite, second.id, renderId).forcePrivate).toBe(true);
    f.service.recheck(second.id); f.service.recheck(second.id);
    expect(f.service.get(second.id).findings.filter((x) => x.status === "OPEN")).toHaveLength(report.findings.filter((x) => x.status === "OPEN").length);
    expect(f.sqlite.prepare("SELECT COUNT(*) n FROM source_manifests WHERE project_id=?").get(second.id)).toEqual({ n: 1 });
    expect(f.sqlite.prepare("SELECT COUNT(*) n FROM operator_requests WHERE dedupe_key=? AND status='open'").get(`originality:${second.id}`)).toEqual({ n: 1 });
    const other = f.project(null);
    expect(f.service.recheck(other.id).scores?.comparedProjects).toBe(0);
  });
  it("requires a reason, retains dismissals on identical evidence, and reopens changed evidence", () => {
    const f = fixture(); const p = f.project(); const renderId = f.rendered(p.id);
    const guidelines = new GuidelineService(f.sqlite);
    for (const finding of f.service.get(p.id).findings.filter((x) => x.status === "OPEN")) {
      expect(() => guidelines.dismiss(p.id, finding.id)).toThrow("Ghi lý do");
      guidelines.dismiss(p.id, finding.id, "Đã tự kiểm tra nguồn gốc");
    }
    expect(f.service.recheck(p.id).verdict).toBe("OK");
    expect(f.service.get(p.id).manifest?.history[0]?.reason).toBe("Đã tự kiểm tra nguồn gốc");
    expect(evaluatePublishGuardrail(f.sqlite, p.id, renderId).forcePrivate).toBe(false);
    guidelines.replaceFindings(p.id, "TIMELINE", "CODE", []);
    f.sqlite.prepare("UPDATE research_notes SET data='{}' WHERE project_id=?").run(p.id);
    expect(evaluatePublishGuardrail(f.sqlite, p.id, renderId).forcePrivate).toBe(true);
    expect(f.service.get(p.id).findings.some((x) => x.ruleId === "ORIG_NO_EVIDENCE" && x.status === "OPEN")).toBe(true);
    expect(f.service.get(p.id).manifest?.history).toHaveLength(1);
  });
  it("does not clear unrelated findings and refuses a stale or unrecorded render", () => {
    const f = fixture(); const p = f.project(); const renderId = f.rendered(p.id);
    new GuidelineService(f.sqlite).replaceFindings(p.id, "TIMELINE", "CODE", [{ ruleId: "unrelated", severity: "TIP", sceneId: null, text: "Giữ lại", quote: null, suggestion: null }]);
    f.service.recheck(p.id);
    expect(f.sqlite.prepare("SELECT status FROM guideline_findings WHERE rule_id='unrelated'").get()).toEqual({ status: "OPEN" });
    f.sqlite.prepare("UPDATE timelines SET data=json_set(data,'$.revision',1) WHERE project_id=?").run(p.id);
    expect(evaluatePublishGuardrail(f.sqlite, p.id, renderId).reason).toContain("khớp timeline");
    expect(evaluatePublishGuardrail(f.sqlite, p.id, randomUUID()).forcePrivate).toBe(true);
    expect(ASSISTANT_TOOLS.get_originality_report?.risk).toBe("read");
  });
});

describe("visual sameness in originality", () => {
  function makeLook(opts: {
    videoId: string;
    channelId?: string;
    combos?: Array<{ templateId: string; key: string; sec: number }>;
    kindShare?: Record<string, number>;
    frameHashes?: string[];
    palette?: string[];
    fingerprint?: string;
  }): VideoLook {
    return VideoLookSchema.parse({
      videoId: opts.videoId,
      channelId: opts.channelId ?? "ch1",
      createdAt: now,
      style: {
        packId: "pack1",
        packVersion: 1,
        fingerprint: opts.fingerprint ?? "fp-1",
        palette: opts.palette ?? ["#0F172A", "#F5C518", "#FFFFFF"],
        fonts: ["font1", "font2"],
        layout: "editorial",
        ease: "smooth",
        caseDisplay: "none",
        backgrounds: ["bg1"],
      },
      combos: opts.combos ?? [{ templateId: "list_full", key: "layout=cards", sec: 5 }],
      kindShare: opts.kindShare ?? { list_full: 1 },
      frameHashes: opts.frameHashes ?? ["aaaa5555aaaa5555", "aaaa5555aaaa5555"],
    });
  }

  function saveLook(sqlite: Database.Database, input: {
    projectId: string;
    renderId: string;
    profileId: string | null;
    look: VideoLook;
    workspaceId?: string | null;
  }) {
    sqlite.prepare(`
      INSERT INTO video_looks (id, project_id, render_id, profile_id, pack_id, pack_version, fingerprint, look, created_at, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      input.projectId,
      input.renderId,
      input.profileId,
      input.look.style.packId ?? "",
      input.look.style.packVersion ?? 1,
      input.look.style.fingerprint,
      JSON.stringify(input.look),
      now,
      input.workspaceId ?? null,
    );
  }

  it("two near-identical looks in one channel produce a warn issue in the report", () => {
    const f = fixture();
    const first = f.project();
    const r1 = f.rendered(first.id);
    const look1 = makeLook({ videoId: r1, channelId: f.profileId });
    saveLook(f.sqlite, { projectId: first.id, renderId: r1, profileId: f.profileId, look: look1 });

    const second = f.project();
    // Use different script to isolate visual sameness from script similarity
    const s2 = ScriptSchema.parse({
      title: "Kinh tế học",
      hook: "Khác biệt hoàn toàn",
      sections: [{ id: "econ", heading: "Giải thích kinh tế", narration: "Một chủ đề kinh tế khác không trùng từ ngữ với kịch bản trước." }],
      outro: "Hết.",
    });
    f.sqlite.prepare("UPDATE scripts SET data = ? WHERE project_id = ?").run(JSON.stringify(s2), second.id);
    f.sqlite.prepare("UPDATE scenes SET section_id = 'econ', narration = ? WHERE project_id = ?").run(s2.sections[0]!.narration, second.id);
    f.sqlite.prepare("UPDATE video_metadata SET draft = ? WHERE project_id = ?").run(JSON.stringify({ titles: ["Kinh tế học"] }), second.id);

    const r2 = f.rendered(second.id);
    const look2 = makeLook({ videoId: r2, channelId: f.profileId });
    saveLook(f.sqlite, { projectId: second.id, renderId: r2, profileId: f.profileId, look: look2 });

    const report = f.service.recheck(second.id, { id: r2, plan: null });
    expect(report.scores?.visualSameness?.channelScore).toBeGreaterThan(0.85);
    expect(report.scores?.visualSameness?.closestVideo).toMatchObject({
      projectId: first.id,
      similarity: expect.any(Number),
    });
    expect(report.scores?.visualSameness?.drivingPart).toBeTruthy();

    const issue = report.findings.find((x) => x.ruleId === "ORIG_VISUAL_SAME_CHANNEL");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("SHOULD");

    const guidelines = new GuidelineService(f.sqlite);
    for (const finding of report.findings.filter((x) => x.status === "OPEN" && x.ruleId !== "ORIG_VISUAL_SAME_CHANNEL")) {
      guidelines.dismiss(second.id, finding.id, "Đã tự duyệt giấy phép");
    }
    const cleanReport = f.service.recheck(second.id, { id: r2, plan: null });
    expect(cleanReport.verdict).toBe("OK");
    expect(cleanReport.findings.find((x) => x.ruleId === "ORIG_VISUAL_SAME_CHANNEL" && x.status === "OPEN")).toBeDefined();
  });

  it("different looks produce no issue", () => {
    const f = fixture();
    const first = f.project();
    const r1 = f.rendered(first.id);
    const look1 = makeLook({
      videoId: r1,
      channelId: f.profileId,
      combos: [{ templateId: "list_full", key: "layout=cards", sec: 5 }],
      kindShare: { list_full: 1 },
      frameHashes: ["aaaa5555aaaa5555"],
    });
    saveLook(f.sqlite, { projectId: first.id, renderId: r1, profileId: f.profileId, look: look1 });

    const second = f.project();
    const s2 = ScriptSchema.parse({
      title: "Vũ trụ học",
      hook: "Các vì sao",
      sections: [{ id: "astro", heading: "Khám phá", narration: "Khám phá không gian vũ trụ và các thiên hà xa xôi." }],
      outro: "Hết.",
    });
    f.sqlite.prepare("UPDATE scripts SET data = ? WHERE project_id = ?").run(JSON.stringify(s2), second.id);
    f.sqlite.prepare("UPDATE scenes SET section_id = 'astro', narration = ? WHERE project_id = ?").run(s2.sections[0]!.narration, second.id);
    f.sqlite.prepare("UPDATE video_metadata SET draft = ? WHERE project_id = ?").run(JSON.stringify({ titles: ["Vũ trụ học"] }), second.id);

    const r2 = f.rendered(second.id);
    const look2 = makeLook({
      videoId: r2,
      channelId: f.profileId,
      combos: [{ templateId: "map", key: "layout=globe", sec: 5 }],
      kindShare: { map: 1 },
      frameHashes: ["0000000000000000"],
    });
    saveLook(f.sqlite, { projectId: second.id, renderId: r2, profileId: f.profileId, look: look2 });

    const report = f.service.recheck(second.id, { id: r2, plan: null });
    expect(report.scores?.visualSameness?.channelScore).toBeLessThan(0.85);
    expect(report.findings.some((x) => x.ruleId === "ORIG_VISUAL_SAME_CHANNEL")).toBe(false);
  });

  it("the cross-channel case flags similar looks between different channels", () => {
    const f = fixture();
    const profile2 = randomUUID();
    f.sqlite.prepare("INSERT INTO profiles (id,name,default_brief,guidelines,created_at,updated_at) VALUES (?,?,'{}','{}',?,?)").run(profile2, profile2, now, now);

    const first = f.project(f.profileId);
    const r1 = f.rendered(first.id);
    const look1 = makeLook({ videoId: r1, channelId: f.profileId, fingerprint: "fp-shared" });
    saveLook(f.sqlite, { projectId: first.id, renderId: r1, profileId: f.profileId, look: look1 });

    const second = f.project(profile2);
    const s2 = ScriptSchema.parse({
      title: "Kênh thứ hai",
      hook: "Chủ đề hoàn toàn độc lập",
      sections: [{ id: "s2", heading: "Độc lập", narration: "Nội dung độc lập hoàn toàn để không kích hoạt kiểm tra kịch bản." }],
      outro: "Hết.",
    });
    f.sqlite.prepare("UPDATE scripts SET data = ? WHERE project_id = ?").run(JSON.stringify(s2), second.id);
    f.sqlite.prepare("UPDATE scenes SET section_id = 's2', narration = ? WHERE project_id = ?").run(s2.sections[0]!.narration, second.id);
    f.sqlite.prepare("UPDATE video_metadata SET draft = ? WHERE project_id = ?").run(JSON.stringify({ titles: ["Kênh thứ hai"] }), second.id);

    const r2 = f.rendered(second.id);
    const look2 = makeLook({ videoId: r2, channelId: profile2, fingerprint: "fp-shared" });
    saveLook(f.sqlite, { projectId: second.id, renderId: r2, profileId: profile2, look: look2 });

    const report = f.service.recheck(second.id, { id: r2, plan: null });
    expect(report.scores?.visualSameness?.crossChannelScore).toBeGreaterThan(0.7);
    const issue = report.findings.find((x) => x.ruleId === "ORIG_VISUAL_CROSS_CHANNEL");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("SHOULD");
  });

  it("a missing look, or a look with empty frame hashes, still produces a report, using the parts it has", () => {
    const f = fixture();
    const first = f.project();
    // Project without look: recheck succeeds
    const report1 = f.service.recheck(first.id);
    expect(report1.scores?.visualSameness).toBeNull();
    expect(report1.verdict).toBeDefined();

    // With empty frame hashes
    const r1 = f.rendered(first.id);
    const look1 = makeLook({ videoId: r1, channelId: f.profileId, frameHashes: [] });
    saveLook(f.sqlite, { projectId: first.id, renderId: r1, profileId: f.profileId, look: look1 });

    const second = f.project();
    const r2 = f.rendered(second.id);
    const look2 = makeLook({ videoId: r2, channelId: f.profileId, frameHashes: [] });
    saveLook(f.sqlite, { projectId: second.id, renderId: r2, profileId: f.profileId, look: look2 });

    const report2 = f.service.recheck(second.id, { id: r2, plan: null });
    expect(report2.scores?.visualSameness).toBeDefined();
    expect(report2.scores?.visualSameness?.parts?.frames).toBeNull();
    expect(report2.scores?.visualSameness?.parts?.combos).not.toBeNull();
    expect(report2.scores?.visualSameness?.channelScore).not.toBeNull();
  });

  it("a compute error only logs", () => {
    const f = fixture();
    const p = f.project();
    f.rendered(p.id);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    f.sqlite.exec("DROP TABLE video_looks");
    try {
      const report = f.service.recheck(p.id);
      expect(report.scores?.visualSameness).toBeNull();
      const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("[originality] visual sameness computation failed");
    } finally {
      warn.mockRestore();
    }
  });

  it("block level sends the project to manual review", () => {
    const f = fixture();
    f.sqlite.prepare("UPDATE profiles SET guidelines = ? WHERE id = ?").run(
      JSON.stringify({ originality: { visualSameness: { level: "block" } } }),
      f.profileId,
    );

    const first = f.project();
    const r1 = f.rendered(first.id);
    const look1 = makeLook({ videoId: r1, channelId: f.profileId });
    saveLook(f.sqlite, { projectId: first.id, renderId: r1, profileId: f.profileId, look: look1 });

    const second = f.project();
    const s2 = ScriptSchema.parse({
      title: "Chủ đề riêng",
      hook: "Khác",
      sections: [{ id: "sec", heading: "Khác", narration: "Nội dung riêng biệt hoàn toàn không trùng từ ngữ." }],
      outro: "Hết.",
    });
    f.sqlite.prepare("UPDATE scripts SET data = ? WHERE project_id = ?").run(JSON.stringify(s2), second.id);
    f.sqlite.prepare("UPDATE scenes SET section_id = 'sec', narration = ? WHERE project_id = ?").run(s2.sections[0]!.narration, second.id);
    f.sqlite.prepare("UPDATE video_metadata SET draft = ? WHERE project_id = ?").run(JSON.stringify({ titles: ["Chủ đề riêng"] }), second.id);

    const r2 = f.rendered(second.id);
    const look2 = makeLook({ videoId: r2, channelId: f.profileId });
    saveLook(f.sqlite, { projectId: second.id, renderId: r2, profileId: f.profileId, look: look2 });

    const report = f.service.recheck(second.id, { id: r2, plan: null });
    expect(report.scores?.visualSameness?.channelScore).toBeGreaterThan(0.85);

    const issue = report.findings.find((x) => x.ruleId === "ORIG_VISUAL_SAME_CHANNEL");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("MUST");
    expect(report.verdict).toBe("REVIEW");

    const req = f.sqlite.prepare("SELECT COUNT(*) AS n FROM operator_requests WHERE dedupe_key = ? AND status = 'open'").get(`originality:${second.id}`) as { n: number };
    expect(req.n).toBe(1);
  });
});
