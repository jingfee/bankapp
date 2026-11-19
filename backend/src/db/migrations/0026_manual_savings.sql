CREATE TABLE `balance_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`date` text NOT NULL,
	`balance` real NOT NULL,
	`net_deposits` real,
	FOREIGN KEY (`account_id`) REFERENCES `manual_savings_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `balance_entries_account_date` ON `balance_entries` (`account_id`,`date`);--> statement-breakpoint
CREATE TABLE `manual_savings_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`institution` text,
	`closed_on` text
);
