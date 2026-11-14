CREATE TABLE `household_ratios` (
	`from` text PRIMARY KEY NOT NULL,
	`percent` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `accounts` ADD `share` text;--> statement-breakpoint
ALTER TABLE `subcategories` ADD `share` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `share` text;
--> statement-breakpoint
-- Add Avräkning delade utgifter to Överföring before Övrigt (the same as DEFAULT_CATEGORIES in @bankapp/shared).
UPDATE `subcategories` SET `sort_order` = `sort_order` + 1
	WHERE `category_id` = (SELECT `id` FROM `categories` WHERE `kind` = 'transfer') AND `sort_order` >= 3
	AND NOT EXISTS (SELECT 1 FROM `subcategories` WHERE `name` = 'Avräkning delade utgifter');
--> statement-breakpoint
INSERT INTO `subcategories` (`category_id`, `name`, `icon`, `sort_order`)
	SELECT `id`, 'Avräkning delade utgifter', 'hand-coins', 3 FROM `categories` WHERE `kind` = 'transfer'
	AND NOT EXISTS (SELECT 1 FROM `subcategories` WHERE `name` = 'Avräkning delade utgifter');
