CREATE TABLE `operator_events` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`profile_id` text,
	`project_id` text,
	`job_id` text,
	`pending_id` text,
	`run_id` text,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `operator_events_time_idx` ON `operator_events` (`occurred_at`);