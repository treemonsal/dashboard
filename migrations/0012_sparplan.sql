CREATE TABLE `depot_buys` (
	`id` text PRIMARY KEY NOT NULL,
	`deposit_key` text NOT NULL,
	`deposit_date` text NOT NULL,
	`symbol` text NOT NULL,
	`chf` real NOT NULL,
	`shares` real NOT NULL,
	`price` real NOT NULL,
	`fx` real NOT NULL,
	`buy_date` text NOT NULL,
	`late` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `depot_buys_uq` ON `depot_buys` (`deposit_key`,`symbol`);--> statement-breakpoint
CREATE INDEX `depot_buys_date_idx` ON `depot_buys` (`buy_date`);