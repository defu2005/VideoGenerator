CREATE TABLE `platform_app_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`profile_id` text,
	`platform` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`auth_tag` text NOT NULL,
	`id_hint` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `platform_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_app_credentials_account_uq` ON `platform_app_credentials` (`account_id`);--> statement-breakpoint
CREATE INDEX `platform_app_credentials_profile_platform_idx` ON `platform_app_credentials` (`profile_id`,`platform`);--> statement-breakpoint
CREATE TABLE `platform_credentials` (
	`account_id` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`auth_tag` text NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`expires_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `platform_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `publications` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`render_id` text NOT NULL,
	`account_id` text NOT NULL,
	`status` text NOT NULL,
	`visibility_requested` text NOT NULL,
	`visibility_used` text NOT NULL,
	`guardrail_reason` text,
	`scheduled_for` text,
	`external_id` text,
	`external_url` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`progress` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`published_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`render_id`) REFERENCES `renders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `platform_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `publications_project_idx` ON `publications` (`project_id`);--> statement-breakpoint
CREATE INDEX `publications_account_idx` ON `publications` (`account_id`);--> statement-breakpoint
CREATE INDEX `publications_status_scheduled_idx` ON `publications` (`status`,`scheduled_for`);--> statement-breakpoint
CREATE INDEX `publications_render_account_idx` ON `publications` (`render_id`,`account_id`);--> statement-breakpoint
ALTER TABLE `platform_accounts` ADD `external_id` text;--> statement-breakpoint
ALTER TABLE `platform_accounts` ADD `last_checked_at` text;