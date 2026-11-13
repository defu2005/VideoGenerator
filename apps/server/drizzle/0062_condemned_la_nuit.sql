CREATE TABLE `change_events` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`detector` text NOT NULL,
	`subject` text NOT NULL,
	`summary` text NOT NULL,
	`evidence` text NOT NULL,
	`severity` text NOT NULL,
	`fingerprint` text NOT NULL,
	`consumers` text NOT NULL,
	`reaction` text NOT NULL,
	`status` text NOT NULL,
	`seen_count` integer DEFAULT 1 NOT NULL,
	`last_seen_at` text NOT NULL,
	`in_digest` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text
);
--> statement-breakpoint
CREATE INDEX `change_events_status_severity` ON `change_events` (`status`,`severity`);--> statement-breakpoint
CREATE TABLE `change_holds` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`consumer` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`reason` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `change_holds_active_subject` ON `change_holds` (`active`,`subject_type`,`subject_id`);--> statement-breakpoint
CREATE TABLE `change_signal_hits` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `change_signal_hits_fingerprint` ON `change_signal_hits` (`fingerprint`,`seen_at`);