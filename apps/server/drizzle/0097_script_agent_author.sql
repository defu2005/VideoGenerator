ALTER TABLE `jobs` ADD `agent_hold_count` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `agent_hold_lease_id` text;--> statement-breakpoint
ALTER TABLE `script_drafts` ADD `author` text;