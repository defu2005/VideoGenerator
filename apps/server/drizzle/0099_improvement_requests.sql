CREATE TABLE `improvement_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`problem` text NOT NULL,
	`proposal` text NOT NULL,
	`evidence` text NOT NULL,
	`acceptance` text NOT NULL,
	`data_vs_code` text,
	`expected_impact` text,
	`effort` text,
	`risk` text,
	`open_source` text,
	`status` text NOT NULL,
	`weight` integer DEFAULT 1 NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `improvement_requests_status_idx` ON `improvement_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `improvement_requests_fingerprint_idx` ON `improvement_requests` (`fingerprint`,`status`);