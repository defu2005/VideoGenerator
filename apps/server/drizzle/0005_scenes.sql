CREATE TABLE `scenes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`order` integer NOT NULL,
	`kind` text NOT NULL,
	`section_id` text,
	`label` text NOT NULL,
	`narration` text NOT NULL,
	`visual_notes` text NOT NULL,
	`visual_queries` text NOT NULL,
	`music_mood` text NOT NULL,
	`energy` text NOT NULL,
	`est_duration_sec` real NOT NULL,
	`duration_override_sec` real,
	`start_sec` real NOT NULL,
	`transition_note` text NOT NULL,
	`origin` text NOT NULL,
	`edited` integer DEFAULT false NOT NULL,
	`input_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scenes_project_order_uq` ON `scenes` (`project_id`,`order`);--> statement-breakpoint
CREATE INDEX `scenes_project_idx` ON `scenes` (`project_id`);