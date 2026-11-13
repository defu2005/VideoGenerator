CREATE TABLE `visual_search_checkpoints` (
	`scene_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`search_hash` text NOT NULL,
	`queries` text NOT NULL,
	`candidates` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `visual_search_checkpoints_project_idx` ON `visual_search_checkpoints` (`project_id`);