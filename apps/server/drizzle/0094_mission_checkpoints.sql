CREATE TABLE `mission_checkpoints` (
	`mission_id` text NOT NULL,
	`kind` text NOT NULL,
	`at` text NOT NULL,
	`metrics` text,
	`report` text,
	PRIMARY KEY(`mission_id`, `kind`)
);
