CREATE TABLE `amortisation_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`part_id` integer NOT NULL,
	`from_date` text NOT NULL,
	`amount` real NOT NULL,
	FOREIGN KEY (`part_id`) REFERENCES `loan_parts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `amortisation_changes_part_from` ON `amortisation_changes` (`part_id`,`from_date`);--> statement-breakpoint
CREATE TABLE `interest_rate_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`part_id` integer NOT NULL,
	`from_date` text NOT NULL,
	`rate` real NOT NULL,
	FOREIGN KEY (`part_id`) REFERENCES `loan_parts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `interest_rate_changes_part_from` ON `interest_rate_changes` (`part_id`,`from_date`);--> statement-breakpoint
CREATE TABLE `loan_parts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`started_on` text NOT NULL,
	`ended_on` text,
	`rate_adjustment_date` text NOT NULL,
	`rate_adjustment_interval_months` integer NOT NULL,
	`terms_change_date` text NOT NULL,
	`terms_change_interval_months` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mortgage_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mortgage_entries_date_unique` ON `mortgage_entries` (`date`);--> statement-breakpoint
CREATE TABLE `mortgage_entry_debts` (
	`entry_id` integer NOT NULL,
	`part_id` integer NOT NULL,
	`debt` real NOT NULL,
	PRIMARY KEY(`entry_id`, `part_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `mortgage_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`part_id`) REFERENCES `loan_parts`(`id`) ON UPDATE no action ON DELETE no action
);
