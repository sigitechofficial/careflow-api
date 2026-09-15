/** Field events that always notify the office (in-app + sound), independent of late-visit flags. */
export const URGENT_OFFICE_ALERT_KINDS = [
  'CARER_SOS',
  'LEFT_VISIT_AREA',
  'UNABLE_TO_START',
  'OUTSIDE_AREA_CHECK_IN_REQUEST',
] as const

export type UrgentOfficeAlertKind = (typeof URGENT_OFFICE_ALERT_KINDS)[number]

export function isUrgentOfficeAlertKind(kind: string | null | undefined): boolean {
  return URGENT_OFFICE_ALERT_KINDS.includes(kind as UrgentOfficeAlertKind)
}

export function ecmExceptionQueueHref(scheduledJobId: string): string {
  const params = new URLSearchParams({ tab: 'exceptions', period: 'today' })
  if (scheduledJobId) params.set('jobId', scheduledJobId)
  return `/ecm/live?${params.toString()}`
}
