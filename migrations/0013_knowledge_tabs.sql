CREATE TABLE `knowledge_tabs` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text,
	`title` text NOT NULL,
	`positions` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `content_items` ADD `tab_id` text;--> statement-breakpoint
-- Built-in tab: the Service Book is for waiters (runners see it through their division).
INSERT INTO `knowledge_tabs` (`id`, `location_id`, `title`, `positions`, `sort_order`) VALUES ('kt_service_book', NULL, 'Service Book', 'waiter', 0);
