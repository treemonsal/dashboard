CREATE TABLE `intake_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intake_keys_hash_unique` ON `intake_keys` (`hash`);--> statement-breakpoint
CREATE TABLE `intake_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`kind` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `intake_log_at_idx` ON `intake_log` (`at`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `anchor_balance` real;--> statement-breakpoint
ALTER TABLE `accounts` ADD `anchor_day` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `anchor_at` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `anchor_kind` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `entered_balance` real;--> statement-breakpoint
ALTER TABLE `accounts` ADD `entered_day` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `entered_at` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `state` text DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `origin` text DEFAULT 'auszug' NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `dedupe` text;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_dedupe_uq` ON `transactions` (`dedupe`);