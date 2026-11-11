CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`colour` text NOT NULL,
	`icon` text NOT NULL,
	`sort_order` integer NOT NULL,
	`fixed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_one_income_or_transfer` ON `categories` (`kind`) WHERE kind <> 'expense';--> statement-breakpoint
CREATE TABLE `subcategories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category_id` integer NOT NULL,
	`name` text NOT NULL,
	`icon` text NOT NULL,
	`sort_order` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `subcategories_category_id` ON `subcategories` (`category_id`);
--> statement-breakpoint
-- Seed the default list (the same as DEFAULT_CATEGORIES in @bankapp/shared).
INSERT INTO `categories` (`name`, `kind`, `colour`, `icon`, `sort_order`, `fixed`) VALUES ('Boende & Hushåll', 'expense', 'orange', 'house', 0, 0);
--> statement-breakpoint
INSERT INTO `subcategories` (`category_id`, `name`, `icon`, `sort_order`) VALUES
	((SELECT `id` FROM `categories` WHERE `name` = 'Boende & Hushåll'), 'Bolån ränta & amortering', 'key-round', 0),
	((SELECT `id` FROM `categories` WHERE `name` = 'Boende & Hushåll'), 'Hyra & avgift', 'receipt', 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Boende & Hushåll'), 'El & värme', 'zap', 2),
	((SELECT `id` FROM `categories` WHERE `name` = 'Boende & Hushåll'), 'Vatten & avlopp', 'droplets', 3),
	((SELECT `id` FROM `categories` WHERE `name` = 'Boende & Hushåll'), 'Bredband, TV & mobil', 'wifi', 4),
	((SELECT `id` FROM `categories` WHERE `name` = 'Boende & Hushåll'), 'Hemförsäkring', 'shield-check', 5),
	((SELECT `id` FROM `categories` WHERE `name` = 'Boende & Hushåll'), 'Hushållsartiklar', 'spray-can', 6),
	((SELECT `id` FROM `categories` WHERE `name` = 'Boende & Hushåll'), 'Inredning & möbler', 'sofa', 7),
	((SELECT `id` FROM `categories` WHERE `name` = 'Boende & Hushåll'), 'Renovering & underhåll', 'hammer', 8),
	((SELECT `id` FROM `categories` WHERE `name` = 'Boende & Hushåll'), 'Trädgård', 'flower-2', 9),
	((SELECT `id` FROM `categories` WHERE `name` = 'Boende & Hushåll'), 'Övrigt', 'circle-ellipsis', 10);
--> statement-breakpoint
INSERT INTO `categories` (`name`, `kind`, `colour`, `icon`, `sort_order`, `fixed`) VALUES ('Mat & Dryck', 'expense', 'green', 'utensils', 1, 0);
--> statement-breakpoint
INSERT INTO `subcategories` (`category_id`, `name`, `icon`, `sort_order`) VALUES
	((SELECT `id` FROM `categories` WHERE `name` = 'Mat & Dryck'), 'Livsmedel', 'shopping-basket', 0),
	((SELECT `id` FROM `categories` WHERE `name` = 'Mat & Dryck'), 'Restaurang', 'utensils-crossed', 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Mat & Dryck'), 'Café & fika', 'coffee', 2),
	((SELECT `id` FROM `categories` WHERE `name` = 'Mat & Dryck'), 'Snabbmat & hämtmat', 'sandwich', 3),
	((SELECT `id` FROM `categories` WHERE `name` = 'Mat & Dryck'), 'Alkohol', 'wine', 4),
	((SELECT `id` FROM `categories` WHERE `name` = 'Mat & Dryck'), 'Övrigt', 'circle-ellipsis', 5);
--> statement-breakpoint
INSERT INTO `categories` (`name`, `kind`, `colour`, `icon`, `sort_order`, `fixed`) VALUES ('Transport', 'expense', 'blue', 'bus', 2, 0);
--> statement-breakpoint
INSERT INTO `subcategories` (`category_id`, `name`, `icon`, `sort_order`) VALUES
	((SELECT `id` FROM `categories` WHERE `name` = 'Transport'), 'Kollektivtrafik', 'train-front', 0),
	((SELECT `id` FROM `categories` WHERE `name` = 'Transport'), 'Bilpool & hyrbil', 'car', 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Transport'), 'Taxi', 'car-taxi-front', 2),
	((SELECT `id` FROM `categories` WHERE `name` = 'Transport'), 'Övrigt', 'circle-ellipsis', 3);
--> statement-breakpoint
INSERT INTO `categories` (`name`, `kind`, `colour`, `icon`, `sort_order`, `fixed`) VALUES ('Shopping', 'expense', 'pink', 'shopping-bag', 3, 0);
--> statement-breakpoint
INSERT INTO `subcategories` (`category_id`, `name`, `icon`, `sort_order`) VALUES
	((SELECT `id` FROM `categories` WHERE `name` = 'Shopping'), 'Kläder & skor', 'shirt', 0),
	((SELECT `id` FROM `categories` WHERE `name` = 'Shopping'), 'Elektronik', 'smartphone', 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Shopping'), 'Sport & friluft', 'bike', 2),
	((SELECT `id` FROM `categories` WHERE `name` = 'Shopping'), 'Böcker & tidningar', 'book-open', 3),
	((SELECT `id` FROM `categories` WHERE `name` = 'Shopping'), 'Övrigt', 'circle-ellipsis', 4);
--> statement-breakpoint
INSERT INTO `categories` (`name`, `kind`, `colour`, `icon`, `sort_order`, `fixed`) VALUES ('Nöje & Fritid', 'expense', 'purple', 'ticket', 4, 0);
--> statement-breakpoint
INSERT INTO `subcategories` (`category_id`, `name`, `icon`, `sort_order`) VALUES
	((SELECT `id` FROM `categories` WHERE `name` = 'Nöje & Fritid'), 'Streaming & prenumerationer', 'tv', 0),
	((SELECT `id` FROM `categories` WHERE `name` = 'Nöje & Fritid'), 'Träning & gym', 'dumbbell', 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Nöje & Fritid'), 'Kultur & evenemang', 'drama', 2),
	((SELECT `id` FROM `categories` WHERE `name` = 'Nöje & Fritid'), 'Hobby', 'palette', 3),
	((SELECT `id` FROM `categories` WHERE `name` = 'Nöje & Fritid'), 'Spel', 'gamepad-2', 4),
	((SELECT `id` FROM `categories` WHERE `name` = 'Nöje & Fritid'), 'Kurser & utbildningar', 'graduation-cap', 5),
	((SELECT `id` FROM `categories` WHERE `name` = 'Nöje & Fritid'), 'Övrigt', 'circle-ellipsis', 6);
--> statement-breakpoint
INSERT INTO `categories` (`name`, `kind`, `colour`, `icon`, `sort_order`, `fixed`) VALUES ('Hälsa & Skönhet', 'expense', 'rose', 'heart-pulse', 5, 0);
--> statement-breakpoint
INSERT INTO `subcategories` (`category_id`, `name`, `icon`, `sort_order`) VALUES
	((SELECT `id` FROM `categories` WHERE `name` = 'Hälsa & Skönhet'), 'Vård', 'stethoscope', 0),
	((SELECT `id` FROM `categories` WHERE `name` = 'Hälsa & Skönhet'), 'Tandvård', 'smile', 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Hälsa & Skönhet'), 'Apotek', 'pill', 2),
	((SELECT `id` FROM `categories` WHERE `name` = 'Hälsa & Skönhet'), 'Frisör & skönhet', 'scissors', 3),
	((SELECT `id` FROM `categories` WHERE `name` = 'Hälsa & Skönhet'), 'Övrigt', 'circle-ellipsis', 4);
--> statement-breakpoint
INSERT INTO `categories` (`name`, `kind`, `colour`, `icon`, `sort_order`, `fixed`) VALUES ('Husdjur', 'expense', 'amber', 'paw-print', 6, 0);
--> statement-breakpoint
INSERT INTO `subcategories` (`category_id`, `name`, `icon`, `sort_order`) VALUES
	((SELECT `id` FROM `categories` WHERE `name` = 'Husdjur'), 'Djurmat', 'bone', 0),
	((SELECT `id` FROM `categories` WHERE `name` = 'Husdjur'), 'Veterinär', 'syringe', 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Husdjur'), 'Djurförsäkring', 'shield-check', 2),
	((SELECT `id` FROM `categories` WHERE `name` = 'Husdjur'), 'Övrigt', 'circle-ellipsis', 3);
--> statement-breakpoint
INSERT INTO `categories` (`name`, `kind`, `colour`, `icon`, `sort_order`, `fixed`) VALUES ('Resor', 'expense', 'teal', 'plane', 7, 0);
--> statement-breakpoint
INSERT INTO `subcategories` (`category_id`, `name`, `icon`, `sort_order`) VALUES
	((SELECT `id` FROM `categories` WHERE `name` = 'Resor'), 'Flyg & tåg', 'plane-takeoff', 0),
	((SELECT `id` FROM `categories` WHERE `name` = 'Resor'), 'Hotell & boende', 'bed-double', 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Resor'), 'Aktiviteter', 'tent', 2),
	((SELECT `id` FROM `categories` WHERE `name` = 'Resor'), 'Övrigt', 'circle-ellipsis', 3);
--> statement-breakpoint
INSERT INTO `categories` (`name`, `kind`, `colour`, `icon`, `sort_order`, `fixed`) VALUES ('Ekonomi & Försäkring', 'expense', 'slate', 'landmark', 8, 0);
--> statement-breakpoint
INSERT INTO `subcategories` (`category_id`, `name`, `icon`, `sort_order`) VALUES
	((SELECT `id` FROM `categories` WHERE `name` = 'Ekonomi & Försäkring'), 'Bankavgifter', 'building-2', 0),
	((SELECT `id` FROM `categories` WHERE `name` = 'Ekonomi & Försäkring'), 'Kortränta & avgifter', 'credit-card', 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Ekonomi & Försäkring'), 'Övriga försäkringar', 'shield', 2),
	((SELECT `id` FROM `categories` WHERE `name` = 'Ekonomi & Försäkring'), 'Fackavgift & a-kassa', 'users', 3),
	((SELECT `id` FROM `categories` WHERE `name` = 'Ekonomi & Försäkring'), 'Övrigt', 'circle-ellipsis', 4);
--> statement-breakpoint
INSERT INTO `categories` (`name`, `kind`, `colour`, `icon`, `sort_order`, `fixed`) VALUES ('Gåvor & Välgörenhet', 'expense', 'red', 'gift', 9, 0);
--> statement-breakpoint
INSERT INTO `subcategories` (`category_id`, `name`, `icon`, `sort_order`) VALUES
	((SELECT `id` FROM `categories` WHERE `name` = 'Gåvor & Välgörenhet'), 'Presenter', 'gift', 0),
	((SELECT `id` FROM `categories` WHERE `name` = 'Gåvor & Välgörenhet'), 'Välgörenhet', 'hand-heart', 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Gåvor & Välgörenhet'), 'Övrigt', 'circle-ellipsis', 2);
--> statement-breakpoint
INSERT INTO `categories` (`name`, `kind`, `colour`, `icon`, `sort_order`, `fixed`) VALUES ('Övrigt', 'expense', 'gray', 'circle-ellipsis', 10, 0);
--> statement-breakpoint
INSERT INTO `subcategories` (`category_id`, `name`, `icon`, `sort_order`) VALUES
	((SELECT `id` FROM `categories` WHERE `name` = 'Övrigt'), 'Kontantuttag', 'banknote', 0),
	((SELECT `id` FROM `categories` WHERE `name` = 'Övrigt'), 'Övrigt', 'circle-ellipsis', 1);
--> statement-breakpoint
INSERT INTO `categories` (`name`, `kind`, `colour`, `icon`, `sort_order`, `fixed`) VALUES ('Inkomst', 'income', 'emerald', 'wallet', 11, 1);
--> statement-breakpoint
INSERT INTO `subcategories` (`category_id`, `name`, `icon`, `sort_order`) VALUES
	((SELECT `id` FROM `categories` WHERE `name` = 'Inkomst'), 'Lön', 'briefcase', 0),
	((SELECT `id` FROM `categories` WHERE `name` = 'Inkomst'), 'Bidrag', 'hand-coins', 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Inkomst'), 'Skatteåterbäring', 'receipt-text', 2),
	((SELECT `id` FROM `categories` WHERE `name` = 'Inkomst'), 'Ränta & utdelning', 'trending-up', 3),
	((SELECT `id` FROM `categories` WHERE `name` = 'Inkomst'), 'Försäljning', 'tag', 4),
	((SELECT `id` FROM `categories` WHERE `name` = 'Inkomst'), 'Gåvor', 'gift', 5),
	((SELECT `id` FROM `categories` WHERE `name` = 'Inkomst'), 'Övrigt', 'circle-ellipsis', 6);
--> statement-breakpoint
INSERT INTO `categories` (`name`, `kind`, `colour`, `icon`, `sort_order`, `fixed`) VALUES ('Överföring', 'transfer', 'indigo', 'arrow-left-right', 12, 1);
--> statement-breakpoint
INSERT INTO `subcategories` (`category_id`, `name`, `icon`, `sort_order`) VALUES
	((SELECT `id` FROM `categories` WHERE `name` = 'Överföring'), 'Mellan egna konton', 'arrow-left-right', 0),
	((SELECT `id` FROM `categories` WHERE `name` = 'Överföring'), 'Kortbetalning', 'credit-card', 1),
	((SELECT `id` FROM `categories` WHERE `name` = 'Överföring'), 'Sparande & investeringar', 'piggy-bank', 2),
	((SELECT `id` FROM `categories` WHERE `name` = 'Överföring'), 'Övrigt', 'circle-ellipsis', 3);
