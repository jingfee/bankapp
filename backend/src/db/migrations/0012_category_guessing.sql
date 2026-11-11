CREATE TABLE `startup_tasks` (
	`name` text PRIMARY KEY NOT NULL,
	`completed_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `category_confirmed_at` integer;