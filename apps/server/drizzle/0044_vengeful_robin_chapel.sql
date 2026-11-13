CREATE TABLE `operator_tool_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`details` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `operator_tool_proposals_status_idx` ON `operator_tool_proposals` (`status`,`created_at`);