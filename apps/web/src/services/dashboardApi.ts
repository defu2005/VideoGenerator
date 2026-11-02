import type { DashboardStats } from "@vg/shared";
import { apiRequest } from "./apiClient";

export function getDashboardStats(): Promise<DashboardStats> {
  return apiRequest<DashboardStats>("/dashboard/stats");
}
