CREATE TABLE `cost_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text,
	`project_id` text,
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`source` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `cost_entries_date_idx` ON `cost_entries` (`date`);--> statement-breakpoint
CREATE INDEX `cost_entries_profile_idx` ON `cost_entries` (`profile_id`);--> statement-breakpoint
CREATE INDEX `cost_entries_project_idx` ON `cost_entries` (`project_id`);--> statement-breakpoint
CREATE TABLE `currency_rates` (
	`currency` text PRIMARY KEY NOT NULL,
	`rate_to_app_currency` real NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `monthly_reports` (
	`month` text PRIMARY KEY NOT NULL,
	`json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payout_thresholds` (
	`account_id` text PRIMARY KEY NOT NULL,
	`threshold_amount` real NOT NULL,
	`currency` text NOT NULL,
	`current_balance` real,
	`last_notified_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `platform_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `revenue_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`publication_id` text,
	`profile_id` text,
	`source` text NOT NULL,
	`kind` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`note` text,
	`external_key` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `platform_accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`publication_id`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `revenue_entries_source_external_uidx` ON `revenue_entries` (`source`,`external_key`);--> statement-breakpoint
CREATE INDEX `revenue_entries_period_idx` ON `revenue_entries` (`period_start`,`period_end`);--> statement-breakpoint
CREATE INDEX `revenue_entries_account_idx` ON `revenue_entries` (`account_id`);--> statement-breakpoint
CREATE INDEX `revenue_entries_profile_idx` ON `revenue_entries` (`profile_id`);--> statement-breakpoint
CREATE INDEX `revenue_entries_publication_idx` ON `revenue_entries` (`publication_id`);--> statement-breakpoint
ALTER TABLE `platform_accounts` ADD `revenue_sync_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `platform_accounts` ADD `revenue_status` text;--> statement-breakpoint
ALTER TABLE `platform_accounts` ADD `revenue_last_error` text;--> statement-breakpoint
ALTER TABLE `platform_accounts` ADD `revenue_synced_at` text;