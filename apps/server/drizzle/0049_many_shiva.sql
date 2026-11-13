CREATE TABLE `retrieval_chunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text,
	`project_id` text,
	`kind` text NOT NULL,
	`source_id` text NOT NULL,
	`source_version` text NOT NULL,
	`content_hash` text NOT NULL,
	`title` text NOT NULL,
	`text` text NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`embedding` blob,
	`embedding_model` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `retrieval_profile_kind_idx` ON `retrieval_chunks` (`profile_id`,`kind`);--> statement-breakpoint
CREATE INDEX `retrieval_project_idx` ON `retrieval_chunks` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `retrieval_source_hash_uq` ON `retrieval_chunks` (`kind`,`source_id`,`content_hash`);--> statement-breakpoint
CREATE TABLE `retrieval_exclusions` (
	`project_id` text NOT NULL,
	`chunk_id` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `chunk_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chunk_id`) REFERENCES `retrieval_chunks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `retrieval_uses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`stage` text NOT NULL,
	`task_id` text NOT NULL,
	`chunk_ids` text NOT NULL,
	`scores` text NOT NULL,
	`tokens` integer NOT NULL,
	`mode` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
