CREATE TABLE `script_drafts` (
	`project_id` text PRIMARY KEY NOT NULL,
	`outline` text,
	`hook_candidates` text,
	`critique` text,
	`critique_history` text,
	`engine_mode` text NOT NULL,
	`input_hash` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
