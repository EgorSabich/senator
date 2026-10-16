DROP INDEX `checklist_marks_uq`;--> statement-breakpoint
ALTER TABLE `checklist_marks` ADD `owner_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `checklist_marks_owner_uq` ON `checklist_marks` (`content_item_id`,`business_date`,`item_key`,`owner_key`);--> statement-breakpoint
ALTER TABLE `content_items` ADD `checklist_mode` text DEFAULT 'individual' NOT NULL;--> statement-breakpoint
-- D42: checklists that already exist keep the D36 behaviour (one item, one person); new ones are individual.
UPDATE `content_items` SET `checklist_mode` = 'shared' WHERE `kind` = 'checklist';
