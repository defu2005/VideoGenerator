CREATE TABLE `stage_overdue_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text,
	`stage` text NOT NULL,
	`check_no` integer NOT NULL,
	`at` text NOT NULL,
	`facts` text,
	`action` text NOT NULL,
	`extend_ms` integer,
	`source` text NOT NULL,
	`actor` text,
	`reason` text NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stage_overdue_checks_job_idx` ON `stage_overdue_checks` (`job_id`,`attempt`);--> statement-breakpoint
CREATE INDEX `stage_overdue_checks_workspace_idx` ON `stage_overdue_checks` (`workspace_id`,`at`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `overdue_at` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `next_check_at` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `overdue_state` text;--> statement-breakpoint
CREATE INDEX `jobs_stage_status_finished_idx` ON `jobs` (`stage`,`status`,`finished_at`);