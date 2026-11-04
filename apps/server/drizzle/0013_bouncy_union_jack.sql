CREATE TABLE `renders` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`input_hash` text NOT NULL,
	`status` text NOT NULL,
	`output_path` text NOT NULL,
	`credits_path` text,
	`srt_path` text,
	`duration_sec` real NOT NULL,
	`size_bytes` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`report` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `renders_project_created_idx` ON `renders` (`project_id`,`created_at`);