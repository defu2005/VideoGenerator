CREATE TABLE `review_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`project_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`proposals` text,
	`usage` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `review_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `review_messages_thread_idx` ON `review_messages` (`thread_id`);--> statement-breakpoint
CREATE INDEX `review_messages_project_idx` ON `review_messages` (`project_id`);--> statement-breakpoint
CREATE TABLE `review_proposal_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`project_id` text NOT NULL,
	`proposal_index` integer NOT NULL,
	`result` text,
	`applied_at` text NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `review_messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `review_proposal_applications_message_idx` ON `review_proposal_applications` (`message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_proposal_applications_uq` ON `review_proposal_applications` (`message_id`,`proposal_index`);--> statement-breakpoint
CREATE TABLE `review_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`context_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `review_threads_project_idx` ON `review_threads` (`project_id`);