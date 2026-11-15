DROP INDEX `agents_identity_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `agents_identity_uq` ON `agents` (`workspace_id`,`kind`,`name`,`environment`);--> statement-breakpoint
DROP INDEX `revenue_entries_source_external_uidx`;--> statement-breakpoint
CREATE UNIQUE INDEX `revenue_entries_source_external_uidx` ON `revenue_entries` (`workspace_id`,`source`,`external_key`);--> statement-breakpoint
ALTER TABLE `knowledge_entries` ADD `key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_entries_workspace_kind_key_uidx` ON `knowledge_entries` (`workspace_id`,`kind`,`key`);