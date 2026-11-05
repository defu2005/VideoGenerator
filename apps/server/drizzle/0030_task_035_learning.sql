CREATE TABLE `profile_insights` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`created_at` text NOT NULL,
	`period` text NOT NULL,
	`json` text NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `profile_insights_profile_created_idx` ON `profile_insights` (`profile_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `title_experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`publication_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`account_id` text NOT NULL,
	`external_id` text NOT NULL,
	`title_a` text NOT NULL,
	`title_b` text NOT NULL,
	`status` text NOT NULL,
	`winner` text,
	`views_per_hour` real,
	`median_views_per_hour` real,
	`checked_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`publication_id`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `title_experiments_publication_uq` ON `title_experiments` (`publication_id`);--> statement-breakpoint
CREATE INDEX `title_experiments_profile_idx` ON `title_experiments` (`profile_id`);--> statement-breakpoint
ALTER TABLE `profiles` ADD `learning_mode` text DEFAULT 'suggest' NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `learned_notes` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `learned_hints` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `title_ab_test` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `learning_undo` text;