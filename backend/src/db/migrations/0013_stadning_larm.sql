-- Add Larm & säkerhet and Städning to Boende & Hushåll (the same as DEFAULT_CATEGORIES in @bankapp/shared).
UPDATE `subcategories` SET `sort_order` = `sort_order` + 1
	WHERE `category_id` = (SELECT `id` FROM `categories` WHERE `name` = 'Boende & Hushåll') AND `sort_order` >= 6;
--> statement-breakpoint
UPDATE `subcategories` SET `sort_order` = `sort_order` + 1
	WHERE `category_id` = (SELECT `id` FROM `categories` WHERE `name` = 'Boende & Hushåll') AND `sort_order` >= 8;
--> statement-breakpoint
INSERT INTO `subcategories` (`category_id`, `name`, `icon`, `sort_order`) VALUES
	((SELECT `id` FROM `categories` WHERE `name` = 'Boende & Hushåll'), 'Larm & säkerhet', 'siren', 6),
	((SELECT `id` FROM `categories` WHERE `name` = 'Boende & Hushåll'), 'Städning', 'sparkles', 8);
