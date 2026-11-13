CREATE TABLE `operator_skill_versions` (
	`name` text NOT NULL,
	`version` integer NOT NULL,
	`markdown` text NOT NULL,
	`evidence` text NOT NULL,
	`score` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`name`, `version`)
);
