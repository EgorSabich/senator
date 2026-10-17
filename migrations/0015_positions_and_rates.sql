DROP INDEX `pay_rates_uq`;--> statement-breakpoint
ALTER TABLE `pay_rates` ADD `position` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `pay_rates_uq` ON `pay_rates` (`user_id`,`location_id`,`position`,`valid_from`);--> statement-breakpoint
ALTER TABLE `time_entries` ADD `position` text;--> statement-breakpoint
ALTER TABLE `user_locations` ADD `is_primary` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- the first position a person got at a location becomes the main one
UPDATE `user_locations` SET `is_primary` = 1 WHERE `id` IN (
  SELECT `id` FROM `user_locations` ul WHERE NOT EXISTS (
    SELECT 1 FROM `user_locations` o WHERE o.`user_id` = ul.`user_id` AND o.`location_id` = ul.`location_id`
      AND (o.`created_at` < ul.`created_at` OR (o.`created_at` = ul.`created_at` AND o.`rowid` < ul.`rowid`))
  )
);
