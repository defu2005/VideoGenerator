CREATE TABLE `llm_relay_grants` (
	`caller` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`models` text DEFAULT '[]' NOT NULL,
	`rpm` integer DEFAULT 30 NOT NULL,
	`tpm` integer DEFAULT 200000 NOT NULL,
	`daily_usd_cap` real DEFAULT 2 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `llm_relay_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`caller` text NOT NULL,
	`workspace_id` text,
	`model` text NOT NULL,
	`job_id` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real,
	`estimated` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`code` text,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `llm_relay_usage_caller_created_idx` ON `llm_relay_usage` (`caller`,`created_at`);--> statement-breakpoint
CREATE INDEX `llm_relay_usage_job_idx` ON `llm_relay_usage` (`job_id`);