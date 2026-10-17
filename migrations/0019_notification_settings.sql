CREATE TABLE `custom_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`divisions` text NOT NULL,
	`audience` text DEFAULT 'on_shift' NOT NULL,
	`trigger` text NOT NULL,
	`at_ms` integer,
	`days` integer DEFAULT 0 NOT NULL,
	`time_min` integer,
	`minutes` integer,
	`url` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `custom_notifications_loc_idx` ON `custom_notifications` (`location_id`);--> statement-breakpoint
CREATE TABLE `notification_rules` (
	`location_id` text NOT NULL,
	`division` text NOT NULL,
	`kind` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`time_min` integer,
	`minutes` integer,
	`list_ids` text,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`location_id`, `division`, `kind`),
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- leaders who plan the schedule also set up notifications of their divisions
INSERT OR IGNORE INTO `manager_permissions` (`user_id`, `location_id`, `permission`, `granted_by`)
SELECT `user_id`, `location_id`, 'notifications.manage', `granted_by` FROM `manager_permissions` WHERE `permission` = 'schedule.manage';
