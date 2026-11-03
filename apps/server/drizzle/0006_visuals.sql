CREATE TABLE `image_search_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`query` text NOT NULL,
	`response` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `visual_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`origin` text NOT NULL,
	`provider` text NOT NULL,
	`provider_item_id` text NOT NULL,
	`source_provider` text,
	`query` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`preview_url` text NOT NULL,
	`image_url` text NOT NULL,
	`source_url` text NOT NULL,
	`source_site` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`aspect_ratio` real NOT NULL,
	`file_type` text NOT NULL,
	`watermark` text NOT NULL,
	`relevance_score` real NOT NULL,
	`score_breakdown` text NOT NULL,
	`license` text NOT NULL,
	`rank` integer NOT NULL,
	`discarded_at` text,
	`created_at` text NOT NULL,
	`search_hash` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `visual_candidates_scene_rank_idx` ON `visual_candidates` (`scene_id`,`rank`);--> statement-breakpoint
CREATE INDEX `visual_candidates_project_scene_idx` ON `visual_candidates` (`project_id`,`scene_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `visual_candidates_provider_item_uq` ON `visual_candidates` (`scene_id`,`provider`,`provider_item_id`);--> statement-breakpoint
CREATE TABLE `visual_search_state` (
	`scene_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`search_hash` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `visual_search_state_project_idx` ON `visual_search_state` (`project_id`);--> statement-breakpoint
CREATE TABLE `visual_selections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`slot` integer DEFAULT 0 NOT NULL,
	`candidate_id` text NOT NULL,
	`status` text NOT NULL,
	`selected_by` text NOT NULL,
	`motion` text,
	`reviewed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `visual_candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `visual_selections_scene_slot_uq` ON `visual_selections` (`scene_id`,`slot`);--> statement-breakpoint
CREATE INDEX `visual_selections_project_scene_idx` ON `visual_selections` (`project_id`,`scene_id`);