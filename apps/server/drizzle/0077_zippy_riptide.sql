CREATE TABLE `agent_lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`scope` text NOT NULL,
	`text` text NOT NULL,
	`normalized_text` text NOT NULL,
	`evidence` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_instance` text NOT NULL,
	`created_at` text NOT NULL,
	`confirmed_count` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`supersedes` text,
	`retired_reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_lessons_workspace_scope_text_uidx` ON `agent_lessons` (`workspace_id`,`scope`,`normalized_text`);--> statement-breakpoint
ALTER TABLE `agent_instances` ADD `host` text;--> statement-breakpoint
ALTER TABLE `agent_instances` ADD `hermes_version` text;--> statement-breakpoint
ALTER TABLE `agent_instances` ADD `bundle_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_instances` ADD `skills_hash` text;--> statement-breakpoint
ALTER TABLE `agent_instances` ADD `tool_hash` text;--> statement-breakpoint
ALTER TABLE `agent_instances` ADD `last_sync_at` text;--> statement-breakpoint
ALTER TABLE `agent_instances` ADD `last_error` text;--> statement-breakpoint
ALTER TABLE `agent_instances` ADD `pending_cron` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_instances` ADD `bundle_behind_since` text;