CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`topic` text NOT NULL,
	`mode` text NOT NULL,
	`settings` text NOT NULL,
	`status` text NOT NULL,
	`stage` text NOT NULL,
	`thumbnail_path` text,
	`duration_sec` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text
);
--> statement-breakpoint
CREATE INDEX `projects_status_idx` ON `projects` (`status`);--> statement-breakpoint
CREATE INDEX `projects_updated_at_idx` ON `projects` (`updated_at`);--> statement-breakpoint
CREATE INDEX `projects_archived_at_idx` ON `projects` (`archived_at`);