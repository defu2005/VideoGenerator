CREATE TABLE `file_gc_marks` (
	`path` text PRIMARY KEY NOT NULL,
	`project_owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`size` integer NOT NULL,
	`stamp` text NOT NULL,
	`orphaned_at` text NOT NULL,
	`purge_after` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `file_gc_marks_purge_idx` ON `file_gc_marks` (`purge_after`);--> statement-breakpoint
CREATE TABLE `file_gc_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`dry_run` integer NOT NULL,
	`marked` integer NOT NULL,
	`cleared` integer NOT NULL,
	`purged` integer NOT NULL,
	`bytes` integer NOT NULL,
	`error` text
);
--> statement-breakpoint
ALTER TABLE `blobs` ADD `orphaned_at` text;--> statement-breakpoint
ALTER TABLE `blobs` ADD `purge_after` text;