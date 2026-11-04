CREATE TABLE `guideline_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`stage` text NOT NULL,
	`source` text NOT NULL,
	`rule_id` text NOT NULL,
	`severity` text NOT NULL,
	`scene_id` text,
	`text` text NOT NULL,
	`quote` text,
	`suggestion` text,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`dismissed_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `guideline_findings_project_idx` ON `guideline_findings` (`project_id`);