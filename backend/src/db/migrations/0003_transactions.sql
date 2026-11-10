CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`status` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`booking_date` text,
	`value_date` text,
	`date` text NOT NULL,
	`description` text NOT NULL,
	`entry_reference` text,
	`dedup_key` text NOT NULL,
	`raw` text NOT NULL,
	`fetched_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_booked_dedup` ON `transactions` (`account_id`,`dedup_key`) WHERE "transactions"."status" = 'booked';--> statement-breakpoint
CREATE INDEX `transactions_account_date` ON `transactions` (`account_id`,`date`,`id`);