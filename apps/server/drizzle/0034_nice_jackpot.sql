CREATE TABLE `llm_provider_quota_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`omniroute_provider` text NOT NULL,
	`label` text NOT NULL,
	`masked_account` text,
	`quota_key` text NOT NULL,
	`used` real,
	`total` real,
	`remaining` real,
	`remaining_pct` real,
	`reset_at` text,
	`unlimited` integer DEFAULT false NOT NULL,
	`fraction_reported` integer,
	`unit` text DEFAULT 'requests' NOT NULL,
	`expires_at` text,
	`fetched_at` text NOT NULL,
	`error` text,
	`active` integer DEFAULT true NOT NULL,
	`rate_limit_note` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `llm_provider_quota_snapshots_uq` ON `llm_provider_quota_snapshots` (`connection_id`,`quota_key`);--> statement-breakpoint
CREATE INDEX `llm_provider_quota_snapshots_provider_idx` ON `llm_provider_quota_snapshots` (`omniroute_provider`);--> statement-breakpoint
ALTER TABLE `llm_quota_usage` ADD `credits_usd` real DEFAULT 0 NOT NULL;