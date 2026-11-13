CREATE TABLE `autonomy_job_claims` (
	`id` integer PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`stage` text NOT NULL,
	`profile_id` text,
	`account_id` text
);
--> statement-breakpoint
CREATE INDEX `autonomy_claim_day_stage_idx` ON `autonomy_job_claims` (`day`,`stage`,`profile_id`);--> statement-breakpoint
CREATE INDEX `autonomy_claim_day_account_idx` ON `autonomy_job_claims` (`day`,`account_id`);