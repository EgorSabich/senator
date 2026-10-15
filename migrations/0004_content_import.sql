ALTER TABLE `content_items` ADD `import_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `content_items_import_key_uq` ON `content_items` (`location_id`,`import_key`);