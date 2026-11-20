CREATE TABLE `operator_skill_shadow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_name` text NOT NULL,
	`shadow_version` integer NOT NULL,
	`active_version` integer,
	`run_id` text,
	`query` text NOT NULL,
	`rank` integer,
	`planned` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `operator_skill_shadow_runs_skill_idx` ON `operator_skill_shadow_runs` (`skill_name`,`shadow_version`);--> statement-breakpoint
CREATE INDEX `operator_skill_shadow_runs_run_idx` ON `operator_skill_shadow_runs` (`run_id`);