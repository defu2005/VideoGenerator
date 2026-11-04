ALTER TABLE `visual_candidates` ADD `source_page_url` text;--> statement-breakpoint
ALTER TABLE `visual_candidates` ADD `license_verified` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `visual_candidates` ADD `why` text;