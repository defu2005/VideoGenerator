CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`workspace_id` text,
	`actor_kind` text,
	`actor_user_id` text,
	`actor_key_id` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`outcome` text NOT NULL,
	`status_code` integer,
	`source` text NOT NULL,
	`summary` text,
	`payload` text,
	`request_id` text
);
--> statement-breakpoint
CREATE INDEX `audit_log_workspace_at_idx` ON `audit_log` (`workspace_id`,`at`);--> statement-breakpoint
CREATE INDEX `audit_log_actor_at_idx` ON `audit_log` (`actor_user_id`,`at`);--> statement-breakpoint
CREATE TABLE `channel_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_grants_member_channel_uq` ON `channel_grants` (`workspace_id`,`user_id`,`profile_id`);--> statement-breakpoint
CREATE INDEX `channel_grants_user_idx` ON `channel_grants` (`user_id`);--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`inviter_id` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invitation_organizationId_idx` ON `invitation` (`organization_id`);--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `member_organizationId_idx` ON `member` (`organization_id`);--> statement-breakpoint
CREATE INDEX `member_userId_idx` ON `member` (`user_id`);--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`created_at` integer NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_uidx` ON `organization` (`slug`);--> statement-breakpoint
ALTER TABLE `agents` ADD `workspace_id` text;--> statement-breakpoint
CREATE INDEX `agents_workspace_idx` ON `agents` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `assistant_conversations` ADD `workspace_id` text;--> statement-breakpoint
CREATE INDEX `assistant_conversations_workspace_idx` ON `assistant_conversations` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `assistant_pending_actions` ADD `workspace_id` text;--> statement-breakpoint
ALTER TABLE `assistant_pending_actions` ADD `actor_user_id` text;--> statement-breakpoint
CREATE INDEX `assistant_pending_actions_workspace_idx` ON `assistant_pending_actions` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `cost_entries` ADD `workspace_id` text;--> statement-breakpoint
CREATE INDEX `cost_entries_workspace_idx` ON `cost_entries` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `knowledge_entries` ADD `workspace_id` text;--> statement-breakpoint
CREATE INDEX `knowledge_entries_workspace_idx` ON `knowledge_entries` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `monthly_reports` ADD `workspace_id` text;--> statement-breakpoint
CREATE INDEX `monthly_reports_workspace_idx` ON `monthly_reports` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `operator_conversations` ADD `workspace_id` text;--> statement-breakpoint
CREATE INDEX `operator_conversations_workspace_idx` ON `operator_conversations` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `operator_goals` ADD `workspace_id` text;--> statement-breakpoint
CREATE INDEX `operator_goals_workspace_idx` ON `operator_goals` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `operator_preferences` ADD `workspace_id` text;--> statement-breakpoint
CREATE INDEX `operator_preferences_workspace_idx` ON `operator_preferences` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `payout_thresholds` ADD `workspace_id` text;--> statement-breakpoint
CREATE INDEX `payout_thresholds_workspace_idx` ON `payout_thresholds` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `profiles` ADD `workspace_id` text;--> statement-breakpoint
CREATE INDEX `profiles_workspace_idx` ON `profiles` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `workspace_id` text;--> statement-breakpoint
CREATE INDEX `projects_workspace_idx` ON `projects` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `revenue_entries` ADD `workspace_id` text;--> statement-breakpoint
CREATE INDEX `revenue_entries_workspace_idx` ON `revenue_entries` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `session` ADD `active_organization_id` text;--> statement-breakpoint
ALTER TABLE `standing_orders` ADD `workspace_id` text;--> statement-breakpoint
CREATE INDEX `standing_orders_workspace_idx` ON `standing_orders` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `style_packs` ADD `workspace_id` text;--> statement-breakpoint
CREATE INDEX `style_packs_workspace_idx` ON `style_packs` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `video_looks` ADD `workspace_id` text;--> statement-breakpoint
CREATE INDEX `video_looks_workspace_idx` ON `video_looks` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `webhook_endpoints` ADD `workspace_id` text;--> statement-breakpoint
CREATE INDEX `webhook_endpoints_workspace_idx` ON `webhook_endpoints` (`workspace_id`);