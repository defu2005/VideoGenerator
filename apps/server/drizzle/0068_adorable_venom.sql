CREATE TABLE `artifacts` (
	`sha256` text PRIMARY KEY NOT NULL,
	`size` integer NOT NULL,
	`path` text NOT NULL,
	`mtime_ms` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `artifacts_path_idx` ON `artifacts` (`path`);--> statement-breakpoint
CREATE TABLE `node_join_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`used_by_node_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `node_join_tokens_hash_uq` ON `node_join_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text,
	`status` text DEFAULT 'offline' NOT NULL,
	`version` text,
	`capabilities` text,
	`resources` text,
	`desired_config` text,
	`last_seen_at` text,
	`created_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nodes_token_hash_uq` ON `nodes` (`token_hash`);--> statement-breakpoint
CREATE INDEX `nodes_status_idx` ON `nodes` (`status`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `node_id` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `lease_id` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `lease_until` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `heartbeat_at` text;--> statement-breakpoint
CREATE INDEX `jobs_node_lease_idx` ON `jobs` (`node_id`,`lease_until`);