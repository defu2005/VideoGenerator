CREATE TABLE `profile_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`text` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `profile_memories_profile_idx` ON `profile_memories` (`profile_id`,`updated_at`);