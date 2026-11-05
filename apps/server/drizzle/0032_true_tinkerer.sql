CREATE TABLE `llm_cooldowns` (
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`until` text NOT NULL,
	`reason` text NOT NULL,
	`set_at` text NOT NULL,
	PRIMARY KEY(`provider`, `model`)
);
--> statement-breakpoint
CREATE TABLE `llm_quota_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`window_start` text NOT NULL,
	`window` text NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `llm_quota_usage_bucket_uq` ON `llm_quota_usage` (`provider`,`model`,`window`,`window_start`);--> statement-breakpoint
CREATE INDEX `llm_quota_usage_window_start_idx` ON `llm_quota_usage` (`window_start`);