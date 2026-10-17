CREATE TABLE `calendar_feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feeds_token_uq` ON `calendar_feeds` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feeds_user_uq` ON `calendar_feeds` (`user_id`);--> statement-breakpoint
CREATE TABLE `candidate_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`author_id` text,
	`author_name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `candidate_comments_candidate_idx` ON `candidate_comments` (`candidate_id`);--> statement-breakpoint
CREATE TABLE `candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`email` text,
	`position` text NOT NULL,
	`stage` text DEFAULT 'new' NOT NULL,
	`interview_at` integer,
	`trial_at` integer,
	`cv_key` text,
	`cv_name` text,
	`cv_type` text,
	`hired_user_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`hired_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `candidates_loc_idx` ON `candidates` (`location_id`,`stage`);--> statement-breakpoint
CREATE INDEX `candidates_updated_idx` ON `candidates` (`updated_at`);--> statement-breakpoint
-- leaders (they plan the schedule of their divisions) also recruit for them
INSERT OR IGNORE INTO `manager_permissions` (`user_id`, `location_id`, `permission`, `granted_by`)
SELECT `user_id`, `location_id`, 'recruitment.manage', `granted_by` FROM `manager_permissions` WHERE `permission` = 'schedule.manage';
