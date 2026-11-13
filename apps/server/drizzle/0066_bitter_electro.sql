CREATE TABLE `quality_repairs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`profile_id` text,
	`gate` text NOT NULL,
	`issue_kind` text NOT NULL,
	`scene_id` text,
	`action` text NOT NULL,
	`chosen_by` text NOT NULL,
	`attempt` integer NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`render_used` integer DEFAULT 0 NOT NULL,
	`outcome` text DEFAULT 'pending' NOT NULL,
	`gate_before` text,
	`gate_after` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `quality_repairs_project_idx` ON `quality_repairs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `quality_repairs_profile_idx` ON `quality_repairs` (`profile_id`,`issue_kind`);