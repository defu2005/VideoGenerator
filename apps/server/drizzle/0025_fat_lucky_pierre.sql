CREATE TABLE `automation_log` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text,
	`at` text NOT NULL,
	`level` text NOT NULL,
	`message` text NOT NULL,
	`data` text,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `automation_log_at_idx` ON `automation_log` (`at`);--> statement-breakpoint
CREATE INDEX `automation_log_profile_idx` ON `automation_log` (`profile_id`);--> statement-breakpoint
CREATE TABLE `profile_topics` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`topic` text NOT NULL,
	`notes` text,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`project_id` text,
	`scheduled_for` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `profile_topics_profile_status_idx` ON `profile_topics` (`profile_id`,`status`);--> statement-breakpoint
CREATE INDEX `profile_topics_profile_priority_idx` ON `profile_topics` (`profile_id`,`priority`);--> statement-breakpoint
CREATE INDEX `profile_topics_scheduled_idx` ON `profile_topics` (`scheduled_for`);--> statement-breakpoint
ALTER TABLE `profiles` ADD `automation` text;