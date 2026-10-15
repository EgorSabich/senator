CREATE TABLE `checklist_days` (
	`content_item_id` text NOT NULL,
	`business_date` text NOT NULL,
	`location_id` text NOT NULL,
	`closed_by` text,
	`closed_at` integer NOT NULL,
	`done_count` integer NOT NULL,
	`total_count` integer NOT NULL,
	PRIMARY KEY(`content_item_id`, `business_date`),
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `checklist_days_loc_idx` ON `checklist_days` (`location_id`,`business_date`);--> statement-breakpoint
CREATE TABLE `checklist_marks` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`content_item_id` text NOT NULL,
	`business_date` text NOT NULL,
	`item_key` text NOT NULL,
	`item_text` text NOT NULL,
	`section` text,
	`user_id` text NOT NULL,
	`marked_at` integer NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`content_item_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `checklist_marks_uq` ON `checklist_marks` (`content_item_id`,`business_date`,`item_key`);--> statement-breakpoint
CREATE INDEX `checklist_marks_loc_date_idx` ON `checklist_marks` (`location_id`,`business_date`);--> statement-breakpoint
CREATE INDEX `checklist_marks_user_idx` ON `checklist_marks` (`user_id`,`business_date`);--> statement-breakpoint
CREATE TABLE `terminals` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`last_seen_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `terminals_user_uq` ON `terminals` (`user_id`);--> statement-breakpoint
CREATE INDEX `terminals_loc_idx` ON `terminals` (`location_id`);--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`user_id` text NOT NULL,
	`business_date` text NOT NULL,
	`clock_in_at` integer NOT NULL,
	`clock_out_at` integer,
	`in_source` text NOT NULL,
	`out_source` text,
	`in_terminal_id` text,
	`out_terminal_id` text,
	`note` text,
	`edited_by` text,
	`edited_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`edited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `time_entries_loc_date_idx` ON `time_entries` (`location_id`,`business_date`);--> statement-breakpoint
CREATE INDEX `time_entries_user_idx` ON `time_entries` (`user_id`,`clock_in_at`);--> statement-breakpoint
CREATE TABLE `time_punches` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`terminal_id` text NOT NULL,
	`user_id` text,
	`at` integer NOT NULL,
	`offline` integer DEFAULT false NOT NULL,
	`outcome` text NOT NULL,
	`entry_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `time_punches_client_uq` ON `time_punches` (`terminal_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `time_punches_user_idx` ON `time_punches` (`user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `pin_lookup` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_pin_lookup_uq` ON `users` (`pin_lookup`);