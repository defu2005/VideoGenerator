CREATE TABLE `clip_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`source` text NOT NULL,
	`external_path` text,
	`title` text DEFAULT '' NOT NULL,
	`ownership_confirmed` integer DEFAULT false NOT NULL,
	`options` text NOT NULL,
	`proposals` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `clip_sets_project_idx` ON `clip_sets` (`project_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `kind` text DEFAULT 'long' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `parent_project_id` text REFERENCES projects(id);--> statement-breakpoint
CREATE INDEX `projects_parent_project_id_idx` ON `projects` (`parent_project_id`);