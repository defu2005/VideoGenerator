CREATE TABLE `agent_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`from_instance` text NOT NULL,
	`to_kind` text NOT NULL,
	`to_value` text NOT NULL,
	`kind` text NOT NULL,
	`mission_id` text,
	`project_id` text,
	`body` text NOT NULL,
	`attachments` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`delivered_at` text,
	`acked_at` text,
	`acked_by` text,
	`expires_at` text NOT NULL,
	`escalated_duty_at` text,
	`escalated_user_at` text
);
--> statement-breakpoint
CREATE INDEX `agent_messages_thread_idx` ON `agent_messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_messages_to_idx` ON `agent_messages` (`workspace_id`,`to_kind`,`to_value`,`acked_at`);--> statement-breakpoint
CREATE INDEX `agent_messages_sender_idx` ON `agent_messages` (`workspace_id`,`from_instance`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`instance` text NOT NULL,
	`kinds` text DEFAULT '[]' NOT NULL,
	`scope` text DEFAULT '{}' NOT NULL,
	`delivery` text NOT NULL,
	`webhook_endpoint_id` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`webhook_endpoint_id`) REFERENCES `webhook_endpoints`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_subscriptions_instance_idx` ON `agent_subscriptions` (`workspace_id`,`instance`,`enabled`);