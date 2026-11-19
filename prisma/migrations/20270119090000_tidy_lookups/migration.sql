-- Tidy lookups: job title spelling and capitals, the duplicate "Grade1", and capitalised skills.
-- Each old name is renamed; if the tidy name already exists, everything pointing at the old row is moved to it
-- and the old row is switched off (kept, so history still resolves). Safe to run more than once.

CREATE OR REPLACE FUNCTION pg_temp.tidy_job_title(old_name text, new_name text) RETURNS void AS $$
DECLARE old_id uuid; new_id uuid;
BEGIN
  SELECT id INTO old_id FROM lookups."JobTitle" WHERE name = old_name;
  IF old_id IS NULL THEN RETURN; END IF;
  SELECT id INTO new_id FROM lookups."JobTitle" WHERE name = new_name AND id <> old_id;
  IF new_id IS NULL THEN
    UPDATE lookups."JobTitle" SET name = new_name, "updatedAt" = now() WHERE id = old_id;
  ELSE
    UPDATE employees."EmployeeEmployment" SET "jobTitleId" = new_id WHERE "jobTitleId" = old_id;
    UPDATE employees."Vacancy" SET "jobTitleId" = new_id WHERE "jobTitleId" = old_id;
    UPDATE employees."ComplianceRequirement" SET "jobTitleId" = new_id WHERE "jobTitleId" = old_id;
    UPDATE policies."PolicyAudience" SET "jobTitleId" = new_id WHERE "jobTitleId" = old_id;
    UPDATE lookups."JobTitle" SET "isActive" = false, "deletedAt" = now(), "updatedAt" = now() WHERE id = old_id;
  END IF;
END $$ LANGUAGE plpgsql;

SELECT pg_temp.tidy_job_title('ADMINISTRATIVE ASSISTANT', 'Administrative Assistant');
SELECT pg_temp.tidy_job_title('CARE WORKER', 'Care Worker');
SELECT pg_temp.tidy_job_title('Care Assitance', 'Care Assistant');
SELECT pg_temp.tidy_job_title('Drivers', 'Driver');
SELECT pg_temp.tidy_job_title('Feild Support Worker', 'Field Support Worker');
SELECT pg_temp.tidy_job_title('HEALTH CARE ASSISTANT', 'Healthcare Assistant');
SELECT pg_temp.tidy_job_title('Human Resource', 'Human Resources');
SELECT pg_temp.tidy_job_title('On-call person', 'On-call Person');
SELECT pg_temp.tidy_job_title('Operation Manager', 'Operations Manager');
SELECT pg_temp.tidy_job_title('Passenger Assitance', 'Passenger Assistant');
SELECT pg_temp.tidy_job_title('SWIFT LOCATOR', 'Swift Locator');
SELECT pg_temp.tidy_job_title('System Monitoring officer', 'System Monitoring Officer');
SELECT pg_temp.tidy_job_title('care support worker', 'Care Support Worker');
SELECT pg_temp.tidy_job_title('medication compliance', 'Medication Compliance');
SELECT pg_temp.tidy_job_title('senior carer', 'Senior Carer');
SELECT pg_temp.tidy_job_title('spot checker', 'Spot Checker');

-- "Grade1" duplicates "Grade 1".
DO $$
DECLARE old_id uuid; new_id uuid;
BEGIN
  SELECT id INTO old_id FROM lookups."Grade" WHERE name = 'Grade1';
  SELECT id INTO new_id FROM lookups."Grade" WHERE name = 'Grade 1';
  IF old_id IS NOT NULL AND new_id IS NOT NULL THEN
    UPDATE employees."EmployeeEmployment" SET "gradeId" = new_id WHERE "gradeId" = old_id;
    UPDATE lookups."Grade" SET "isActive" = false, "deletedAt" = now(), "updatedAt" = now() WHERE id = old_id;
  ELSIF old_id IS NOT NULL THEN
    UPDATE lookups."Grade" SET name = 'Grade 1', "updatedAt" = now() WHERE id = old_id;
  END IF;
END $$;

-- Skills written in capitals.
UPDATE lookups."SkillType" SET name = 'NCFE Level 2 Diploma in Care', "updatedAt" = now()
 WHERE name = 'NCFE LEVEL 2 DIPLOMA IN CARE' AND NOT EXISTS (SELECT 1 FROM lookups."SkillType" WHERE name = 'NCFE Level 2 Diploma in Care');
UPDATE lookups."SkillType" SET name = 'NCFE Level 3 Diploma in Care', "updatedAt" = now()
 WHERE name = 'NCFE LEVEL 3 DIPLOMA IN CARE' AND NOT EXISTS (SELECT 1 FROM lookups."SkillType" WHERE name = 'NCFE Level 3 Diploma in Care');
