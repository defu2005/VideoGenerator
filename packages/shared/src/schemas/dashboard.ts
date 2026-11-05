import { z } from "zod";
import { PROJECT_STATUSES, ProjectStatusSchema } from "../enums.js";
import { ProjectSchema } from "./project.js";
import { JobErrorSummarySchema } from "./job.js";
import { AutomationLogEntrySchema } from "./automation.js";
import { TrendIdeaCardSchema } from "./trends.js";

export const DashboardAutomationCardSchema = z.object({
  paused: z.boolean(),
  runningProfileName: z.string().nullable(),
  nextProductionAt: z.string().datetime({ offset: true }).nullable(),
  todayCount: z.number().int().nonnegative(),
  recentErrors: z.array(AutomationLogEntrySchema).max(5),
});
export type DashboardAutomationCard = z.infer<typeof DashboardAutomationCardSchema>;

export const DashboardStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  byStatus: z.record(ProjectStatusSchema, z.number().int().nonnegative()),
  archived: z.number().int().nonnegative(),
  recent: z.array(ProjectSchema).max(5),
  recentErrors: z.array(JobErrorSummarySchema).max(10),
  automation: DashboardAutomationCardSchema.optional(),
  /** Top matched trend ideas across profiles (TASK-039). */
  trendsToday: z.array(TrendIdeaCardSchema).max(5).optional(),
}).superRefine((stats, context) => {
  for (const status of PROJECT_STATUSES) {
    if (!(status in stats.byStatus)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["byStatus", status],
        message: `Missing status count: ${status}`,
      });
    }
  }
});
export type DashboardStats = z.infer<typeof DashboardStatsSchema>;
