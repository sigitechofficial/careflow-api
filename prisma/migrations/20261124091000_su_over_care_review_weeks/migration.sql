-- Over care reviews: the visits a manager cancels can be in several weeks. Per week, the over care
-- taken back there ([{"weekStart":"yyyy-mm-dd","minutes":n}]) lowers that week's weekly hours in
-- the timebank, so the cancelled visits are not counted as care owed (and charged) again.
ALTER TABLE "service_users"."ServiceUserOverCareAdjustment" ADD COLUMN "takenBackWeeks" JSONB;
