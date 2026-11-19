-- Platform-wide phone-number uniqueness.
--
-- The application now stores every user phone number in canonical E.164 form
-- (Ghanaian numbers become +233XXXXXXXXX). This migration:
--
--   1. Aborts if two existing accounts resolve to the same canonical number.
--      It never deletes, merges or reassigns an account.
--   2. Rewrites only the *formatting* of existing phone values to that same
--      canonical form. The dialled number is unchanged.
--   3. Adds a unique index on User.phone. PostgreSQL allows multiple NULLs, so
--      accounts without a phone number remain valid.
--
-- Review the preflight result before applying this migration in production.
-- Email uniqueness already exists as "User_email_key" and is backed by the
-- lowercase normalization in the application.

DO $$
DECLARE
  duplicate_groups integer;
BEGIN
  WITH normalized AS (
    SELECT
      id,
      CASE
        WHEN digits LIKE '00%' THEN '+' || substr(digits, 3)
        WHEN digits LIKE '233%' THEN '+233' || substr(digits, 4)
        WHEN digits LIKE '0%' THEN '+233' || substr(digits, 2)
        WHEN btrim(phone) LIKE '+%' THEN '+' || digits
        ELSE '+' || digits
      END AS canonical
    FROM "User",
      LATERAL (
        SELECT regexp_replace(phone, '[^0-9]', '', 'g') AS digits
      ) AS cleaned
    WHERE phone IS NOT NULL AND btrim(phone) <> ''
  )
  SELECT count(*) INTO duplicate_groups
  FROM (
    SELECT canonical
    FROM normalized
    GROUP BY canonical
    HAVING count(*) > 1
  ) AS duplicates;

  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'Cannot add User.phone unique index: % canonical phone number(s) are shared by multiple accounts. Resolve them manually; no account was changed.',
      duplicate_groups;
  END IF;
END $$;

UPDATE "User"
SET phone = CASE
  WHEN regexp_replace(phone, '[^0-9]', '', 'g') LIKE '00%'
    THEN '+' || substr(regexp_replace(phone, '[^0-9]', '', 'g'), 3)
  WHEN regexp_replace(phone, '[^0-9]', '', 'g') LIKE '233%'
    THEN '+233' || substr(regexp_replace(phone, '[^0-9]', '', 'g'), 4)
  WHEN regexp_replace(phone, '[^0-9]', '', 'g') LIKE '0%'
    THEN '+233' || substr(regexp_replace(phone, '[^0-9]', '', 'g'), 2)
  WHEN btrim(phone) LIKE '+%'
    THEN '+' || regexp_replace(phone, '[^0-9]', '', 'g')
  ELSE '+' || regexp_replace(phone, '[^0-9]', '', 'g')
END
WHERE phone IS NOT NULL
  AND btrim(phone) <> ''
  AND phone <> CASE
    WHEN regexp_replace(phone, '[^0-9]', '', 'g') LIKE '00%'
      THEN '+' || substr(regexp_replace(phone, '[^0-9]', '', 'g'), 3)
    WHEN regexp_replace(phone, '[^0-9]', '', 'g') LIKE '233%'
      THEN '+233' || substr(regexp_replace(phone, '[^0-9]', '', 'g'), 4)
    WHEN regexp_replace(phone, '[^0-9]', '', 'g') LIKE '0%'
      THEN '+233' || substr(regexp_replace(phone, '[^0-9]', '', 'g'), 2)
    WHEN btrim(phone) LIKE '+%'
      THEN '+' || regexp_replace(phone, '[^0-9]', '', 'g')
    ELSE '+' || regexp_replace(phone, '[^0-9]', '', 'g')
  END;

CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
