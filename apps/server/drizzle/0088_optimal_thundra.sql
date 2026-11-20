CREATE TABLE `stage_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`project_id` text NOT NULL,
	`profile_id` text,
	`stage` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`before` text,
	`after` text,
	`reason` text,
	`source` text NOT NULL,
	`distilled_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `stage_feedback_project_stage_idx` ON `stage_feedback` (`project_id`,`stage`);--> statement-breakpoint
CREATE INDEX `stage_feedback_profile_stage_idx` ON `stage_feedback` (`profile_id`,`stage`,`created_at`);--> statement-breakpoint
CREATE TABLE `stage_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text,
	`stage` text NOT NULL,
	`text` text NOT NULL,
	`evidence_ids` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`decided_at` text,
	`decided_by` text,
	`uses` integer DEFAULT 0 NOT NULL,
	`last_used_at` text
);
--> statement-breakpoint
CREATE INDEX `stage_notes_profile_stage_status_idx` ON `stage_notes` (`profile_id`,`stage`,`status`);