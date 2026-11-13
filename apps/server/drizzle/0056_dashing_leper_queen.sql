CREATE TABLE `visual_crops` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`scene_id` text NOT NULL,
	`aspect` text NOT NULL,
	`box_x` integer NOT NULL,
	`box_y` integer NOT NULL,
	`box_w` integer NOT NULL,
	`box_h` integer NOT NULL,
	`rule` text NOT NULL,
	`focus_source` text NOT NULL,
	`manual` integer DEFAULT false NOT NULL,
	`output_path` text NOT NULL,
	`output_width` integer NOT NULL,
	`output_height` integer NOT NULL,
	`low_res` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `visual_candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `visual_crops_candidate_aspect_uq` ON `visual_crops` (`candidate_id`,`aspect`);