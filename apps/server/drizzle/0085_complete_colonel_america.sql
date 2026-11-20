CREATE TABLE `blobs` (
	`sha256` text PRIMARY KEY NOT NULL,
	`size` integer NOT NULL,
	`provider` text NOT NULL,
	`key` text NOT NULL,
	`location_id` text NOT NULL,
	`stored_at` text NOT NULL,
	`verified_at` text NOT NULL
);
