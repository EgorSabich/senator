CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text,
	`key` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`original_name` text,
	`uploaded_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_key_unique` ON `media` (`key`);--> statement-breakpoint
CREATE INDEX `media_loc_idx` ON `media` (`location_id`);--> statement-breakpoint
ALTER TABLE `content_items` ADD `attachment_name` text;--> statement-breakpoint
ALTER TABLE `content_items` ADD `draft_title` text;--> statement-breakpoint
ALTER TABLE `content_items` ADD `draft_body_json` text;--> statement-breakpoint
ALTER TABLE `content_items` ADD `draft_updated_at` integer;--> statement-breakpoint
ALTER TABLE `content_items` ADD `draft_updated_by` text REFERENCES users(id);