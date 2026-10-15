ALTER TABLE `locations` ADD `address` text;--> statement-breakpoint
ALTER TABLE `locations` ADD `phone` text;--> statement-breakpoint
ALTER TABLE `locations` ADD `email` text;--> statement-breakpoint
ALTER TABLE `locations` ADD `opening_hours_json` text;--> statement-breakpoint
ALTER TABLE `locations` ADD `staff_note` text;--> statement-breakpoint
ALTER TABLE `locations` ADD `day_start_hour` integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE `locations` ADD `stale_hours` integer DEFAULT 16 NOT NULL;--> statement-breakpoint
-- D38: the Service Book is mandatory to read and confirm.
UPDATE `content_items` SET `requires_ack` = 1 WHERE `kind` = 'service_book';
