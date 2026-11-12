ALTER TABLE `accounts` ADD `hidden` integer DEFAULT false NOT NULL;
--> statement-breakpoint
-- Upcoming transactions the bank has scheduled are no longer stored; see `isUpcoming` in the sync service.
DELETE FROM `transactions` WHERE `status` = 'pending' AND `transaction_date` IS NULL AND `booking_date` IS NOT NULL;
