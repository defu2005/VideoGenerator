CREATE TABLE `app_secrets` (
	`key` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`auth_tag` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notification_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`kind` text NOT NULL,
	`subject_key` text NOT NULL,
	`channel` text NOT NULL,
	`status` text NOT NULL,
	`message` text NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `notification_log_at_idx` ON `notification_log` (`at`);--> statement-breakpoint
CREATE INDEX `notification_log_subject_idx` ON `notification_log` (`subject_key`);