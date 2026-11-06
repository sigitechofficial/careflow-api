import { Logger } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { dayKeyInTimeZone } from '../common/utils/operational-day.util';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditModule } from '../audit-logs/enums/audit-module.enum';
import { AuditAction } from '../audit-logs/enums/audit-action.enum';

/**
 * Answers not linked to anyone (anonymous surveys, "Answer without my name", shared links, answers
 * recorded as anonymous, anonymous answers an independent reviewer records) get NO audit row each:
 * a row per answer holds the survey id and the exact time, so anyone who can read the audit log
 * could count a survey's answers and date each one. Instead each answer adds one to the survey's
 * count for the day (SurveyUnlinkedAnswerDay, date only, nothing about the answer or the person),
 * and once the day is over the day's count is written to the audit log as one row
 * (survey_unlinked_answers_counted). Named answers keep their own audit row.
 */

/** How the answer came in: given by the person, recorded by staff, or recorded by an independent reviewer. */
export type UnlinkedAnswerSource = 'answered' | 'recorded' | 'reviewer';

type Db = PrismaClient | Prisma.TransactionClient;

const logger = new Logger('SurveyUnlinkedAnswerDays');

/** The most days written to the audit log in one run (the rest follow on the next run). */
export const AUDIT_DAYS_PER_RUN = 200;

/** Adds one answer to the survey's count for the operational day of `now`. */
export async function countUnlinkedAnswer(
  db: Db,
  surveyId: string,
  source: UnlinkedAnswerSource,
  opts: { now: Date; timeZone: string },
): Promise<void> {
  const day = dayKeyInTimeZone(opts.now, opts.timeZone);
  const recorded = source === 'answered' ? 0 : 1;
  const reviewer = source === 'reviewer' ? 1 : 0;
  await db.$executeRaw`
    INSERT INTO "surveys"."SurveyUnlinkedAnswerDay" ("surveyId", "day", "answers", "recorded", "reviewerRecorded")
    VALUES (${surveyId}::uuid, ${day}::date, 1, ${recorded}, ${reviewer})
    ON CONFLICT ("surveyId", "day") DO UPDATE SET
      "answers" = "SurveyUnlinkedAnswerDay"."answers" + 1,
      "recorded" = "SurveyUnlinkedAnswerDay"."recorded" + EXCLUDED."recorded",
      "reviewerRecorded" = "SurveyUnlinkedAnswerDay"."reviewerRecorded" + EXCLUDED."reviewerRecorded"`;
}

/**
 * Counts the answer, trying twice. The answer is already kept when this runs, so a failure never
 * fails the answer: it is logged (survey id only) for the operations team instead.
 */
export async function countUnlinkedAnswerSafely(
  db: Db,
  surveyId: string,
  source: UnlinkedAnswerSource,
  opts: { now: Date; timeZone: string },
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await countUnlinkedAnswer(db, surveyId, source, opts);
      return;
    } catch (e) {
      if (attempt === 1) {
        logger.error(
          `Survey ${surveyId}: an answer not linked to anyone was kept but not counted for the audit log (${e instanceof Error ? e.name : 'error'}).`,
        );
      }
    }
  }
}

/** "5 Nov 2026" for a day key (date only). */
export const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * The office's daily summary of a staff survey's answers linked to no one (one a day, sent after the
 * day is over), instead of a notice at the moment each came in.
 */
export function unlinkedDaySummary(
  title: string,
  day: string,
  answers: number,
  progress: { completed: number; total: number } | null,
): { title: string; message: string } {
  const head = `${answers} ${answers === 1 ? 'answer' : 'answers'} to "${title}" not linked to anyone came in on ${dayLabel(day)}.`;
  const tail = progress && progress.total ? ` ${progress.completed} of ${progress.total} have now answered.` : '';
  return { title: `Survey answers — ${title}`, message: head + tail };
}

/** "3 answers not linked to anyone on 5 Nov 2026 (2 recorded by staff, 1 of them by an independent reviewer)". */
export function unlinkedDayDescription(day: string, answers: number, recorded: number, reviewer: number): string {
  const head = `${answers} ${answers === 1 ? 'answer' : 'answers'} not linked to anyone on ${dayLabel(day)}`;
  if (!recorded) return head;
  const by = reviewer ? `, ${reviewer} of them by an independent reviewer` : '';
  return `${head} (${recorded} recorded by staff${by})`;
}

export type UnlinkedDayRow = { surveyId: string; day: string; answers: number; recorded: number; reviewerRecorded: number };
type DayRow = UnlinkedDayRow;

/**
 * Writes each finished day's count (days before today in the organisation's time zone) to the audit
 * log, once: the day is marked audited in the same transaction as its audit row. The row's own time
 * is when this runs, never when an answer came in. `onDay` then runs once for each day written (the
 * office's daily summary); its failure is logged and never undoes the audit. Returns the days written.
 */
export async function auditUnlinkedAnswerDays(
  db: PrismaClient,
  audit: Pick<AuditLogsService, 'logAudit'>,
  opts: { now: Date; timeZone: string; onDay?: (day: UnlinkedDayRow) => Promise<void> },
): Promise<number> {
  const today = dayKeyInTimeZone(opts.now, opts.timeZone);
  const rows = await db.$queryRaw<DayRow[]>`
    SELECT "surveyId"::text AS "surveyId", to_char("day", 'YYYY-MM-DD') AS "day", "answers", "recorded", "reviewerRecorded"
    FROM "surveys"."SurveyUnlinkedAnswerDay"
    WHERE "auditedAt" IS NULL AND "day" < ${today}::date
    ORDER BY "day" ASC
    LIMIT ${AUDIT_DAYS_PER_RUN}`;
  let written = 0;
  for (const r of rows) {
    const done = await db.$transaction(async (tx) => {
      const marked = await tx.$executeRaw`
        UPDATE "surveys"."SurveyUnlinkedAnswerDay" SET "auditedAt" = ${opts.now}
        WHERE "surveyId" = ${r.surveyId}::uuid AND "day" = ${r.day}::date AND "auditedAt" IS NULL`;
      // Another server wrote it already.
      if (marked === 0) return false;
      await audit.logAudit({
        tx,
        userId: undefined,
        module: AuditModule.SURVEY,
        action: AuditAction.SURVEY_UNLINKED_ANSWERS_COUNTED,
        recordType: 'Survey',
        recordId: r.surveyId,
        description: unlinkedDayDescription(r.day, r.answers, r.recorded, r.reviewerRecorded),
        newValues: { day: r.day, answers: r.answers, recorded: r.recorded, reviewerRecorded: r.reviewerRecorded },
        metadata: { surveyId: r.surveyId, day: r.day },
      });
      return true;
    });
    if (!done) continue;
    written += 1;
    if (opts.onDay) {
      await opts.onDay(r).catch((e: unknown) =>
        logger.warn(`Survey ${r.surveyId}: the daily summary of answers was not sent (${e instanceof Error ? e.name : 'error'})`),
      );
    }
  }
  return written;
}
