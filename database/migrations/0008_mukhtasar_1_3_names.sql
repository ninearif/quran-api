-- Al-Mukhtasar 1:3 (corrected and locked in 0007): translate both divine names as the English
-- Mukhtasar does ("the Most Merciful and Compassionate"), using the Thai Mukhtasar's own most
-- frequent renderings, ผู้ทรงกรุณาปรานี and ผู้ทรงเมตตาเสมอ.
UPDATE `verse_translations`
SET translation_text = 'เป็นการชื่นชมยกย่องพระองค์อัลลอฮฺว่าพระองค์คือผู้ทรงกรุณาปรานี ผู้ทรงเมตตาเสมอ หลังจากที่ได้สรรเสริญพระองค์ในอายะฮฺที่ผ่านมา',
  last_updated = strftime('%s', 'now'),
  is_locked = 1
WHERE surah_number = 1 AND verse_number = 3
  AND source_id IN (SELECT id FROM translation_sources WHERE external_type = 'mokhtasr');
