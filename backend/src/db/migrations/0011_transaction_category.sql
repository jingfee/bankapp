ALTER TABLE `transactions` ADD `subcategory_id` integer REFERENCES subcategories(id);--> statement-breakpoint
ALTER TABLE `transactions` ADD `category_confirmed` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `transactions_subcategory_id` ON `transactions` (`subcategory_id`);