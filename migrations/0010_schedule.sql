CREATE TABLE `schedule_shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`division` text NOT NULL,
	`start_min` integer NOT NULL,
	`end_min` integer NOT NULL,
	`note` text,
	`is_deleted` integer DEFAULT 0 NOT NULL,
	`published` integer DEFAULT 0 NOT NULL,
	`pub_start_min` integer,
	`pub_end_min` integer,
	`pub_note` text,
	`published_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `schedule_shifts_loc_date_idx` ON `schedule_shifts` (`location_id`,`date`);--> statement-breakpoint
CREATE INDEX `schedule_shifts_user_idx` ON `schedule_shifts` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `shift_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`division` text NOT NULL,
	`start_min` integer NOT NULL,
	`end_min` integer NOT NULL,
	`label` text,
	`use_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shift_templates_uq` ON `shift_templates` (`location_id`,`division`,`start_min`,`end_min`);--> statement-breakpoint
CREATE TABLE `unavailability` (
	`user_id` text NOT NULL,
	`location_id` text NOT NULL,
	`date` text NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `location_id`, `date`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `unavailability_loc_date_idx` ON `unavailability` (`location_id`,`date`);--> statement-breakpoint
ALTER TABLE `locations` ADD `unavail_deadline_dow` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `locations` ADD `unavail_deadline_hour` integer DEFAULT 23 NOT NULL;