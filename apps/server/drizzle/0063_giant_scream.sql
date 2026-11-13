CREATE TABLE `source_manifests` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`render_id` text,
	`manifest` text NOT NULL,
	`scores` text NOT NULL,
	`verdict` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_manifests_project_uq` ON `source_manifests` (`project_id`);