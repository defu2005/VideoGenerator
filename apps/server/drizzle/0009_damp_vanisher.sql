CREATE TABLE `voice_tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`provider` text NOT NULL,
	`voice` text NOT NULL,
	`rate` text NOT NULL,
	`origin` text NOT NULL,
	`audio_path` text NOT NULL,
	`duration_sec` real NOT NULL,
	`cues` text DEFAULT '[]' NOT NULL,
	`input_hash` text NOT NULL,
	`narration_hash` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `voice_tracks_scene_uq` ON `voice_tracks` (`scene_id`);--> statement-breakpoint
CREATE INDEX `voice_tracks_project_idx` ON `voice_tracks` (`project_id`);