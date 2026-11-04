CREATE TABLE `video_metadata` (
	`project_id` text PRIMARY KEY NOT NULL,
	`input_hash` text NOT NULL,
	`draft` text NOT NULL,
	`edited` text,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `music_selections` ADD `assist` text;