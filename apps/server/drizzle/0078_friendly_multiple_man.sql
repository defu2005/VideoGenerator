CREATE TABLE `research_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text,
	`skill` text NOT NULL,
	`version` integer NOT NULL,
	`trigger` text NOT NULL,
	`subject` text NOT NULL,
	`status` text NOT NULL,
	`budget_used` text DEFAULT '{}' NOT NULL,
	`report` text DEFAULT '' NOT NULL,
	`proposal_ids` text DEFAULT '[]' NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	`change_event_id` text,
	`created_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `research_runs_workspace_created_idx` ON `research_runs` (`workspace_id`,`created_at`);