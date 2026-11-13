ALTER TABLE `scripts` ADD `quality_score` real;--> statement-breakpoint
ALTER TABLE `scripts` ADD `blocking_facts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scripts` ADD `revise_round` integer DEFAULT 0 NOT NULL;