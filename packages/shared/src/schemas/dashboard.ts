import { z } from "zod";
import { PROJECT_STATUSES, ProjectStatusSchema } from "../enums.js";
import { ProjectSchema } from "./project.js";
import { JobErrorSummarySchema } from "./job.js";

export const DashboardStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  byStatus: z.record(ProjectStatusSchema, z.number().int().nonnegative()),
  archived: z.number().int().nonnegative(),
  recent: z.array(ProjectSchema).max(5),
  recentErrors: z.array(JobErrorSummarySchema).max(10),
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
