-- Globally unique, case-insensitive account email addresses.
--
-- The application already lowercases every email before persisting it. This
-- migration makes the database enforce the same rule so two concurrent
-- registrations, or any future code path that forgets to normalize, cannot
-- create a second account for the same address.
--
-- The guard below refuses to run when existing rows differ only by case or
-- surrounding whitespace. That situation needs a deliberate human decision;
-- it must never be resolved by silently merging or deleting accounts.

DO $$
DECLARE
  duplicate_groups integer;
BEGIN
  SELECT count(*) INTO duplicate_groups
  FROM (
    SELECT lower(btrim("email")) AS normalized_email
    FROM "User"
    GROUP BY lower(btrim("email"))
    HAVING count(*) > 1
  ) duplicates;

  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce case-insensitive email uniqueness: % existing email group(s) differ only by case or surrounding whitespace. Resolve them manually before applying this migration.',
      duplicate_groups;
  END IF;
END $$;

-- Normalize existing rows before the functional unique index is created.
UPDATE "User"
SET "email" = lower(btrim("email"))
WHERE "email" <> lower(btrim("email"));

-- Case-insensitive uniqueness at the database level, independent of any
-- application validation. A failed unique constraint rolls back the whole
-- registration transaction, so no orphan school or membership is left behind.
CREATE UNIQUE INDEX "User_email_normalized_key"
  ON "User" (lower(btrim("email")));

-- Reject any future write that bypasses application normalization instead of
-- quietly storing a mixed-case duplicate that the functional index would miss.
ALTER TABLE "User"
  ADD CONSTRAINT "User_email_normalized_check"
  CHECK ("email" = lower(btrim("email")));
