CREATE TABLE `health_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`refresh_enc` text NOT NULL,
	`access_enc` text,
	`access_expires_at` text,
	`scope` text,
	`connected_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`last_error` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `health_oauth_state` (
	`state` text PRIMARY KEY NOT NULL,
	`verifier` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `health_workouts` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text,
	`type` text NOT NULL,
	`name` text,
	`minutes` integer,
	`kcal` integer,
	`avg_hr` integer,
	`source` text DEFAULT 'fitbit' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `health_workouts_day_idx` ON `health_workouts` (`day`);