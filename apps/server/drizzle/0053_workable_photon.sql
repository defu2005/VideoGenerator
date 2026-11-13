CREATE TABLE `operator_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text,
	`text` text NOT NULL,
	`spec` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `operator_goals_profile_idx` ON `operator_goals` (`profile_id`,`status`);--> statement-breakpoint
CREATE TABLE `operator_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text,
	`rule` text NOT NULL,
	`quote` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` text NOT NULL,
	`active` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `operator_preferences_profile_idx` ON `operator_preferences` (`profile_id`,`active`);--> statement-breakpoint
CREATE TABLE `operator_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`why_vi` text NOT NULL,
	`action_url` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`check_kind` text NOT NULL,
	`check_args` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `operator_requests_status_idx` ON `operator_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `operator_user_touches` (
	`object_key` text PRIMARY KEY NOT NULL,
	`touched_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `routing_canaries` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`stage` text NOT NULL,
	`before` text NOT NULL,
	`after` text NOT NULL,
	`reason` text NOT NULL,
	`remaining` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `operator_tool_audit` ADD `autonomy_level` text;--> statement-breakpoint
ALTER TABLE `operator_tool_audit` ADD `grant` text;--> statement-breakpoint
ALTER TABLE `operator_tool_audit` ADD `origin` text;--> statement-breakpoint
ALTER TABLE `operator_tool_audit` ADD `reason` text;--> statement-breakpoint
ALTER TABLE `operator_tool_audit` ADD `undo` text;