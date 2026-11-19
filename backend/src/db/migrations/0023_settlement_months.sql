CREATE TABLE `settlement_months` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`month` text NOT NULL,
	`closed_through` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settlement_months_month_unique` ON `settlement_months` (`month`);