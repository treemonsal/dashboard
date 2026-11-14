CREATE TABLE `health_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id_enc` text NOT NULL,
	`client_secret_enc` text NOT NULL,
	`id_tail` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
