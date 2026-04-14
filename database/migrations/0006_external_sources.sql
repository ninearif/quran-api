-- Add external source support for third-party translation providers (e.g. Mokhtasr)
ALTER TABLE translation_sources ADD COLUMN external_type TEXT;
ALTER TABLE translation_sources ADD COLUMN external_config TEXT;
