-- Rename Vatten & avlopp so it also covers sophämtning (the same as DEFAULT_CATEGORIES in @bankapp/shared).
UPDATE `subcategories` SET `name` = 'Vatten, avlopp & sopor'
	WHERE `name` = 'Vatten & avlopp'
	AND `category_id` = (SELECT `id` FROM `categories` WHERE `name` = 'Boende & Hushåll');
