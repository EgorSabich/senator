ALTER TABLE `unavailability` ADD `from_min` integer;--> statement-breakpoint
ALTER TABLE `unavailability` ADD `to_min` integer;--> statement-breakpoint
ALTER TABLE `unavailability` ADD `set_by` text REFERENCES users(id);--> statement-breakpoint
-- 2026-10-17: "Instrukcje stanowiskowe" are no longer a kind of material (owner): existing ones go to the archive.
UPDATE `content_items` SET `status` = 'archived' WHERE `kind` = 'job_description';
