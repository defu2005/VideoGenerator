CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`stage` text NOT NULL,
	`scope` text,
	`status` text NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`message` text,
	`attempt` integer DEFAULT 1 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`error` text,
	`usage` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`run_after` text NOT NULL,
	`previous_state` text DEFAULT 'PENDING' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `jobs_status_run_after_idx` ON `jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE INDEX `jobs_project_created_idx` ON `jobs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `project_stages` (
	`project_id` text NOT NULL,
	`stage` text NOT NULL,
	`state` text NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`message` text,
	`job_id` text,
	`updated_at` text NOT NULL,
	`error` text,
	PRIMARY KEY(`project_id`, `stage`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_stages_state_idx` ON `project_stages` (`project_id`,`state`);--> statement-breakpoint
ALTER TABLE `projects` ADD `run_mode` text;