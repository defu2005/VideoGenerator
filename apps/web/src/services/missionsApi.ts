import { apiRequest } from "./apiClient";

// TASK-129c: the user's mission routes. The user clears holds and cancels; gate approval stays on the project page.
export type MissionState = "planning" | "producing" | "waiting_user" | "scheduled" | "published" | "measuring" | "done" | "failed" | "cancelled";

export type Mission = {
  id: string;
  command: string;
  state: MissionState;
  owner: string | null;
  autonomyLevel: string;
  projectIds: string[];
  plan: Array<Record<string, unknown>>;
  report: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MissionCheckpoint = { kind: string; at: string; metrics: unknown; report: unknown };

export const listMissions = async (): Promise<{ missions: Mission[] }> => apiRequest("/missions");
export const getMission = async (id: string): Promise<{ mission: Mission; checkpoints: MissionCheckpoint[] }> =>
  apiRequest(`/missions/${encodeURIComponent(id)}`);
export const createMission = async (command: string): Promise<{ mission: Mission }> =>
  apiRequest("/missions", { method: "POST", body: JSON.stringify({ command }), headers: { "Content-Type": "application/json" } });
export const resumeMission = async (id: string): Promise<{ mission: Mission }> =>
  apiRequest(`/missions/${encodeURIComponent(id)}/resume`, { method: "POST" });
export const cancelMission = async (id: string): Promise<{ mission: Mission }> =>
  apiRequest(`/missions/${encodeURIComponent(id)}/cancel`, { method: "POST" });
