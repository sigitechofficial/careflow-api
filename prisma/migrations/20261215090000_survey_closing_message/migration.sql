-- Closing-screen message: shown to people after they submit a survey (thanks, what happens next,
-- where to get help). Ready-made surveys bring theirs (Survey.libraryMeta is not used for it, so an
-- organisation can change it per survey); copies, period copies and templates keep it.
ALTER TABLE "surveys"."Survey" ADD COLUMN IF NOT EXISTS "closingMessage" TEXT;
