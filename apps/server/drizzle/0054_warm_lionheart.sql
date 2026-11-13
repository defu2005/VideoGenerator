CREATE TABLE `webhook_endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`event_types` text DEFAULT '[]' NOT NULL,
	`allow_private` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`disabled_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint_id` text NOT NULL,
	`event_id` text NOT NULL,
	`payload` text NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`next_attempt_at` text NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`endpoint_id`) REFERENCES `webhook_endpoints`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_due_idx` ON `webhook_deliveries` (`status`,`next_attempt_at`);