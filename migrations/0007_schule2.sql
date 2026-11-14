CREATE TABLE `timetable` (
	`id` text PRIMARY KEY NOT NULL,
	`weekday` integer NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`subject` text NOT NULL,
	`room` text,
	`teacher` text,
	`valid_from` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	CONSTRAINT "timetable_weekday_chk" CHECK("timetable"."weekday" between 1 and 7)
);
--> statement-breakpoint
ALTER TABLE `subjects` ADD `counts` integer DEFAULT true NOT NULL;