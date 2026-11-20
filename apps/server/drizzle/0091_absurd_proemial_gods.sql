CREATE TABLE `stage_prompt_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`stage` text NOT NULL,
	`text_hash` text NOT NULL,
	`text` text NOT NULL,
	`status` text NOT NULL,
	`evidence` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`decided_at` text,
	`decided_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stage_prompt_variants_stage_hash` ON `stage_prompt_variants` (`stage`,`text_hash`);