ALTER TABLE `scenes` ADD `no_visual` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `visual_candidates` ADD `local_path` text;--> statement-breakpoint
ALTER TABLE `visual_candidates` ADD `sha256` text;--> statement-breakpoint
ALTER TABLE `visual_candidates` ADD `bytes` integer;--> statement-breakpoint
ALTER TABLE `visual_candidates` ADD `actual_width` integer;--> statement-breakpoint
ALTER TABLE `visual_candidates` ADD `actual_height` integer;--> statement-breakpoint
ALTER TABLE `visual_candidates` ADD `downloaded_at` text;--> statement-breakpoint
ALTER TABLE `visual_candidates` ADD `download_error` text;