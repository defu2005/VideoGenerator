CREATE TABLE `assistant_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assistant_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_messages_conversation_idx` ON `assistant_messages` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `assistant_pending_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`tool` text NOT NULL,
	`args` text NOT NULL,
	`summary` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_pending_actions_conversation_idx` ON `assistant_pending_actions` (`conversation_id`);