CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` integer NOT NULL,
	`identification_hash` text NOT NULL,
	`uid` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`currency` text NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_identification_hash_unique` ON `accounts` (`identification_hash`);--> statement-breakpoint
CREATE TABLE `authorisations` (
	`state` text PRIMARY KEY NOT NULL,
	`bank_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bank_name` text NOT NULL,
	`session_id` text NOT NULL,
	`valid_until` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connections_bank_name_unique` ON `connections` (`bank_name`);--> statement-breakpoint
-- The bank list is only a cache and is refetched at startup when empty; clearing it lets the new required columns be added.
DELETE FROM `banks`;--> statement-breakpoint
ALTER TABLE `banks` ADD `maximum_consent_seconds` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `banks` ADD `personnummer` text NOT NULL;