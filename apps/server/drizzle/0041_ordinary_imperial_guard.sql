PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
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
INSERT INTO `__new_jobs`("id", "project_id", "stage", "scope", "status", "progress", "message", "attempt", "max_attempts", "error", "usage", "created_at", "started_at", "finished_at", "run_after", "previous_state") SELECT "id", "project_id", "stage", "scope", "status", "progress", "message", "attempt", "max_attempts", "error", "usage", "created_at", "started_at", "finished_at", "run_after", "previous_state" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `jobs_status_run_after_idx` ON `jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE INDEX `jobs_project_created_idx` ON `jobs` (`project_id`,`created_at`);