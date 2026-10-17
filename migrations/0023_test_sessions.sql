CREATE TABLE `test_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`test_id` text NOT NULL,
	`started_by` text,
	`started_at` integer NOT NULL,
	`time_limit_sec` integer NOT NULL,
	`closes_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`test_id`) REFERENCES `tests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`started_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `test_sessions_loc_idx` ON `test_sessions` (`location_id`,`started_at`);--> statement-breakpoint
ALTER TABLE `attempt_answers` ADD `selected_json` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `multi` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `test_attempts` ADD `session_id` text;--> statement-breakpoint
ALTER TABLE `test_attempts` ADD `opened_at` integer;--> statement-breakpoint
ALTER TABLE `test_attempts` ADD `deadline_at` integer;--> statement-breakpoint
ALTER TABLE `tests` ADD `positions` text;--> statement-breakpoint
ALTER TABLE `tests` ADD `time_limit_sec` integer DEFAULT 600 NOT NULL;--> statement-breakpoint
ALTER TABLE `tests` ADD `shuffle_options` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- leaders who edit materials also make tests for their divisions
INSERT OR IGNORE INTO `manager_permissions` (`user_id`, `location_id`, `permission`, `granted_by`)
SELECT DISTINCT `user_id`, `location_id`, 'tests.edit', `granted_by` FROM `manager_permissions` WHERE `permission` = 'content.edit';
