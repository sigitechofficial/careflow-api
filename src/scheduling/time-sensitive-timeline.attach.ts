import {
  MedicationAdministrationStatus,
  MedicationKind,
  MedicationRecordStatus,
} from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import {
  combineOperationalDateAndHm,
  formatHmInTimeZone,
  operationalDayBounds,
} from '../common/utils/operational-day.util'
import { visitTaskMatchesDay } from '../visit-tasks/visit-task-schedule.util'
import {
  buildTimeSensitiveFlag,
  classifyTimeSensitiveTiming,
  EMPTY_TIME_SENSITIVE_FLAG,
  isEndedVisitStatus,
  isStartedVisitStatus,
  medicineIsTimeSensitive,
  medicineToleranceMinutes,
  type TimeSensitiveItem,
  type TimeSensitiveVisitFlag,
} from './time-sensitive-visit.util'

type TimelineJobLike = {
  id: string
  serviceUserId: string
  status: string
  scheduledStartDateTime: string
  actualStartDateTime?: string | null
  visitPlan?: {
    slotCode?: string
    medicationRoundCode?: string | null
    timeCritical?: boolean
    timeToleranceMinutes?: number
  } | null
  visits?: Array<{ status?: string; actualStartDateTime?: string | null }>
}

function jobVisitStarted(job: TimelineJobLike): boolean {
  if (isStartedVisitStatus(job.status) || isEndedVisitStatus(job.status)) return true
  if (job.actualStartDateTime) return true
  return Boolean(
    job.visits?.some(
      (visit) =>
        isStartedVisitStatus(visit.status) ||
        isEndedVisitStatus(visit.status) ||
        Boolean(visit.actualStartDateTime),
    ),
  )
}

function jobRoundCode(job: TimelineJobLike): string | null {
  const code = (job.visitPlan?.medicationRoundCode ?? job.visitPlan?.slotCode ?? '').trim()
  return code ? code.toUpperCase() : null
}

function scheduleForRound(
  schedules: Array<{
    dueTime: string | null
    dueVisitName: string | null
    round: { code: string } | null
  }>,
  roundCode: string | null,
) {
  if (!schedules.length) return null
  if (!roundCode) return schedules[0]
  return (
    schedules.find((row) => row.round?.code?.toUpperCase() === roundCode) ??
    schedules.find((row) => row.dueVisitName?.trim().toUpperCase() === roundCode) ??
    null
  )
}

function givenInstant(input: {
  actualDateTime: Date | null
  timeGiven: string | null
  day: string
  timeZone: string
}): Date | null {
  if (input.actualDateTime) return input.actualDateTime
  if (input.timeGiven) {
    const instant = combineOperationalDateAndHm(input.day, input.timeGiven, input.timeZone)
    return Number.isFinite(instant.getTime()) ? instant : null
  }
  return null
}

