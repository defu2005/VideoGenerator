CREATE TABLE `agent_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`instance` text NOT NULL,
	`role` text NOT NULL,
	`profile_id` text,
	`project_id` text,
	`stage` text,
	`max_concurrent` integer DEFAULT 1 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_assignments_workspace_active_idx` ON `agent_assignments` (`workspace_id`,`active`,`instance`);--> statement-breakpoint
CREATE TABLE `image_verdicts` (
	`workspace_id` text NOT NULL,
	`phash` text NOT NULL,
	`subject_key` text NOT NULL,
	`verdict` text NOT NULL,
	`reason` text NOT NULL,
	`checked_by` text NOT NULL,
	`model` text NOT NULL,
	`vision_check` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `phash`, `subject_key`)
);
--> statement-breakpoint
CREATE TABLE `search_query_cache` (
	`workspace_id` text NOT NULL,
	`source` text NOT NULL,
	`normalized_query` text NOT NULL,
	`results` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `source`, `normalized_query`)
);
