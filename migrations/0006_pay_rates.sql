CREATE TABLE `pay_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`location_id` text NOT NULL,
	`rate_grosze` integer NOT NULL,
	`valid_from` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pay_rates_uq` ON `pay_rates` (`user_id`,`location_id`,`valid_from`);--> statement-breakpoint
CREATE INDEX `pay_rates_loc_idx` ON `pay_rates` (`location_id`);