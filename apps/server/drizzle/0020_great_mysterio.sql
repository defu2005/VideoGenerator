CREATE TABLE `auto_report_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`stage` text NOT NULL,
	`scene_id` text,
	`code` text NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`data` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auto_report_entries_project_idx` ON `auto_report_entries` (`project_id`);--> statement-breakpoint
CREATE INDEX `auto_report_entries_project_stage_idx` ON `auto_report_entries` (`project_id`,`stage`);