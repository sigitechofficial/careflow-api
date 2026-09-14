export type RotaGeneratedAllocation = {
  employeeId: string
  scheduledJobId: string
  jobName: string
  serviceUserId: string
  scheduledStartDateTime: Date | null
  scheduledEndDateTime: Date | null
}

export type RotaGeneratedCarerPush = {
  employeeId: string
  scheduledJobId: string
  serviceUserId: string
  title: string
  body: string
}

import {
  DEFAULT_OPERATIONAL_TIMEZONE,
  formatHmInTimeZone,
} from '../common/utils/operational-day.util'

function visitTimeSuffix(
  start: Date | null,
  end: Date | null,
  timeZone = DEFAULT_OPERATIONAL_TIMEZONE,
): string {
  if (!start || !end) return ''
  return ` (${formatHmInTimeZone(start, timeZone)}–${formatHmInTimeZone(end, timeZone)})`
}

/** One FCM per carer after rota generate (digest when many visits). */
export function groupRotaGeneratedCarerPushes(
  rows: RotaGeneratedAllocation[],
  timeZone = DEFAULT_OPERATIONAL_TIMEZONE,
): RotaGeneratedCarerPush[] {
  const byEmployee = new Map<string, RotaGeneratedAllocation[]>()
  for (const row of rows) {
    const employeeId = row.employeeId?.trim()
    if (!employeeId) continue
    const list = byEmployee.get(employeeId) ?? []
    list.push(row)
    byEmployee.set(employeeId, list)
  }

  const pushes: RotaGeneratedCarerPush[] = []
  for (const [employeeId, list] of byEmployee) {
    const sorted = [...list].sort((a, b) => {
      const aTime = a.scheduledStartDateTime?.getTime() ?? 0
      const bTime = b.scheduledStartDateTime?.getTime() ?? 0
      return aTime - bTime
    })
    const first = sorted[0]
    if (!first) continue
    if (sorted.length === 1) {
      pushes.push({
        employeeId,
        scheduledJobId: first.scheduledJobId,
        serviceUserId: first.serviceUserId,
        title: 'New visit assigned',
        body: `You have been allocated to "${first.jobName}"${visitTimeSuffix(first.scheduledStartDateTime, first.scheduledEndDateTime, timeZone)}.`,
      })
      continue
    }
    pushes.push({
      employeeId,
      scheduledJobId: first.scheduledJobId,
      serviceUserId: first.serviceUserId,
      title: 'New visits on your rota',
      body: `${sorted.length} visits have been assigned, starting with "${first.jobName}".`,
    })
  }
  return pushes
}
