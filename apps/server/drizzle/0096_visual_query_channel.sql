PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_visual_query_patterns` (
	`workspace_id` text NOT NULL,
	`channel` text DEFAULT '' NOT NULL,
	`topic_tag` text NOT NULL,
	`shape` text NOT NULL,
	`accepted` integer DEFAULT 0 NOT NULL,
	`rejected` integer DEFAULT 0 NOT NULL,
	`example_query` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `channel`, `topic_tag`, `shape`, `example_query`)
);
--> statement-breakpoint
INSERT INTO `__new_visual_query_patterns`("workspace_id", "channel", "topic_tag", "shape", "accepted", "rejected", "example_query", "updated_at") SELECT "workspace_id", '', "topic_tag", "shape", "accepted", "rejected", "example_query", "updated_at" FROM `visual_query_patterns`;--> statement-breakpoint
DROP TABLE `visual_query_patterns`;--> statement-breakpoint
ALTER TABLE `__new_visual_query_patterns` RENAME TO `visual_query_patterns`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
