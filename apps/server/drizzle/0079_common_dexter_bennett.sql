ALTER TABLE `jobs` ADD `executor` text DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `handoff_reason` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `handoff_at` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `agent_instance` text;