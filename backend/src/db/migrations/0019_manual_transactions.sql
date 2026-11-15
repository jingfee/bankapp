CREATE TABLE `__offsets` AS SELECT `id`, `offsets_transaction_id` FROM `transactions` WHERE `offsets_transaction_id` IS NOT NULL;--> statement-breakpoint
UPDATE `transactions` SET `offsets_transaction_id` = NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer,
	`status` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`booking_date` text,
	`value_date` text,
	`transaction_date` text,
	`date` text NOT NULL,
	`description` text NOT NULL,
	`entry_reference` text,
	`dedup_key` text NOT NULL,
	`raw` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`subcategory_id` integer,
	`category_confirmed` integer DEFAULT false NOT NULL,
	`category_confirmed_at` integer,
	`offsets_transaction_id` integer,
	`share` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subcategory_id`) REFERENCES `subcategories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`offsets_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_transactions`("id", "account_id", "status", "amount", "currency", "booking_date", "value_date", "transaction_date", "date", "description", "entry_reference", "dedup_key", "raw", "fetched_at", "subcategory_id", "category_confirmed", "category_confirmed_at", "offsets_transaction_id", "share") SELECT "id", "account_id", "status", "amount", "currency", "booking_date", "value_date", "transaction_date", "date", "description", "entry_reference", "dedup_key", "raw", "fetched_at", "subcategory_id", "category_confirmed", "category_confirmed_at", "offsets_transaction_id", "share" FROM `transactions`;--> statement-breakpoint
DROP TABLE `transactions`;--> statement-breakpoint
ALTER TABLE `__new_transactions` RENAME TO `transactions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_booked_dedup` ON `transactions` (`account_id`,`dedup_key`) WHERE "transactions"."status" = 'booked';--> statement-breakpoint
CREATE INDEX `transactions_account_date` ON `transactions` (`account_id`,`date`,`id`);--> statement-breakpoint
CREATE INDEX `transactions_subcategory_id` ON `transactions` (`subcategory_id`);--> statement-breakpoint
CREATE INDEX `transactions_offsets_transaction_id` ON `transactions` (`offsets_transaction_id`);
--> statement-breakpoint
UPDATE `transactions` SET `offsets_transaction_id` = (SELECT `offsets_transaction_id` FROM `__offsets` WHERE `__offsets`.`id` = `transactions`.`id`) WHERE `id` IN (SELECT `id` FROM `__offsets`);--> statement-breakpoint
DROP TABLE `__offsets`;