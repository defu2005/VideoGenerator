CREATE TABLE `channel_metrics_daily` (
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`followers` integer,
	`views` integer,
	`watch_time_sec` real,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`account_id`, `date`),
	FOREIGN KEY (`account_id`) REFERENCES `platform_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `publication_metrics_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`publication_id` text NOT NULL,
	`fetched_at` text NOT NULL,
	`views` integer,
	`likes` integer,
	`comments` integer,
	`shares` integer,
	`saves` integer,
	`watch_time_sec` real,
	`avg_view_duration_sec` real,
	`avg_view_pct` real,
	`subscribers_gained` integer,
	`reach` integer,
	`raw` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`publication_id`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `publication_metrics_snapshots_pub_fetched_idx` ON `publication_metrics_snapshots` (`publication_id`,`fetched_at`);--> statement-breakpoint
ALTER TABLE `platform_accounts` ADD `analytics_status` text;--> statement-breakpoint
ALTER TABLE `platform_accounts` ADD `analytics_last_error` text;--> statement-breakpoint
ALTER TABLE `platform_accounts` ADD `analytics_synced_at` text;--> statement-breakpoint
ALTER TABLE `publications` ADD `latest_metrics` text;--> statement-breakpoint
ALTER TABLE `publications` ADD `metrics_synced_at` text;