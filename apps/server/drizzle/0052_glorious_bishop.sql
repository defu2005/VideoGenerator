CREATE TABLE `supervisor_heartbeats` (
	`id` integer PRIMARY KEY NOT NULL,
	`observed_at` text NOT NULL,
	`running_jobs` integer NOT NULL,
	`queued_jobs` integer NOT NULL,
	`finding_count` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `supervisor_heartbeat_time_idx` ON `supervisor_heartbeats` (`observed_at`);