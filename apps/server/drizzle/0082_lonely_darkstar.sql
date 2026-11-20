CREATE TABLE `project_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`node_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`lease_until` text NOT NULL,
	`heartbeat_at` text NOT NULL,
	`status` text NOT NULL,
	`from_stage` text NOT NULL,
	`stop_before` text NOT NULL,
	`base_version` text NOT NULL,
	`last_seq` integer DEFAULT 0 NOT NULL,
	`budget_cap_usd` real NOT NULL,
	`created_at` text NOT NULL,
	`ended_at` text,
	`end_reason` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `project_runs_project_status_idx` ON `project_runs` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `project_runs_node_lease_idx` ON `project_runs` (`node_id`,`lease_until`);--> statement-breakpoint
CREATE TABLE `run_checkpoints` (
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`stage` text NOT NULL,
	`input_version` text NOT NULL,
	`applied_at` text NOT NULL,
	`rows` integer NOT NULL,
	`bytes` integer NOT NULL,
	`result` text NOT NULL,
	`content_hash` text NOT NULL,
	PRIMARY KEY(`run_id`, `seq`),
	FOREIGN KEY (`run_id`) REFERENCES `project_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `run_uploads` (
	`run_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`name` text NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	`path` text NOT NULL,
	`received_bytes` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`run_id`, `lease_id`, `name`),
	FOREIGN KEY (`run_id`) REFERENCES `project_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `node_join_tokens` ADD `workspace_id` text;--> statement-breakpoint
ALTER TABLE `nodes` ADD `workspace_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `execution_mode` text DEFAULT 'control' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `execution_node` text REFERENCES nodes(id);