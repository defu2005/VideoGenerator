CREATE TABLE `trend_cache` (
	`source` text NOT NULL,
	`region` text NOT NULL,
	`language` text NOT NULL,
	`cache_key` text DEFAULT '' NOT NULL,
	`fetched_at` text NOT NULL,
	`json` text NOT NULL,
	PRIMARY KEY(`source`, `region`, `language`, `cache_key`)
);
--> statement-breakpoint
CREATE TABLE `trend_ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`title` text NOT NULL,
	`angle` text NOT NULL,
	`why_now` text NOT NULL,
	`source_titles` text NOT NULL,
	`urgency` text NOT NULL,
	`fit_score` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trend_ideas_profile_created_idx` ON `trend_ideas` (`profile_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `profiles` ADD `trend_settings` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `translations` text;