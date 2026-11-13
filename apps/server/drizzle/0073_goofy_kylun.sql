CREATE TABLE `node_lease_secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`lease_id` text NOT NULL,
	`job_id` text NOT NULL,
	`node_id` text NOT NULL,
	`stage` text NOT NULL,
	`scope` text NOT NULL,
	`label` text NOT NULL,
	`secret_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`revoked_reason` text
);
--> statement-breakpoint
CREATE INDEX `node_lease_secrets_lease_idx` ON `node_lease_secrets` (`lease_id`);--> statement-breakpoint
CREATE INDEX `node_lease_secrets_node_idx` ON `node_lease_secrets` (`node_id`,`created_at`);