CREATE TABLE `node_uploads` (
	`job_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`name` text NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	`path` text NOT NULL,
	`received_bytes` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`job_id`, `lease_id`, `name`),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `jobs` ADD `input_version` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `invalidated_at` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `input_retry` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `finalizing_at` text;--> statement-breakpoint
ALTER TABLE `project_stages` ADD `input_version` text;