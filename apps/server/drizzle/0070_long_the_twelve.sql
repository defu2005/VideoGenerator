PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_monthly_reports` (
	`workspace_id` text NOT NULL,
	`month` text NOT NULL,
	`json` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `month`)
);
--> statement-breakpoint
INSERT INTO `__new_monthly_reports`("workspace_id", "month", "json", "created_at") SELECT "workspace_id", "month", "json", "created_at" FROM `monthly_reports`;--> statement-breakpoint
DROP TABLE `monthly_reports`;--> statement-breakpoint
ALTER TABLE `__new_monthly_reports` RENAME TO `monthly_reports`;--> statement-breakpoint
PRAGMA foreign_keys=ON;