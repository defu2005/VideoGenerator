CREATE TABLE `timelines` (
	`project_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`input_hash` text NOT NULL,
	`total_duration_sec` real NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
