-- PC-22 / PC-23 / PC-24: the holiday calendar records which days are substitute days and the day
-- each one stands for, and the organisation records how a holiday on a weekend is treated for
-- carer pay. Additive only: no holiday date is added, removed or switched off, and the new
-- setting defaults to the behaviour that existed before it (BOTH), so no visit is re-priced.

-- AlterTable
ALTER TABLE "identity"."OrganisationGeneralSettings" ADD COLUMN     "holidayPremiumBasis" TEXT NOT NULL DEFAULT 'BOTH';

-- AlterTable
ALTER TABLE "lookups"."BankHoliday" ADD COLUMN     "isSubstitute" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "substituteForDate" DATE;

-- Rows that exist today were recorded before the source was kept.
UPDATE "lookups"."BankHoliday" SET "source" = 'LEGACY';

-- A holiday with a fixed date that is recorded on another date is a substitute day for it.
UPDATE "lookups"."BankHoliday" AS h
SET "isSubstitute" = true,
    "substituteForDate" = make_date(extract(year FROM h."holidayDate")::int, f.month, f.day)
FROM (
  VALUES
    ('%new year%', 1, 1),
    ('%2nd january%', 1, 2),
    ('%patrick%', 3, 17),
    ('%boyne%', 7, 12),
    ('%orangemen%', 7, 12),
    ('%andrew%', 11, 30),
    ('%christmas%', 12, 25),
    ('%boxing%', 12, 26)
) AS f(pattern, month, day)
WHERE lower(h."name") LIKE f.pattern
  AND h."region" <> 'ORGANISATION'
  AND NOT (extract(month FROM h."holidayDate") = f.month AND extract(day FROM h."holidayDate") = f.day);

-- Any other row that says it is a substitute day: marked, with the day it stands for left empty
-- for a person to fill in (the calendar status lists these).
UPDATE "lookups"."BankHoliday"
SET "isSubstitute" = true
WHERE "isSubstitute" = false AND lower("name") LIKE '%substitute%';
