-- Give legacy monthly_reports rows (workspace_id IS NULL) to the default workspace
-- (oldest organization, same rule as defaultWorkspaceId in src/auth/workspaces.ts).
-- The next migration makes workspace_id NOT NULL and the primary key (workspace_id, month).
UPDATE `monthly_reports` SET `workspace_id` = (SELECT `id` FROM `organization` ORDER BY `created_at` ASC, `id` ASC LIMIT 1) WHERE `workspace_id` IS NULL;--> statement-breakpoint
-- If no organization exists, the rows stay NULL: delete them. Reports are rebuilt from revenue and cost data on demand.
DELETE FROM `monthly_reports` WHERE `workspace_id` IS NULL;
