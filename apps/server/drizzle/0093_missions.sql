CREATE TABLE `missions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`created_by` text NOT NULL,
	`command` text NOT NULL,
	`channel_profile_id` text,
	`project_ids` text DEFAULT '[]' NOT NULL,
	`plan` text DEFAULT '[]' NOT NULL,
	`state` text DEFAULT 'planning' NOT NULL,
	`owner` text,
	`autonomy_level` text NOT NULL,
	`deadline` text,
	`budget_usd` real,
	`report` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `missions_workspace_state_idx` ON `missions` (`workspace_id`,`state`);--> statement-breakpoint
CREATE INDEX `missions_owner_idx` ON `missions` (`owner`,`state`);
