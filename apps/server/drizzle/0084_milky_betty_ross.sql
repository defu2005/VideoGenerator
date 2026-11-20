PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_llm_relay_grants` (
	`caller` text NOT NULL,
	`workspace_id` text,
	`models` text DEFAULT '[]' NOT NULL,
	`rpm` integer DEFAULT 30 NOT NULL,
	`tpm` integer DEFAULT 200000 NOT NULL,
	`daily_usd_cap` real DEFAULT 2 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_llm_relay_grants`("caller", "workspace_id", "models", "rpm", "tpm", "daily_usd_cap", "enabled", "updated_at") SELECT "caller", "workspace_id", "models", "rpm", "tpm", "daily_usd_cap", "enabled", "updated_at" FROM `llm_relay_grants`;--> statement-breakpoint
DROP TABLE `llm_relay_grants`;--> statement-breakpoint
ALTER TABLE `__new_llm_relay_grants` RENAME TO `llm_relay_grants`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `llm_relay_grants_workspace_caller_uq` ON `llm_relay_grants` (`workspace_id`,`caller`);--> statement-breakpoint
CREATE UNIQUE INDEX `llm_relay_grants_legacy_caller_uq` ON `llm_relay_grants` (`caller`) WHERE "llm_relay_grants"."workspace_id" is null;