-- UNKNOWN is stored as NULL; API maps NULL <-> UNKNOWN.
-- Run once against existing databases:
ALTER TABLE client ALTER COLUMN type DROP NOT NULL;
UPDATE client SET type = NULL WHERE type = 'UNKNOWN';
