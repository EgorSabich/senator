CREATE TABLE `menu_sections` (
	`location_id` text NOT NULL,
	`section` text NOT NULL,
	`note` text,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`location_id`, `section`),
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `menu_item_diets` ADD `source_note` text;--> statement-breakpoint
ALTER TABLE `menu_items` ADD `warn_guest` text;--> statement-breakpoint
ALTER TABLE `menu_items` ADD `diet_note` text;--> statement-breakpoint
ALTER TABLE `menu_items` ADD `import_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `menu_items_import_key_unique` ON `menu_items` (`location_id`,`import_key`);