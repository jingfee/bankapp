ALTER TABLE `transactions` ADD `transaction_date` text;--> statement-breakpoint
-- Re-date stored rows from the bank's raw response (ADR 0001). Dedup keys are left alone.
-- `date` is transaction date, else value date, else booking date; a row with none of them keeps
-- the day it was fetched, which is what it already holds. Rows whose raw is not JSON are skipped.
UPDATE `transactions`
SET `transaction_date` = json_extract(`raw`, '$.transaction_date'),
    `value_date` = json_extract(`raw`, '$.value_date'),
    `date` = COALESCE(
      json_extract(`raw`, '$.transaction_date'),
      json_extract(`raw`, '$.value_date'),
      json_extract(`raw`, '$.booking_date'),
      `date`
    )
WHERE json_valid(`raw`);
