CREATE TABLE `visual_query_patterns` (
	`workspace_id` text NOT NULL,
	`topic_tag` text NOT NULL,
	`shape` text NOT NULL,
	`accepted` integer DEFAULT 0 NOT NULL,
	`rejected` integer DEFAULT 0 NOT NULL,
	`example_query` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `topic_tag`, `shape`, `example_query`)
);
