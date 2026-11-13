import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { buildTimeline, ScriptSchema, type Project } from "@vg/shared";
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
