-- Lets a verse translation be corrected by hand without the external-source refresh
-- (lazy revalidation and the admin bulk sync) overwriting it.
ALTER TABLE `verse_translations` ADD COLUMN `is_locked` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Al-Mukhtasar 1:3: the published Thai follows an older Arabic edition that lacks
-- "بأنه الرحمن الرحيم" (current Arabic: https://mokhtasr.com/en/books/200/1/3).
-- Corrected here and reported to Dar Al-Mukhtasar; unlock it once their Thai is fixed.
INSERT INTO `verse_translations` (source_id, surah_number, verse_number, translation_text, is_verified, last_updated, is_locked)
SELECT id, 1, 3, 'เป็นการชื่นชมยกย่องพระองค์อัลลอฮฺว่าพระองค์คืออัรเราะฮฺมาน อัรเราะฮีม หลังจากที่ได้สรรเสริญพระองค์ในอายะฮฺที่ผ่านมา', 1, strftime('%s', 'now'), 1
FROM translation_sources WHERE external_type = 'mokhtasr'
ON CONFLICT(source_id, surah_number, verse_number) DO UPDATE SET
  translation_text = excluded.translation_text,
  is_verified = 1,
  last_updated = excluded.last_updated,
  is_locked = 1;
