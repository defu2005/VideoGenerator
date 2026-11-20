ALTER TABLE `improvement_requests` ADD `imp_number` integer;--> statement-breakpoint
ALTER TABLE `improvement_requests` ADD `drafted_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `improvement_requests_imp_number_idx` ON `improvement_requests` (`imp_number`);