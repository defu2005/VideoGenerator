import { afterEach, describe, expect, it, vi } from "vitest";
import { createPipelineHarness, drainUntilGate } from "./pipelineFixtures.js";
import { TEST_WORKSPACE_ID } from "./testActor.js";
import { createMission, getMission, moveMissionByAgent, setMissionPlan } from "../src/missions/missions.js";
import { advanceMissions, markMissionScheduled, recordPublished, resumeMissionByUser, type MeasureFn } from "../src/missions/checkpoints.js";

// TASK-129c: end-to-end flows across the mission modules. Fakes only: no network, no real LLM, no Telegram.
// The owner is an agent instance id that the mission is created for; the duty lease is not needed for these moves.
const OWNER = "agent-flow";
const T0 = new Date("2026-11-18T00:00:00.000Z");
const at = (hours: number) => new Date(T0.getTime() + hours * 3_600_000);
const okMeasure = (): MeasureFn => vi.fn(async (_m, kind) => ({ report: `Báo cáo ${kind}: 120 lượt xem.`, metrics: { views: 120 } }));

const harnesses: Array<ReturnType<typeof createPipelineHarness>> = [];
afterEach(() => {
  for (const h of harnesses.splice(0)) h.close();
});

describe("mission flows (TASK-129c)", () => {
  it("a command creates a mission in planning, and the owner writes its plan", () => {
    const pipeline = createPipelineHarness({ mode: "ASSISTED" });
    harnesses.push(pipeline);
    const { sqlite } = pipeline;
    const mission = createMission(sqlite, TEST_WORKSPACE_ID, { command: "làm 2 video về Berserk", channelProfileId: null, projectIds: [] } as never, { createdBy: "user", owner: OWNER });
    expect(mission.state).toBe("planning");
    expect(mission.command).toBe("làm 2 video về Berserk");

    const planned = setMissionPlan(sqlite, TEST_WORKSPACE_ID, mission.id, OWNER, [{ title: "Kịch bản video 1" }, { title: "Kịch bản video 2" }]);
    expect(planned.state).toBe("planning");
    const stored = sqlite.prepare("SELECT plan FROM missions WHERE id = ?").get(mission.id) as { plan: string };
    expect(JSON.parse(stored.plan)).toHaveLength(2);
  });

  it("gate hold: a producing mission waits at a gate, the user resumes it, and it is producing again", async () => {
    const pipeline = createPipelineHarness({ mode: "ASSISTED" });
    harnesses.push(pipeline);
    const { sqlite } = pipeline;
    // The harness project is not in TEST_WORKSPACE_ID, so createMission would refuse it; attach it directly, as missionOrchestratorHold does.
    const mission = createMission(sqlite, TEST_WORKSPACE_ID, { command: "làm video", channelProfileId: null, projectIds: [] } as never, { createdBy: "user", owner: OWNER });
    sqlite.prepare("UPDATE missions SET state = 'producing', project_ids = ? WHERE id = ?").run(JSON.stringify([pipeline.projectId]), mission.id);

    pipeline.orchestrator.runAll(pipeline.projectId);
    await drainUntilGate(pipeline);
    expect(getMission(sqlite, TEST_WORKSPACE_ID, mission.id).state).toBe("waiting_user");

    const resumed = resumeMissionByUser(sqlite, TEST_WORKSPACE_ID, mission.id);
    expect(resumed.state).toBe("producing");
  });

  it("happy path: planning → producing → scheduled → published → measuring → done", async () => {
    const pipeline = createPipelineHarness({ mode: "AUTO" });
    harnesses.push(pipeline);
    const { sqlite } = pipeline;
    const mission = createMission(sqlite, TEST_WORKSPACE_ID, { command: "làm video", channelProfileId: null, projectIds: [] } as never, { createdBy: "user", owner: OWNER });

    moveMissionByAgent(sqlite, TEST_WORKSPACE_ID, mission.id, OWNER, "producing");
    markMissionScheduled(sqlite, TEST_WORKSPACE_ID, mission.id, T0);
    expect(getMission(sqlite, TEST_WORKSPACE_ID, mission.id).state).toBe("scheduled");

    recordPublished(sqlite, TEST_WORKSPACE_ID, mission.id, T0);
    expect(getMission(sqlite, TEST_WORKSPACE_ID, mission.id).state).toBe("published");

    const fired = await advanceMissions(sqlite, at(24 * 7), okMeasure());
    expect(fired.map((f) => f.kind)).toEqual(["2h", "24h", "72h", "7d"]);
    expect(getMission(sqlite, TEST_WORKSPACE_ID, mission.id).state).toBe("done");
    const reports = sqlite.prepare("SELECT kind, report FROM mission_checkpoints WHERE mission_id = ? AND kind IN ('2h', '24h', '72h', '7d')").all(mission.id) as Array<{ kind: string; report: string | null }>;
    expect(reports.map((r) => r.kind).sort()).toEqual(["24h", "2h", "72h", "7d"].sort());
    expect(reports.every((r) => typeof r.report === "string" && r.report.length > 0)).toBe(true);
  });
});
