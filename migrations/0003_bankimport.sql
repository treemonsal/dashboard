CREATE TABLE `category_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`pattern` text NOT NULL,
	`category` text NOT NULL,
	`whole_word` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_rules_pattern_uq` ON `category_rules` (`pattern`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `ref` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `hash` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `booked_at` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `currency` text DEFAULT 'CHF' NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `internal` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `meal_override` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_hash_uq` ON `transactions` (`hash`);