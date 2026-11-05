import { z } from "zod";

/** HH:mm 24h clock. */
export const PublishTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be HH:mm");
export type PublishTime = z.infer<typeof PublishTimeSchema>;

export const ProfileAutomationSchema = z.object({
  enabled: z.boolean().default(false),
  timezone: z.string().min(1).max(80).default("Asia/Ho_Chi_Minh"),
  videosPerDay: z.number().int().min(1).max(10).default(1),
  publishTimes: z.array(PublishTimeSchema).min(1).default(["19:00"]),
  leadTimeHours: z.number().int().min(0).max(72).default(6),
  autoSuggest: z.boolean().default(false),
  autoApproveTopics: z.boolean().default(false),
  /** null / omitted = all enabled accounts of the profile. */
  accountIds: z.array(z.string().uuid()).nullable().default(null),
  /** After a long render, propose and export vertical clips with no user gate. */
  autoShorts: z.boolean().default(false),
  /** How many clips to cut from each long video when autoShorts is on. */
  shortsPerVideo: z.number().int().min(1).max(8).default(3),
}).strict();
export type ProfileAutomation = z.infer<typeof ProfileAutomationSchema>;

export const ProfileAutomationInputSchema = z.object({
  enabled: z.boolean().optional(),
  timezone: z.string().min(1).max(80).optional(),
  videosPerDay: z.number().int().min(1).max(10).optional(),
  publishTimes: z.array(PublishTimeSchema).min(1).optional(),
  leadTimeHours: z.number().int().min(0).max(72).optional(),
  autoSuggest: z.boolean().optional(),
  autoApproveTopics: z.boolean().optional(),
  accountIds: z.array(z.string().uuid()).nullable().optional(),
  autoShorts: z.boolean().optional(),
  shortsPerVideo: z.number().int().min(1).max(8).optional(),
}).strict();
export type ProfileAutomationInput = z.infer<typeof ProfileAutomationInputSchema>;

export const DEFAULT_PROFILE_AUTOMATION: ProfileAutomation = ProfileAutomationSchema.parse({});

export const TopicSourceSchema = z.enum(["USER", "LLM", "trend"]);
export type TopicSource = z.infer<typeof TopicSourceSchema>;

export const TopicStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "IN_PRODUCTION",
  "DONE",
  "REJECTED",
  "FAILED",
]);
export type TopicStatus = z.infer<typeof TopicStatusSchema>;

export const ProfileTopicSchema = z.object({
  id: z.string().uuid(),
  profileId: z.string().uuid(),
  topic: z.string().min(1).max(500),
  notes: z.string().max(2000).nullable(),
  source: TopicSourceSchema,
  status: TopicStatusSchema,
  priority: z.number().int(),
  projectId: z.string().uuid().nullable(),
  /** Publish slot ISO this topic was assigned to (UTC). */
  scheduledFor: z.string().datetime({ offset: true }).nullable(),
  error: z.string().max(4000).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type ProfileTopic = z.infer<typeof ProfileTopicSchema>;

export const ProfileTopicInputSchema = z.object({
  topic: z.string().trim().min(1).max(500),
  notes: z.string().trim().max(2000).nullable().optional(),
  priority: z.number().int().optional(),
  status: z.enum(["PENDING", "APPROVED"]).optional(),
}).strict();
export type ProfileTopicInput = z.infer<typeof ProfileTopicInputSchema>;

export const ProfileTopicUpdateSchema = z.object({
  topic: z.string().trim().min(1).max(500).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  status: TopicStatusSchema.optional(),
  priority: z.number().int().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "At least one field must be provided",
});
export type ProfileTopicUpdate = z.infer<typeof ProfileTopicUpdateSchema>;

export const TopicListQuerySchema = z.object({
  status: TopicStatusSchema.optional(),
}).strict();
export type TopicListQuery = z.infer<typeof TopicListQuerySchema>;

export const TopicListResponseSchema = z.object({
  items: z.array(ProfileTopicSchema),
});
export type TopicListResponse = z.infer<typeof TopicListResponseSchema>;

export const SuggestTopicsBodySchema = z.object({
  hint: z.string().trim().max(1000).optional(),
  count: z.number().int().min(1).max(20).default(5),
}).strict();
export type SuggestTopicsBody = z.infer<typeof SuggestTopicsBodySchema>;

export const TopicSuggestItemSchema = z.object({
  topic: z.string().min(1).max(500),
  angle: z.string().min(1).max(500),
}).strict();
export type TopicSuggestItem = z.infer<typeof TopicSuggestItemSchema>;

/** Raw LLM output for topicSuggest. */
export const TopicSuggestOutputSchema = z.object({
  topics: z.array(TopicSuggestItemSchema).min(1).max(20),
}).strict();
export type TopicSuggestOutput = z.infer<typeof TopicSuggestOutputSchema>;

export const SuggestTopicsResponseSchema = z.object({
  items: z.array(ProfileTopicSchema),
  rejectedDuplicates: z.number().int().nonnegative(),
});
export type SuggestTopicsResponse = z.infer<typeof SuggestTopicsResponseSchema>;

export const ApproveTopicsBodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  status: z.enum(["APPROVED", "REJECTED"]),
}).strict();
export type ApproveTopicsBody = z.infer<typeof ApproveTopicsBodySchema>;

export const ReorderTopicsBodySchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1),
}).strict();
export type ReorderTopicsBody = z.infer<typeof ReorderTopicsBodySchema>;

export const AutomationLogLevelSchema = z.enum(["info", "warn", "error"]);
export type AutomationLogLevel = z.infer<typeof AutomationLogLevelSchema>;

export const AutomationLogEntrySchema = z.object({
  id: z.string().uuid(),
  profileId: z.string().uuid().nullable(),
  at: z.string().datetime({ offset: true }),
  level: AutomationLogLevelSchema,
  message: z.string(),
  data: z.record(z.string(), z.unknown()).nullable(),
});
export type AutomationLogEntry = z.infer<typeof AutomationLogEntrySchema>;

export const AutomationPausedSchema = z.object({
  paused: z.boolean(),
});
export type AutomationPaused = z.infer<typeof AutomationPausedSchema>;

export const AutomationSlotSchema = z.object({
  publishAt: z.string().datetime({ offset: true }),
  localDate: z.string(),
  topic: ProfileTopicSchema.nullable(),
  productionStatus: TopicStatusSchema.nullable(),
  publicationStatus: z.string().nullable(),
});
export type AutomationSlot = z.infer<typeof AutomationSlotSchema>;

export const AutomationStatusSchema = z.object({
  paused: z.boolean(),
  profiles: z.array(z.object({
    profileId: z.string().uuid(),
    profileName: z.string(),
    enabled: z.boolean(),
    todayCount: z.number().int().nonnegative(),
    approvedCount: z.number().int().nonnegative(),
    nextSlot: z.string().datetime({ offset: true }).nullable(),
    nextTopic: z.string().nullable(),
    inProduction: ProfileTopicSchema.nullable(),
  })),
  recentErrors: z.array(AutomationLogEntrySchema).max(20),
});
export type AutomationStatus = z.infer<typeof AutomationStatusSchema>;

export const ProfileAutomationViewSchema = z.object({
  automation: ProfileAutomationSchema,
  slots: z.array(AutomationSlotSchema),
  todayCount: z.number().int().nonnegative(),
  approvedCount: z.number().int().nonnegative(),
  logs: z.array(AutomationLogEntrySchema),
});
export type ProfileAutomationView = z.infer<typeof ProfileAutomationViewSchema>;
