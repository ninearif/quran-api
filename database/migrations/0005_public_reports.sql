-- Extend issue_reports table for public report feature
-- Adds: reportType, categories, suggestedText, suggestedFootnotes, contactName,
--        userId, status, sourceId, surahNumber, verseNumber, verseTranslationId

ALTER TABLE `issue_reports` ADD COLUMN `report_type` text NOT NULL DEFAULT 'quick';
--> statement-breakpoint
ALTER TABLE `issue_reports` ADD COLUMN `categories` text;
--> statement-breakpoint
ALTER TABLE `issue_reports` ADD COLUMN `suggested_text` text;
--> statement-breakpoint
ALTER TABLE `issue_reports` ADD COLUMN `suggested_footnotes` text;
--> statement-breakpoint
ALTER TABLE `issue_reports` ADD COLUMN `contact_name` text;
--> statement-breakpoint
ALTER TABLE `issue_reports` ADD COLUMN `user_id` integer REFERENCES `contributors`(`id`);
--> statement-breakpoint
ALTER TABLE `issue_reports` ADD COLUMN `status` text NOT NULL DEFAULT 'open';
--> statement-breakpoint
ALTER TABLE `issue_reports` ADD COLUMN `source_id` integer REFERENCES `translation_sources`(`id`);
--> statement-breakpoint
ALTER TABLE `issue_reports` ADD COLUMN `surah_number` integer;
--> statement-breakpoint
ALTER TABLE `issue_reports` ADD COLUMN `verse_number` integer;
--> statement-breakpoint
ALTER TABLE `issue_reports` ADD COLUMN `verse_translation_id` integer REFERENCES `verse_translations`(`id`);
--> statement-breakpoint
CREATE INDEX `idx_reports_fingerprint` ON `issue_reports` (`fingerprint`);
--> statement-breakpoint
CREATE INDEX `idx_reports_status` ON `issue_reports` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_reports_verse` ON `issue_reports` (`surah_number`, `verse_number`);
