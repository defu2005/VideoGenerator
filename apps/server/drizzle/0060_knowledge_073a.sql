CREATE TABLE `knowledge_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`json` text,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `knowledge_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`kind` text NOT NULL,
	`proposed` text NOT NULL,
	`patch` text NOT NULL,
	`origin` text NOT NULL,
	`evidence` text NOT NULL,
	`risk` text NOT NULL,
	`status` text NOT NULL,
	`change_event_id` text,
	`created_at` text NOT NULL,
	`decided_at` text,
	`decided_by` text,
	`base_revision` integer NOT NULL,
	`reason` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `knowledge_proposals_entry_status` ON `knowledge_proposals` (`entry_id`,`status`);--> statement-breakpoint
CREATE TABLE `knowledge_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`revision` integer NOT NULL,
	`before` text,
	`after` text,
	`patch` text NOT NULL,
	`origin` text NOT NULL,
	`actor` text NOT NULL,
	`reason` text NOT NULL,
	`change_event_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_revisions_entry_revision` ON `knowledge_revisions` (`entry_id`,`revision`);