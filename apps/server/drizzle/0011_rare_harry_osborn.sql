CREATE TABLE `music_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_item_id` text NOT NULL,
	`title` text NOT NULL,
	`artist` text,
	`source_url` text,
	`audio_url` text,
	`duration_sec` real,
	`genres` text DEFAULT '[]' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`license` text NOT NULL,
	`relevance_score` real DEFAULT 0 NOT NULL,
	`score_breakdown` text DEFAULT '{}' NOT NULL,
	`rank` integer DEFAULT 0 NOT NULL,
	`local_path` text,
	`input_hash` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `music_candidates_project_idx` ON `music_candidates` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `music_candidates_item_uq` ON `music_candidates` (`project_id`,`provider`,`provider_item_id`);--> statement-breakpoint
CREATE TABLE `music_selections` (
	`project_id` text PRIMARY KEY NOT NULL,
	`candidate_id` text,
	`status` text NOT NULL,
	`selected_by` text NOT NULL,
	`volume` real NOT NULL,
	`fade_in_sec` real DEFAULT 2 NOT NULL,
	`fade_out_sec` real DEFAULT 3 NOT NULL,
	`ducking_db` real DEFAULT -12 NOT NULL,
	`start_offset_sec` real DEFAULT 0 NOT NULL,
	`query_override` text,
	`search_hash` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `music_candidates`(`id`) ON UPDATE no action ON DELETE set null
);
