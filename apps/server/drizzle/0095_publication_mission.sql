ALTER TABLE `publications` ADD `mission_id` text;--> statement-breakpoint
CREATE INDEX `publications_mission_idx` ON `publications` (`mission_id`);
