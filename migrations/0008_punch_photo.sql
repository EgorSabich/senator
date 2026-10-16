ALTER TABLE `locations` ADD `punch_photo` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `time_punches` ADD `photo_key` text;