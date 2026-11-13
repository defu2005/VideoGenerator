CREATE TABLE `operator_checkpoints` (
	`workflow_id` text NOT NULL,
	`action_key` text NOT NULL,
	`tool` text NOT NULL,
	`receipt` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workflow_id`, `action_key`),
	FOREIGN KEY (`workflow_id`) REFERENCES `operator_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `operator_runs` ADD `runtime_id` text;--> statement-breakpoint
ALTER TABLE `operator_runs` ADD `workflow_id` text;--> statement-breakpoint
CREATE INDEX `operator_runs_workflow_idx` ON `operator_runs` (`workflow_id`);