export async function attachTimeSensitiveToTimelineJobs<T extends TimelineJobLike>(
  prisma: PrismaService,
  jobs: T[],
  day: string,
  timeZone: string,
  now = new Date(),
): Promise<Array<T & { timeSensitive: TimeSensitiveVisitFlag }>> {
  if (!jobs.length) return []

  const suIds = [...new Set(jobs.map((job) => job.serviceUserId))]
  const jobIds = jobs.map((job) => job.id)
  const dayDate = new Date(`${day}T12:00:00.000Z`)
  const bounds = operationalDayBounds(day, timeZone)

  const [medications, assignments, events, completions] = await Promise.all([
    prisma.serviceUserMedication.findMany({
      where: {
        serviceUserId: { in: suIds },
        deletedAt: null,
        isActive: true,
        status: MedicationRecordStatus.ACTIVE,
        medicationKind: { not: MedicationKind.PRN },
      },
      select: {
        id: true,
        serviceUserId: true,
        medicationName: true,
        timeCritical: true,
        timeToleranceMinutes: true,
        medicationKind: true,
        medicationPack: { select: { adminRules: true } },
        schedules: {
          where: { deletedAt: null, isActive: true },
          select: {
            dueTime: true,
            dueVisitName: true,
            round: { select: { code: true } },
          },
        },
      },
    }),
    prisma.serviceUserVisitTaskAssignment.findMany({
      where: {
        serviceUserId: { in: suIds },
        timeCritical: true,
        deletedAt: null,
        isActive: true,
      },
      select: {
        id: true,
        serviceUserId: true,
        medicationRoundCode: true,
        timeCritical: true,
        timeToleranceMinutes: true,
        daysOfWeek: true,
        scheduleFrequency: true,
        repeatEvery: true,
        repeatUnit: true,
        monthlyDayMode: true,
        monthlyDaysOfMonth: true,
        monthlyPatternOrdinal: true,
        monthlyPatternWeekday: true,
        task: { select: { name: true } },
      },
    }),
    prisma.medicationAdministrationEvent.findMany({
      where: {
        serviceUserId: { in: suIds },
        deletedAt: null,
        OR: [
          { scheduledDateTime: { gte: bounds.start, lte: bounds.end } },
          { actualDateTime: { gte: bounds.start, lte: bounds.end } },
        ],
      },
      select: {
        serviceUserMedicationId: true,
        scheduledDateTime: true,
        actualDateTime: true,
        timeGiven: true,
        status: true,
      },
    }),
    prisma.scheduledVisitTaskCompletion.findMany({
      where: { scheduledJobId: { in: jobIds } },
      select: {
        scheduledJobId: true,
        assignmentId: true,
        isCompleted: true,
        completedAt: true,
      },
    }),
  ])

  const eventsByMed = new Map<string, (typeof events)[number]>()
  for (const event of events) {
    const prev = eventsByMed.get(event.serviceUserMedicationId)
    if (!prev || (event.actualDateTime && !prev.actualDateTime)) {
      eventsByMed.set(event.serviceUserMedicationId, event)
    }
  }
  const completionByJobAssignment = new Map<string, (typeof completions)[number]>()
  for (const row of completions) {
    if (!row.assignmentId) continue
    completionByJobAssignment.set(`${row.scheduledJobId}:${row.assignmentId}`, row)
  }

  return jobs.map((job) => {
    const round = jobRoundCode(job)
    const visitEnded =
      isEndedVisitStatus(job.status) || job.visits?.some((visit) => isEndedVisitStatus(visit.status))
    const visitStarted = jobVisitStarted(job)
    const dueFallback = new Date(job.scheduledStartDateTime)
    const items: TimeSensitiveItem[] = []

    for (const med of medications) {
      if (med.serviceUserId !== job.serviceUserId) continue
      if (
        !medicineIsTimeSensitive({
          timeCritical: med.timeCritical,
          adminRules: med.medicationPack?.adminRules,
        })
      ) {
        continue
      }
      const schedule = scheduleForRound(med.schedules, round)
      if (!schedule) continue
      const event = eventsByMed.get(med.id)
      const due =
        event?.scheduledDateTime ??
        (schedule.dueTime
          ? combineOperationalDateAndHm(day, schedule.dueTime, timeZone)
          : dueFallback)
      const given =
        event?.status === MedicationAdministrationStatus.GIVEN
          ? givenInstant({
              actualDateTime: event.actualDateTime,
              timeGiven: event.timeGiven,
              day,
              timeZone,
            })
          : null
      const missedByStatus =
        event?.status === MedicationAdministrationStatus.MISSED ||
        event?.status === MedicationAdministrationStatus.NOT_GIVEN ||
        event?.status === MedicationAdministrationStatus.REFUSED
      const toleranceMinutes = medicineToleranceMinutes({
        timeCritical: med.timeCritical,
        timeToleranceMinutes: med.timeToleranceMinutes,
        adminRules: med.medicationPack?.adminRules,
      })
      items.push({
        kind: 'MEDICINE',
        name: med.medicationName,
        dueTime: schedule.dueTime ?? formatHmInTimeZone(due, timeZone),
        givenTime: given ? formatHmInTimeZone(given, timeZone) : null,
        toleranceMinutes,
        status: missedByStatus
          ? 'missed'
          : classifyTimeSensitiveTiming({
              due,
              given,
              toleranceMinutes,
              now,
              visitEnded: Boolean(visitEnded),
              visitStarted,
            }),
      })
    }

    for (const assignment of assignments) {
      if (assignment.serviceUserId !== job.serviceUserId) continue
      if (assignment.medicationRoundCode.toUpperCase() !== (round ?? '')) continue
      if (!visitTaskMatchesDay(assignment, dayDate, dayDate)) continue
      const completion = completionByJobAssignment.get(`${job.id}:${assignment.id}`)
      const given = completion?.isCompleted ? (completion.completedAt ?? null) : null
      items.push({
        kind: 'TASK',
        name: assignment.task.name,
        dueTime: formatHmInTimeZone(dueFallback, timeZone),
        givenTime: given ? formatHmInTimeZone(given, timeZone) : null,
        toleranceMinutes: assignment.timeToleranceMinutes,
        status: classifyTimeSensitiveTiming({
          due: dueFallback,
          given,
          toleranceMinutes: assignment.timeToleranceMinutes,
          now,
          visitEnded: Boolean(visitEnded),
          visitStarted,
        }),
      })
    }

    let flag = buildTimeSensitiveFlag(items)
    if (!flag.hasAny && job.visitPlan?.timeCritical) {
      flag = { hasAny: true, clock: 'due', items: [], chips: [] }
    }
    return { ...job, timeSensitive: flag.hasAny ? flag : EMPTY_TIME_SENSITIVE_FLAG }
  })
}
