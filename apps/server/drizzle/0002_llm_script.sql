CREATE TABLE `llm_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`response_text` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `research_notes` (
	`project_id` text PRIMARY KEY NOT NULL,
	`input_hash` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`cached` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `scripts` (
	`project_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`origin` text NOT NULL,
	`edited` integer DEFAULT false NOT NULL,
	`input_hash` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`provider` text,
	`model` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
