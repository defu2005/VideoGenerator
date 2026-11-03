CREATE TABLE `subtitle_tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`cues` text DEFAULT '[]' NOT NULL,
	`srt_path` text NOT NULL,
	`ass_path` text NOT NULL,
	`input_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subtitle_tracks_project_uq` ON `subtitle_tracks` (`project_id`);