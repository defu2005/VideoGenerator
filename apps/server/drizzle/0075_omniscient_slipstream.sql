CREATE TABLE `agent_escalations` (
	`id` text PRIMARY KEY NOT NULL,
	`from_kind` text NOT NULL,
	`from_instance` text NOT NULL,
	`to_kind` text NOT NULL,
	`kind` text NOT NULL,
	`object_ref` text DEFAULT '' NOT NULL,
	`summary` text NOT NULL,
	`evidence` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`deadline_at` text,
	`hops` integer DEFAULT 0 NOT NULL,
	`claimed_by` text,
	`resolved_by` text,
	`outcome` text,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_escalations_status_idx` ON `agent_escalations` (`status`,`to_kind`);--> statement-breakpoint
CREATE INDEX `agent_escalations_object_idx` ON `agent_escalations` (`kind`,`object_ref`);--> statement-breakpoint
CREATE TABLE `agent_idempotency` (
	`instance` text NOT NULL,
	`key` text NOT NULL,
	`tool` text NOT NULL,
	`result` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_idempotency_uq` ON `agent_idempotency` (`instance`,`key`);--> statement-breakpoint
CREATE TABLE `agent_instances` (
	`instance` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`environment` text DEFAULT 'unknown' NOT NULL,
	`version` text,
	`last_seen_at` text NOT NULL,
	`last_tool_at` text,
	`duty_heartbeat_at` text,
	`on_duty` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_key_profiles` (
	`key_id` text PRIMARY KEY NOT NULL,
	`agent_kind` text DEFAULT 'other' NOT NULL,
	`instance_name` text DEFAULT 'unknown' NOT NULL,
	`can_supervise` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_leases` (
	`resource_kind` text NOT NULL,
	`resource_id` text NOT NULL,
	`holder_kind` text NOT NULL,
	`holder_instance` text NOT NULL,
	`rank` integer NOT NULL,
	`fence` integer DEFAULT 1 NOT NULL,
	`run_id` text,
	`acquired_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`preempted_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_leases_resource_uq` ON `agent_leases` (`resource_kind`,`resource_id`);--> statement-breakpoint
CREATE INDEX `agent_leases_expires_idx` ON `agent_leases` (`expires_at`);