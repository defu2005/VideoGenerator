CREATE TABLE `operator_action_attempts` (
	`id` integer PRIMARY KEY NOT NULL,
	`action_key` text NOT NULL,
	`run_id` text NOT NULL,
	`attempted_at` text NOT NULL,
	`failed_at` text
);
--> statement-breakpoint
CREATE INDEX `operator_attempt_action_idx` ON `operator_action_attempts` (`action_key`,`run_id`,`attempted_at`);--> statement-breakpoint
CREATE INDEX `operator_attempt_time_idx` ON `operator_action_attempts` (`attempted_at`);--> statement-breakpoint
CREATE TABLE `supervisor_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text,
	`kind` text NOT NULL,
	`severity` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`detail` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`status` text NOT NULL,
	`resolution` text,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supervisor_findings_dedupe_key_unique` ON `supervisor_findings` (`dedupe_key`);