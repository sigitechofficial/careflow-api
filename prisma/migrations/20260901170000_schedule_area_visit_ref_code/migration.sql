-- 3-character branch codes for VIS-[BRANCH]-[YYYYMMDD]-[NNNN]
ALTER TABLE "scheduling"."ScheduleArea"
ADD COLUMN "visitRefCode" VARCHAR(3);

CREATE UNIQUE INDEX "ScheduleArea_visitRefCode_key"
ON "scheduling"."ScheduleArea"("visitRefCode");
