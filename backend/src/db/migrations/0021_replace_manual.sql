CREATE TABLE `replace_rejections` (
	`manual_transaction_id` integer NOT NULL,
	`bank_transaction_id` integer NOT NULL,
	PRIMARY KEY(`manual_transaction_id`, `bank_transaction_id`),
	FOREIGN KEY (`manual_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bank_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `replaces_transaction_id` integer REFERENCES transactions(id);--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_replaces_transaction_id` ON `transactions` (`replaces_transaction_id`) WHERE "transactions"."replaces_transaction_id" IS NOT NULL;