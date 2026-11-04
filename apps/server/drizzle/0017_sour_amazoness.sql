ALTER TABLE `renders` ADD `version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `renders` ADD `note` text;--> statement-breakpoint
ALTER TABLE `renders` ADD `pinned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `renders` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `renders` ADD `review_thread_id` text;--> statement-breakpoint
ALTER TABLE `renders` ADD `metadata_snapshot` text;