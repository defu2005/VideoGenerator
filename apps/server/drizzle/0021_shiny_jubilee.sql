CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`direction` text DEFAULT '' NOT NULL,
	`language` text DEFAULT 'vi' NOT NULL,
	`default_brief` text NOT NULL,
	`voice` text,
	`guidelines` text NOT NULL,
	`llm` text,
	`avatar_path` text,
	`color` text DEFAULT '#3B82F6' NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_name_unique` ON `profiles` (`name`);--> statement-breakpoint
CREATE INDEX `profiles_archived_at_idx` ON `profiles` (`archived_at`);--> statement-breakpoint
CREATE INDEX `profiles_updated_at_idx` ON `profiles` (`updated_at`);--> statement-breakpoint
CREATE TABLE `platform_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`platform` text NOT NULL,
	`display_name` text NOT NULL,
	`handle` text,
	`format` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`connection` text DEFAULT 'NOT_CONNECTED' NOT NULL,
	`connection_error` text,
	`publish_settings` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `platform_accounts_profile_idx` ON `platform_accounts` (`profile_id`);--> statement-breakpoint
CREATE INDEX `platform_accounts_platform_idx` ON `platform_accounts` (`platform`);--> statement-breakpoint
ALTER TABLE `projects` ADD `profile_id` text REFERENCES profiles(id);--> statement-breakpoint
CREATE INDEX `projects_profile_id_idx` ON `projects` (`profile_id`);
