CREATE TABLE `attendance_excuses` (
	`shift_id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attendance_excuses_loc_idx` ON `attendance_excuses` (`location_id`,`date`);--> statement-breakpoint
ALTER TABLE `candidates` ADD `source` text;--> statement-breakpoint
ALTER TABLE `candidates` ADD `reject_reason` text;--> statement-breakpoint
ALTER TABLE `candidates` ADD `no_show_interview` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `candidates` ADD `no_show_trial` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- leaders who manage time or the schedule see the statistics of their divisions
INSERT OR IGNORE INTO `manager_permissions` (`user_id`, `location_id`, `permission`, `granted_by`)
SELECT DISTINCT `user_id`, `location_id`, 'stats.view', `granted_by` FROM `manager_permissions` WHERE `permission` IN ('schedule.manage', 'time.manage');
