ALTER TABLE `voice_tracks` ADD `words` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `voice_tracks` ADD `timing_source` text DEFAULT 'estimated' NOT NULL;