CREATE TABLE `health_sleep` (
	`day` text PRIMARY KEY NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`asleep_min` integer,
	`awake_min` integer,
	`deep_min` integer,
	`light_min` integer,
	`rem_min` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `exam_topics` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `exam_topics` ADD `summary` text;