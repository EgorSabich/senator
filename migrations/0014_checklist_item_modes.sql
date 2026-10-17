ALTER TABLE `content_items` ADD `checklist_shared_keys` text;--> statement-breakpoint
-- Owner, 2026-10-17: every existing item becomes individual (each person ticks it); shared items are chosen per item from now on.
UPDATE `content_items` SET `checklist_mode` = 'individual' WHERE `kind` = 'checklist';
