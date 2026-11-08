-- Al-Mukhtasar 101:1-3: "หัวใจของมนุษย์ตื่นเต้น" (excited) misreads the dread of al-Qari'ah;
-- the hearts are terrified, so "ตื่นตระหนก". Locked so the source sync keeps the correction.
UPDATE `verse_translations`
SET translation_text = replace(translation_text, 'หัวใจของมนุษย์ตื่นเต้น', 'หัวใจของมนุษย์ตื่นตระหนก'),
  last_updated = strftime('%s', 'now'),
  is_locked = 1
WHERE surah_number = 101 AND verse_number IN (1, 2, 3)
  AND source_id IN (SELECT id FROM translation_sources WHERE external_type = 'mokhtasr');
