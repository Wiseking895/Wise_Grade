-- Align the school timezone default with Ghana Mean Time. This changes only
-- the column default; existing rows keep their stored value.
ALTER TABLE "School" ALTER COLUMN "timezone" SET DEFAULT 'Africa/Accra';
