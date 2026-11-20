CREATE TABLE `stage_quality` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`project_id` text NOT NULL,
	`profile_id` text,
	`stage` text NOT NULL,
	`job_id` text,
	`executor` text DEFAULT 'app' NOT NULL,
	`model_route` text,
	`retries` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`metrics` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `stage_quality_stage_created_idx` ON `stage_quality` (`stage`,`profile_id`,`created_at`);