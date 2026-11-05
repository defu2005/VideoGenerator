CREATE TABLE `operator_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`title` text NOT NULL,
	`cursor_chat_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `operator_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`run_id` text,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `operator_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `operator_messages_conversation_idx` ON `operator_messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `operator_routing_log` (
	`id` text PRIMARY KEY NOT NULL,
	`query` text NOT NULL,
	`candidates` text NOT NULL,
	`picked` text NOT NULL,
	`run_id` text,
	`outcome` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `operator_routing_log_created_idx` ON `operator_routing_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `operator_routing_log_run_idx` ON `operator_routing_log` (`run_id`);--> statement-breakpoint
CREATE TABLE `operator_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`prompt` text NOT NULL,
	`result` text,
	`partial_text` text DEFAULT '' NOT NULL,
	`tool_chips` text NOT NULL,
	`model` text,
	`error` text,
	`outcome` text,
	`origin` text NOT NULL,
	`day_key` text NOT NULL,
	`pending_action_ids` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `operator_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `operator_runs_conversation_idx` ON `operator_runs` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `operator_runs_day_idx` ON `operator_runs` (`day_key`);--> statement-breakpoint
CREATE TABLE `operator_tool_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`tool` text NOT NULL,
	`args` text NOT NULL,
	`risk` text NOT NULL,
	`decision` text NOT NULL,
	`summary` text NOT NULL,
	`pending_action_id` text,
	`run_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `operator_tool_audit_created_idx` ON `operator_tool_audit` (`created_at`);--> statement-breakpoint
CREATE TABLE `standing_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`prompt` text NOT NULL,
	`cron` text,
	`enabled` integer DEFAULT false NOT NULL,
	`seeded` integer DEFAULT false NOT NULL,
	`module_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_fired_at` text
);
