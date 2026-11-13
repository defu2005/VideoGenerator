CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`environment` text NOT NULL,
	`model` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`calls` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_identity_uq` ON `agents` (`kind`,`name`,`environment`);--> statement-breakpoint
CREATE TABLE `skill_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`skill` text NOT NULL,
	`profile_id` text,
	`agent_kind` text NOT NULL,
	`agent_name` text NOT NULL,
	`agent_environment` text NOT NULL,
	`claimed_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`released_at` text,
	`report_id` text,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `skill_claims_open_idx` ON `skill_claims` (`skill`,`profile_id`,`released_at`);--> statement-breakpoint
CREATE TABLE `skill_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`skill` text NOT NULL,
	`skill_hash` text NOT NULL,
	`profile_id` text,
	`profile_name` text,
	`subjects` text NOT NULL,
	`agent_kind` text NOT NULL,
	`agent_name` text NOT NULL,
	`agent_model` text,
	`agent_environment` text NOT NULL,
	`app_environment` text NOT NULL,
	`started_at` text NOT NULL,
	`status` text NOT NULL,
	`inputs` text,
	`decision` text,
	`hypothesis` text,
	`notes` text,
	`lesson` text,
	`actions` text NOT NULL,
	`metrics` text NOT NULL,
	`check_at` text,
	`verdict` text,
	`verdict_source` text,
	`checked_at` text,
	`checked_by_kind` text,
	`checked_by_name` text,
	`run_id` text,
	`claim_id` text,
	`source` text NOT NULL,
	`import_key` text NOT NULL,
	`imported_by_kind` text,
	`imported_by_name` text,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_reports_import_key_uq` ON `skill_reports` (`import_key`);--> statement-breakpoint
CREATE INDEX `skill_reports_profile_idx` ON `skill_reports` (`profile_id`,`skill`,`created_at`);--> statement-breakpoint
CREATE INDEX `skill_reports_due_idx` ON `skill_reports` (`check_at`,`verdict`);--> statement-breakpoint
CREATE INDEX `skill_reports_agent_idx` ON `skill_reports` (`agent_kind`,`agent_environment`);--> statement-breakpoint
ALTER TABLE `operator_tool_audit` ADD `agent_kind` text;--> statement-breakpoint
ALTER TABLE `operator_tool_audit` ADD `agent_name` text;--> statement-breakpoint
ALTER TABLE `operator_tool_audit` ADD `agent_model` text;--> statement-breakpoint
ALTER TABLE `operator_tool_audit` ADD `agent_environment` text;