CREATE TABLE `style_packs` (
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`name` text NOT NULL,
	`origin` text NOT NULL,
	`seed` text,
	`tokens` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`id`, `version`)
);
--> statement-breakpoint
CREATE TABLE `video_looks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`render_id` text NOT NULL,
	`profile_id` text,
	`pack_id` text NOT NULL,
	`pack_version` integer,
	`fingerprint` text NOT NULL,
	`look` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`render_id`) REFERENCES `renders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `video_looks_profile_created_idx` ON `video_looks` (`profile_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `profiles` ADD `style_pack_id` text;