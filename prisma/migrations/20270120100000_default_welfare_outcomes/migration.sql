-- Default "how did you find them on arrival" options for the Care app clock-in (Settings › Welfare outcomes).
-- The list was created empty, so carers had nothing to choose and a worrying arrival could never alert the office
-- (WELFARE_ON_ARRIVAL is raised for amber 'warn' and red 'bad' answers).
-- Added only when the organisation has no active options yet (switched-off defaults are switched back on): a list
-- the office already set up is left as it is.
-- Safe to re-run.
INSERT INTO scheduling."VisitWelfareOutcomeCatalog" (id, code, label, tone, "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), d.code, d.label, d.tone, d.sort_order, true, now(), now()
FROM (VALUES
  ('well-and-comfortable',     'Well and comfortable',              'ok',   0),
  ('unwell-or-in-pain',        'Unwell or in pain',                 'warn', 1),
  ('confused-or-distressed',   'Confused or distressed',            'warn', 2),
  ('found-on-the-floor',       'Found on the floor',                'bad',  3),
  ('needs-urgent-medical-help','Needs urgent medical help',         'bad',  4)
) AS d(code, label, tone, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM scheduling."VisitWelfareOutcomeCatalog" w WHERE w."isActive")
ON CONFLICT (code) DO UPDATE
  SET "isActive" = true, label = EXCLUDED.label, tone = EXCLUDED.tone, "sortOrder" = EXCLUDED."sortOrder", "updatedAt" = now();
