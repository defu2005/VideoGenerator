CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`publication_id` text NOT NULL,
	`platform` text NOT NULL,
	`external_id` text NOT NULL,
	`parent_external_id` text,
	`author_name` text DEFAULT '' NOT NULL,
	`author_external_id` text,
	`text` text DEFAULT '' NOT NULL,
	`like_count` integer DEFAULT 0 NOT NULL,
	`published_at` text NOT NULL,
	`fetched_at` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`classification` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`suggested_reply` text,
	`reply_external_id` text,
	`replied_at` text,
	`replied_by` text,
	`toxic` integer DEFAULT false NOT NULL,
	`confidence` text,
	`attention_notified_at` text,
	FOREIGN KEY (`publication_id`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `comments_platform_external_uq` ON `comments` (`platform`,`external_id`);--> statement-breakpoint
CREATE INDEX `comments_publication_idx` ON `comments` (`publication_id`);--> statement-breakpoint
CREATE INDEX `comments_status_priority_idx` ON `comments` (`status`,`priority`);--> statement-breakpoint
ALTER TABLE `platform_accounts` ADD `comments_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `platform_accounts` ADD `comments_status` text;--> statement-breakpoint
ALTER TABLE `platform_accounts` ADD `comments_last_error` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `comment_settings` text;--> statement-breakpoint
ALTER TABLE `publications` ADD `comments_synced_at` text;