-- Survey roadmap Phase 2 part 5 (insight).
-- Scoring for scored tools (HSE-indicator style scales, audit scores): { scales: [...] } on the survey; null = none.
ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "scoring" JSONB;
-- Response quality: flags kept with a response (FAST only; straight-lining and duplicates are worked out when shown).
-- Never a time: the answer page sends how long it took and only the flag is kept. Flagged answers are never removed.
ALTER TABLE "surveys"."SurveyResponse" ADD COLUMN IF NOT EXISTS "qualityFlags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
