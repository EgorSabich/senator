ALTER TABLE `locations` ADD `ack_days` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `first_login_at` integer;--> statement-breakpoint
-- people who already use the app get the reading period from today (deploy), not from their old first sign-in
UPDATE `users` SET `first_login_at` = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE `last_login_at` IS NOT NULL;
